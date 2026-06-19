# Design: Projects Domain CRUD + Global Exception Filter

## Technical Approach

Build the projects domain on top of the existing `bootstrap-api-config` and
`auth-domain` foundations: two TypeORM entities (`ProjectEntity`,
`ProjectUrlEntity`) wired into the shared `AppDataSource`, five new DTOs, a
`ProjectsService` that owns slug uniqueness, transactional `project_urls`
persistence, and the **DIFF semantics** on update, and a `ProjectsController`
with the 5 routes mandated by `server_specs.md` §3.2. Land a single global
`AllExceptionsFilter` (`src/common/filters/`) registered in `main.ts` so every
domain — auth, projects, reviews, contact, and any future one — renders 4xx
and 5xx with the canonical envelope `{ statusCode, error, message, timestamp,
path }`. Read endpoints stay public; create / update / delete carry
`@UseGuards(JwtAuthGuard)` per `auth-domain` ADR-6. Total forecast ~670 LOC
across 4 chained PRs (well below the 400-line per-PR review budget).

Satisfies the `projects-domain` capability spec (5 ADDED Requirements, 17
scenarios) and the `global-exception-filter` capability spec (5 ADDED
Requirements, 10 scenarios). Reuses `JwtAuthGuard` from `src/auth/guards/`,
the global `ValidationPipe` from `main.ts`, and the typed
`ConfigService<EnvConfig>` injection pattern from `bootstrap-api-config`.
**No new dependencies.**

## Architecture Overview

```
   ┌──────────────┐   public   ┌─────────────────┐    query filters    ┌──────────────┐
   │  Frontend /  │ ─────────► │ ProjectsCtl.list │ ──────────────────► │ ProjectsSvc  │
   │  curl / e2e  │            │ ProjectsCtl.detail│                    │ .findPublic  │
   └──────┬───────┘            └────────┬─────────┘                    │ .findOneBySlug│
          │                             │                              └──────┬───────┘
          │  bearer (POST/PATCH/DEL)    │                                     │
          │ ────────────────────────────►                                     ▼
          │                    ┌────────┴─────────┐                    ┌──────────────┐
          │                    │ JwtAuthGuard     │                    │ TypeORM Repo │
          │                    │ (per-controller) │                    │ (Project)    │
          │                    └────────┬─────────┘                    │ + project_urls│
          │                             │                              └──────────────┘
          │                             ▼                                     ▲
          │                    ┌────────────────┐  HttpException / raw Error  │
          └────────────────────┤ ProjectsCtl    │ ─────────────────────────────┘
                               │ .create/.update│             │
                               │ .remove        │             ▼
                               └────────────────┘   ┌──────────────────────┐
                                                    │ AllExceptionsFilter  │
                                                    │ (global, main.ts)    │
                                                    │ ─ canonical envelope │
                                                    │ ─ 4xx passthrough    │
                                                    │ ─ 5xx sanitized      │
                                                    │ ─ server log + reqId │
                                                    └──────────────────────┘
```

The filter is the **last** middleware in the response pipeline: it sits above
controllers, above guards, above pipes. Any `HttpException` (including the
`UnauthorizedException` from `JwtAuthGuard` and the `BadRequestException`
from `ValidationPipe`) flows through it; any raw `Error` (e.g. a thrown
`TypeError` in the service layer) is also funneled through it. Its body is
the canonical envelope — there is no other path to the client for error
bodies.

## Architecture Decision Records

### ADR-1: project_urls DIFF algorithm

**Choice.** Match incoming `urls` against existing `project_urls` rows by
the pair `(title, url)`. Pseudocode:

```
applyProjectUrlsDiff(projectId, desiredUrls, manager):
  existing = await manager.find(ProjectUrlEntity, { where: { projectId } })
  desired  = normalizeAndDedupe(desiredUrls)         # per ADR-2
  # key by (title|LOWER(url)) for case-insensitive URL match
  existingByKey = Map((t, lower(u)) -> row) for row in existing
  desiredByKey  = Map((t, lower(u)) -> entry) for entry in desired
  toInsert = [entry for entry in desired if its key not in existingByKey]
  toDelete = [row   for row    in existing if its key not in desiredByKey]
  if toInsert.length: await manager.insert(ProjectUrlEntity, toInsert.map(mapToRow))
  if toDelete.length: await manager.delete(ProjectUrlEntity, toDelete.map(r => r.id))
```

**Edge cases** (committed):

| Input | Behaviour |
|---|---|
| `urls` field absent from `UpdateProjectDto` | No-op. Existing rows untouched. |
| `urls: []` (empty array) | All existing rows for the project are deleted. |
| `urls: [{title, url}]` matches an existing row by `(title, url)` | Skip. No-op on the DB. |
| `urls: [{title: A, url: X}, {title: B, url: X}]` | Rejected at DTO validation (ADR-2). |
| `urls: [{title: A, url: X}, {title: A, url: x}]` (URL case differs) | Rejected at DTO validation (ADR-2 normalises URLs to lowercase for comparison). |
| `urls: [{title: NEW, url: Y}]` only | Insert one row. |

**Rationale.** Matching on `(title, url)` is the natural identity for a
project URL: a project can legitimately have two URLs that share a title
(e.g. "Repo" + "Repo") but the URL is what makes a row distinct. Same
`url` with different `title` is rejected at the DTO layer (ADR-2) because
the spec locks that as a client error — the service never has to invent a
last-write-wins policy. Case-insensitive URL comparison prevents
"https://x" and "https://X" from creating two rows that look like the
same link to a user.

**Alternatives considered.**
- (a) Match by `url` only (ignore `title`). **Rejected** — the DBML does
  not declare `url` unique per project; the spec scenario explicitly
  allows the same URL with different titles in different rows.
- (b) Replace-all (`DELETE WHERE projectId = X; INSERT ALL`). **Rejected**
  — the proposal locks DIFF semantics; replace-all loses granular
  deletion history and breaks the spec scenario "rows preserved when
  not in the diff".

### ADR-2: Intra-array duplicate `url` rejection in DTO

**Choice.** Custom class-validator decorator
`@IsUniqueUrlInArray()` registered via `registerDecorator` on
`UpdateProjectDto.urls` and `CreateProjectDto.urls`. The decorator
normalises each entry to `lower(trim(url))` and rejects if any value
appears twice.

```ts
@ValidatorConstraint({ name: "isUniqueUrlInArray", async: false })
class IsUniqueUrlInArrayConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value)) return true; // @IsArray handles the type check
    const seen = new Set<string>();
    for (const entry of value) {
      const url = String((entry as { url: unknown })?.url ?? "").trim().toLowerCase();
      if (url.length === 0) continue; // empty url rejected by @IsUrl on ProjectUrlDto
      if (seen.has(url)) return false;
      seen.add(url);
    }
    return true;
  }
  defaultMessage(): string {
    return "urls[] must not contain duplicate url values (case-insensitive)";
  }
}
```

**Rationale.** `class-validator`'s built-in `@ArrayUnique` is
**whole-object equality** — `{title: A, url: x}` and `{title: B, url: x}`
have different `title`s so `@ArrayUnique` accepts them. The spec
scenario "Two urls sharing the same `url` value are rejected at DTO
validation" requires matching on a single field, so a custom decorator is
mandatory. The check is `async: false` (pure function, no I/O) and lives
next to the DTO file in `src/projects/dto/validators/`.

**Alternatives considered.**
- (a) `@ArrayUnique(({title, url}) => title + "|" + url)`. **Rejected** —
  this would let `{title: A, url: x}` and `{title: B, url: x}` both pass
  through to the service, which is exactly the case the spec rejects.
- (b) Service-layer check inside `applyProjectUrlsDiff`. **Rejected** —
  per `bootstrap-api-config` ADR-2 the strict pipe rejects malformed
  bodies before the controller runs; moving the check to the service
  turns a 400 into a 500 path. The DTO layer is the right place.

### ADR-3: Postgres `tags` array-contains mapping

**Choice.** The `ProjectEntity.tags` column is declared
`@Column({ type: "text", array: true, nullable: true, default: () => "ARRAY[]::text[]" })`.
The list filter is implemented with a raw `where` fragment using the
Postgres `@>` (array-contains) operator:

```ts
// ProjectsService.findPublic — AND semantics
if (query.tags && query.tags.length > 0) {
  // :...tags binds the array; @> requires all elements to be present
  qb.andWhere("project.tags @> ARRAY[:...tags]", { tags: query.tags });
}
```

A GIN index on `tags` is added at migration time to keep the operator's
cost sub-linear:
`CREATE INDEX idx_projects_tags_gin ON projects USING GIN (tags);`

**Rationale.** `varchar[]` in Postgres is a length-constrained array —
the right type only when every element has a known max length. Tags are
free-form strings; the DBML's `varchar[]` is a documentation shortcut for
"Postgres text array". `text[]` is the conventional choice and is what
TypeORM emits via `type: "text", array: true`. The DBML delta (see §DBML
implications) is the only place where this is committed. The `@>` operator
is the spec-locked AND-mapping for the `tags` filter: a project matches
only when **every** requested tag is present in its `tags` column.

**Alternatives considered.**
- (a) `type: "varchar", array: true` (exact DBML match). **Rejected** —
  TypeORM emits the same DDL but the intent ("free-form tag string")
  is clearer with `text`. The DBML delta is trivial and matches the
  proposal's "Recommended: `text[]` + DBML update" verdict.
- (b) `In` operator on a join table. **Rejected** — the DBML is
  array-of-strings; introducing a `project_tags` table is a schema
  change the spec does not authorise.
- (c) Application-level filter (load then JS `.every`). **Rejected** —
  breaks `total` count and pagination semantics.

### ADR-4: Transaction isolation for the project_urls DIFF

**Choice.** `READ COMMITTED` (Postgres default) for every write path.
The DIFF on update runs inside `manager.transaction(...)`; on
`QueryFailedError` with PG code `40001` (serialization_failure) or
`40P01` (deadlock_detected) the service retries **up to 3 times** with
exponential backoff (50ms, 200ms, 500ms). On the final failure it
re-throws the original error so the filter renders a 500 with full
diagnostics.

```ts
// ProjectsService.update
private async withRetry<T>(op: () => Promise<T>): Promise<T> {
  const delays = [50, 200, 500];
  for (let attempt = 0; ; attempt++) {
    try { return await op(); }
    catch (e) {
      const code = (e as { code?: string }).code;
      const retryable = code === "40001" || code === "40P01";
      if (!retryable || attempt === delays.length) throw e;
      await sleep(delays[attempt]);
    }
  }
}
```

**Rationale.** Single-admin portfolio — concurrent PATCHes on the same
project are exceedingly rare. The race window inside a `READ COMMITTED`
transaction is the time between `SELECT existing` and `INSERT/DELETE`
children, which is sub-millisecond. `SERIALIZABLE` would add a
serialization-failure cost on every write for a near-zero contention
benefit; `READ COMMITTED` + retry is the conventional Nest/TypeORM
pattern and is what the auth-domain's `refresh` flow implicitly relies
on. The retry loop is a no-op in the happy path (no exception, no wait).

**Alternatives considered.**
- (a) `SERIALIZABLE` for `update` and `create`. **Rejected** — adds
  retry-on-every-write overhead and a stricter isolation level than
  the spec requires.
- (b) Pessimistic lock (`SELECT ... FOR UPDATE` on the project row).
  **Rejected** — fine for a single admin, but heavier than necessary
  and complicates the FK relationship to `project_urls`.
- (c) No transaction. **Rejected** — the spec scenario "DIFF happens in
  a single `manager.transaction`" is a hard requirement.

### ADR-5: Admin get-by-id path

**Choice.** **Out of scope for this change.** The proposal accepts
`GET /api/v1/admin/projects/:id` as a follow-up, behind `JwtAuthGuard`,
for admin previews of unpublished projects. The `projects-domain`
capability spec does not require it; the v1 asymmetry (read-by-slug
public, write-by-id protected) is what the user asked for. A
`projects-domain-v1.1` addendum will land the admin route in a
follow-up change with its own spec delta.

**Rationale.** The spec scenario "Unpublished project returns 404
(no existence leak)" is the higher-priority constraint — an admin
route that lets a single admin preview unpublished projects by id is a
nice-to-have, not a v1 requirement. The follow-up is acknowledged in
the proposal's "Open Questions for Spec/Design" #3 and is small enough
to be a 30-line add.

### ADR-6: Prod-vs-dev branch + request id source

**Choice.** Two decisions:

- **Prod-vs-dev branch**: the filter reads
  `configService.get("NODE_ENV", { infer: true })`. If it is `"production"`
  the response body is sanitised (generic message, no stack, no
  original error message). Otherwise the body carries the original
  `Error.message` and a `stack` field is **still omitted** (the
  generic envelope shape is preserved; only `message` flips). The
  `NODE_ENV` lookup goes through the typed `ConfigService`; the
  `EnvConfig` interface gains one optional field (`NODE_ENV?: string`)
  with a Joi `Joi.string().valid('development', 'test', 'production').default('development')`
  schema entry. No `EXPOSE_ERROR_DETAILS` flag — the source of truth
  is the env name, matching the convention used by NestJS core
  (`InternalServerErrorException`'s response in dev vs prod).

- **Request id source**: a Nest middleware
  `src/common/middleware/request-id.middleware.ts` that reads the
  inbound `x-request-id` header if present (length ≤ 128, must match
  `^[A-Za-z0-9_-]+$`), otherwise generates a fresh
  `crypto.randomUUID()`, attaches it to `req.id`, and echoes it back
  via the response `x-request-id` header. The filter reads
  `(req as { id?: string }).id` and includes it in the 5xx log
  context and (if present) the response body's `requestId` field. The
  filter does NOT use NestJS's built-in `request.id` (a numeric
  counter from `@nestjs/core`) because it is per-request-internal
  and not designed to round-trip through HTTP.

**Rationale.** The `NODE_ENV` branch is the convention every Nest
deployment uses; introducing a separate flag creates a 4-state
configuration surface (`production+expose`, `production+hide`,
`dev+expose`, `dev+hide`) for no benefit. The request-id middleware
is the standard "tiny piece of glue" pattern that runs **before**
`ValidationPipe` and `AllExceptionsFilter` and survives both happy
and error paths. The middleware is registered in `main.ts` via
`app.use(RequestIdMiddleware)` (function-style, no DI) so it is the
first thing the request sees.

**Alternatives considered.**
- (a) `EXPOSE_ERROR_DETAILS` boolean env var. **Rejected** — see
  above; doubles the config surface and is harder to audit.
- (b) `cls-hooked` / `nestjs-cls` for request-scoped context.
  **Rejected** — adds a dependency for a single use case; the
  middleware-plus-`req.id` pattern is sufficient.
- (c) NestJS's built-in `request.id` (numeric). **Rejected** — not
  designed to round-trip; colliding integers across replicas in
  distributed tracing are a worse experience than UUIDs.

### ADR-7: DataSource entity registration

**Choice.** `src/data-source.ts` adds `ProjectEntity, ProjectUrlEntity`
to the **explicit** `entities: [...]` array. The pattern stays
`[UserEntity, RefreshTokenEntity, ProjectEntity, ProjectUrlEntity]`
in that import order. No glob, no `autoLoadEntities: true` flag.

**Rationale.** The current `data-source.ts` already declares an
explicit array. The new entities follow the same convention:
imported at the top, listed in the same array. TypeORM's
`autoLoadEntities` would work **only if** the entity file is
imported transitively from somewhere in the runtime graph (here,
`ProjectsModule` imports both). The explicit array is the
**single source of truth** the seed CLI and the runtime both read —
removing the array would force the seed CLI to chase the runtime
graph. Cost of the array: 0 LOC. Cost of switching to auto-load:
2 places to touch if a new entity ships (the entity import and the
test's `getRepositoryToken` mock — and the test mock is unchanged
either way).

## TypeORM Data Model

### `ProjectEntity` — `src/projects/entities/project.entity.ts`

| DBML column (lines 12-23) | TypeORM decorator | Notes |
|---|---|---|
| `id uuid pk default uuid_generate_v4()` | `@PrimaryGeneratedColumn("uuid")` `id: string` | Postgres default. |
| `title varchar not null` | `@Column({ type: "varchar" })` `title: string` | Non-null. |
| `slug varchar unique not null` | `@Column({ type: "varchar", unique: true })` `slug: string` | DBML `unique`. |
| `description text not null` | `@Column({ type: "text" })` `description: string` | Non-null. |
| `content text` (nullable) | `@Column({ type: "text", nullable: true })` `content: string \| null` | Optional. |
| `cover_image varchar` (nullable) | `@Column({ name: "cover_image", type: "varchar", nullable: true })` `coverImage: string \| null` | DTO validates URL. |
| `tags varchar[]` | `@Column({ name: "tags", type: "text", array: true, nullable: true, default: () => "ARRAY[]::text[]" })` `tags: string[]` | **DBML delta: `varchar[]` → `text[]` (ADR-3).** |
| `is_published boolean default false` | `@Column({ name: "is_published", type: "boolean", default: false })` `isPublished: boolean` | DBML default. |
| `created_at timestamp default now()` | `@CreateDateColumn({ name: "created_at" })` `createdAt: Date` | |
| `updated_at timestamp default now()` | `@UpdateDateColumn({ name: "updated_at" })` `updatedAt: Date` | |
| **one-to-many to `project_urls`** | `@OneToMany(() => ProjectUrlEntity, (u) => u.project) urls: ProjectUrlEntity[]` | Eager-loaded only on demand via `relations: { urls: true }`. |

**Slug index decision (not in the spec, committed in design):** keep the
DBML's `slug unique` (case-sensitive) and add a non-unique
`LOWER(slug)` functional index for case-insensitive lookups:
`CREATE INDEX idx_projects_slug_lower ON projects (LOWER(slug));`.
The unique constraint stays case-sensitive (DBML is the contract);
case-insensitive lookups are read-only optimisation. DBML delta adds
an `Indexes` block to the `projects` table (see §DBML implications).

### `ProjectUrlEntity` — `src/projects/entities/project-url.entity.ts`

| DBML column (lines 25-32) | TypeORM decorator | Notes |
|---|---|---|
| `id uuid pk` | `@PrimaryGeneratedColumn("uuid")` `id: string` | |
| `project_id uuid ref projects.id not null` | `@ManyToOne(() => ProjectEntity, (p) => p.urls, { onDelete: "CASCADE" })` `project: ProjectEntity` + `@JoinColumn({ name: "project_id" })` `projectId: string` | FK + CASCADE. |
| `title varchar not null` | `@Column({ type: "varchar" })` `title: string` | |
| `url varchar not null` | `@Column({ type: "varchar" })` `url: string` | |
| `created_at` | `@CreateDateColumn({ name: "created_at" })` `createdAt: Date` | |
| `updated_at` | `@UpdateDateColumn({ name: "updated_at" })` `updatedAt: Date` | |

No composite unique on `(project_id, url)` is added — the spec lets two
rows share the same `url` with different `title`s; the
`@IsUniqueUrlInArray` DTO rule (ADR-2) is the per-payload check, not a
DB-level constraint.

## DTO Inventory

All DTOs live in `src/projects/dto/`. `@ApiProperty` is added on every
field (Swagger). Body DTOs are NOT typed with `@Type(() => Number)` per
`bootstrap-api-config` ADR-2 — only the query DTO is.

### `CreateProjectDto` — replaces stub `create-project.dto.ts`

| Field | Type | Decorators | Required | Notes |
|---|---|---|---|---|
| `title` | `string` | `@IsString @IsNotEmpty @MaxLength(200)` | ✓ | |
| `slug` | `string` | `@IsString @IsNotEmpty @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)` | ✓ | kebab-case; uniqueness in service. |
| `description` | `string` | `@IsString @IsNotEmpty @MaxLength(500)` | ✓ | |
| `content` | `string` | `@IsString @IsOptional @MaxLength(50_000)` | | Markdown/HTML; 50KB cap. |
| `coverImage` | `string` | `@IsUrl({ require_protocol: true, protocols: ["http", "https"] }) @IsOptional` | | |
| `tags` | `string[]` | `@IsArray @IsOptional @IsString({ each: true }) @ArrayMaxSize(20) @Transform(({ value }) => [...new Set((value as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean))])` | | Trim + lowercase + dedupe. |
| `isPublished` | `boolean` | `@IsBoolean @IsOptional` | | |
| `urls` | `ProjectUrlDto[]` | `@IsArray @IsOptional @ValidateNested({ each: true }) @Type(() => ProjectUrlDto) @ArrayMaxSize(50) @IsUniqueUrlInArray()` | | Per ADR-2. |

### `UpdateProjectDto` — `PartialType(CreateProjectDto)` from `@nestjs/swagger`

Every field becomes optional. `urls` keeps the diff semantic: field
absent = no-change; empty array = remove all (per ADR-1 and
proposal lock). Uses `@nestjs/swagger`'s `PartialType` (already
imported by the stub — no replacement needed).

### `ListProjectsQueryDto` — new

| Field | Type | Decorators | Default | Notes |
|---|---|---|---|---|
| `page` | `number` | `@IsOptional @Type(() => Number) @IsInt @Min(1)` | `1` | |
| `pageSize` | `number` | `@IsOptional @Type(() => Number) @IsInt @Min(1) @Max(100)` | `20` | **Capped silently at 100** — `@Max(100)` rejects only the wire value; service re-clamps to 100 anyway. |
| `tags` | `string[]` | `@IsOptional @IsArray @IsString({ each: true }) @Transform(({ value }) => Array.isArray(value) ? value : String(value).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))` | `[]` | Accepts `?tags=react&tags=nestjs` (repeated) or `?tags=react,nestjs` (csv). |
| `isPublished` | `boolean` | `@IsOptional @Type(() => Boolean) @IsBoolean` | `true` | `@Type(() => Boolean)` with `enableImplicitConversion` would already coerce "true"/"false"; explicit for clarity. |

### `ProjectUrlDto` — new (nested)

| Field | Type | Decorators | Required | Notes |
|---|---|---|---|---|
| `title` | `string` | `@IsString @IsNotEmpty @MaxLength(100)` | ✓ | |
| `url` | `string` | `@IsUrl({ require_protocol: true, protocols: ["http", "https"] }) @MaxLength(2048)` | ✓ | |

### `ProjectResponseDto` — new (single response shape reused everywhere)

Plain class with `@ApiProperty` on every field. `class-transformer`'s
`excludeExtraneousValues: true` keeps the response shape locked.
`urls: ProjectUrlResponseDto[]` (a separate Swagger class with
`@ApiProperty({ type: [ProjectUrlResponseDto] })`).

## Service Layer

`ProjectsService` (`src/projects/projects.service.ts`) — the methods
below are the only public surface. All write methods accept the
`manager` from `manager.transaction` (or fall through to the default
`DataSource` repository) so the test harness can mock the manager
cleanly.

```ts
@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)     private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ProjectUrlEntity)  private readonly projectUrls: Repository<ProjectUrlEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // Public reads
  findPublic(query: ListProjectsQueryDto): Promise<{ data: ProjectResponseDto[]; total: number; page: number; pageSize: number }>;
  findOneBySlug(slug: string): Promise<ProjectResponseDto>; // 404 on missing or unpublished

  // Admin writes
  create(dto: CreateProjectDto, userId: string): Promise<ProjectResponseDto>;
  update(id: string, dto: UpdateProjectDto, userId: string): Promise<ProjectResponseDto>;
  remove(id: string): Promise<void>;

  // Internal (test seam)
  applyProjectUrlsDiff(projectId: string, desired: ProjectUrlDto[], manager: EntityManager): Promise<void>;
  private withRetry<T>(op: () => Promise<T>): Promise<T>; // ADR-4
}
```

### Pseudocode — `findPublic(query)`

```
findPublic(query):
  page     = query.page ?? 1
  pageSize = Math.min(query.pageSize ?? 20, 100)        # silent cap
  isPub    = query.isPublished ?? true                  # default published-only
  tags     = query.tags ?? []

  qb = projects.createQueryBuilder("project")
    .leftJoinAndSelect("project.urls", "url")
    .where("project.is_published = :isPub", { isPub })
    .orderBy("project.created_at", "DESC")
    .skip((page - 1) * pageSize)
    .take(pageSize)
  if tags.length > 0:
    qb.andWhere("project.tags @> ARRAY[:...tags]", { tags })

  [rows, total] = await qb.getManyAndCount()
  return { data: rows.map(toResponse), total, page, pageSize }
```

### Pseudocode — `findOneBySlug(slug)`

```
findOneBySlug(slug):
  row = await projects.findOne({
    where: { slug, isPublished: true },                  # isPublished gate is HERE
    relations: { urls: true },
  })
  if (!row) throw new NotFoundException("Project not found")  # one body, no leak
  return toResponse(row)
```

### Pseudocode — `create(dto, userId)`

```
create(dto, userId):
  existing = await projects.findOne({ where: { slug: dto.slug }, select: { id: true } })
  if (existing) throw new ConflictException("Slug already in use")
  return withRetry(() => dataSource.transaction(async (manager) => {
    project = manager.create(ProjectEntity, { title, slug, description, content, coverImage, tags, isPublished })
    saved   = await manager.save(project)
    if (dto.urls && dto.urls.length) {
      await manager.insert(ProjectUrlEntity, dto.urls.map((u) => mapToRow(saved.id, u)))
    }
    return toResponse(saved)
  })).catch((e) => {
    if (e?.code === "23505" && /slug/.test(e?.message ?? ""))  # unique-violation race
      throw new ConflictException("Slug already in use")
    throw e
  })
```

### Pseudocode — `update(id, dto, userId)`

```
update(id, dto, userId):
  return withRetry(() => dataSource.transaction(async (manager) => {
    row = await manager.findOne(ProjectEntity, { where: { id }, relations: { urls: true } })
    if (!row) throw new NotFoundException("Project not found")
    if (dto.slug && dto.slug !== row.slug) {
      coll = await manager.findOne(ProjectEntity, { where: { slug: dto.slug }, select: { id: true } })
      if (coll && coll.id !== id) throw new ConflictException("Slug already in use")
      row.slug = dto.slug
    }
    Object.assign(row, pickDefined(dto, ["title", "description", "content", "coverImage", "tags", "isPublished"]))
    await manager.save(row)
    if ("urls" in dto) {                                       # field-absent vs empty-array
      await applyProjectUrlsDiff(id, dto.urls ?? [], manager)
    }
    return toResponse(row)
  })).catch((e) => {
    if (e?.code === "23505" && /slug/.test(e?.message ?? ""))
      throw new ConflictException("Slug already in use")
    throw e
  })
```

### Pseudocode — `remove(id)`

```
remove(id):
  result = await projects.delete({ id })                       # ON DELETE CASCADE cleans urls
  if (result.affected === 0) throw new NotFoundException("Project not found")
```

### Pseudocode — `applyProjectUrlsDiff` (ADR-1 core)

```
applyProjectUrlsDiff(projectId, desired, manager):
  existing   = await manager.find(ProjectUrlEntity, { where: { projectId } })
  existingBy = new Map(existing.map((r) => [`${r.title}|${r.url.toLowerCase()}`, r]))
  desiredBy  = new Map(desired.map((d) => [`${d.title}|${d.url.toLowerCase()}`, d]))
  toInsert   = desired.filter((d) => !existingBy.has(`${d.title}|${d.url.toLowerCase()}`))
  toDelete   = existing.filter((r) => !desiredBy.has(`${r.title}|${r.url.toLowerCase()}`))
  if (toInsert.length) await manager.insert(ProjectUrlEntity, toInsert.map((u) => mapToRow(projectId, u)))
  if (toDelete.length) await manager.delete(ProjectUrlEntity, toDelete.map((r) => r.id))
```

## Global Exception Filter

`src/common/filters/all-exceptions.filter.ts` — `@Catch()` (no args,
catches everything). Wired in `main.ts` AFTER `useGlobalPipes` and the
CORS / Swagger / cookie-parser setup, so it is the last word on the
body. The filter does **not** register via `APP_FILTER` because
`bootstrap-api-config` chose `useGlobalPipes`/`enableCors`/`setup` —
staying in the same function-call style keeps the bootstrap diff small.

```ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly config: ConfigService<EnvConfig>,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string; user?: { id: string } }>();
    const res = ctx.getResponse();
    const isProd = this.config.get("NODE_ENV", { infer: true }) === "production";
    const path = req.originalUrl ?? req.url ?? "";
    const requestId = (req as { id?: string }).id;

    // 1. Build the envelope.
    let statusCode: number;
    let error: string;
    let message: string | string[];
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const r = exception.getResponse();
      const obj = typeof r === "string" ? { message: r } : (r as Record<string, unknown>);
      error   = (obj.error as string) ?? STATUS_LABELS[statusCode] ?? "Error";
      message = (obj.message as string | string[]) ?? exception.message;
    } else {
      statusCode = 500;
      error   = "Internal Server Error";
      message = isProd ? "Internal server error" : (exception as Error)?.message ?? "Unknown error";
    }

    // 2. Server-side log for 5xx OR raw Error.
    if (statusCode >= 500 || !(exception instanceof HttpException)) {
      this.logger.error({
        requestId,
        userId: req.user?.id,
        method: req.method,
        path,
        message: (exception as Error)?.message,
        stack:   (exception as Error)?.stack,
      });
    }

    // 3. Emit the body — canonical envelope, exact key order.
    const body = { statusCode, error, message, timestamp: new Date().toISOString(), path };
    this.httpAdapterHost.httpAdapter.reply(res, body, statusCode);
  }
}
```

Wired in `main.ts`:

```ts
const httpAdapterHost = app.get(HttpAdapterHost);
app.useGlobalFilters(new AllExceptionsFilter(httpAdapterHost, app.get(ConfigService<EnvConfig>)));
```

The `STATUS_LABELS` map mirrors Nest's default labels
(`{ 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
404: "Not Found", 409: "Conflict", 500: "Internal Server Error" }`).

The request-id middleware (`src/common/middleware/request-id.middleware.ts`)
runs before the filter; the filter never has to generate one.

## Swagger Annotations

| Route | `@ApiTags` | `@ApiOperation` summary | `@ApiBearerAuth` | Other |
|---|---|---|---|---|
| `GET /projects` | class-level | `List public projects (paginated, filterable)` | — | `@ApiQuery` for `page`, `pageSize`, `tags`, `isPublished`; `@ApiResponse({ status: 200, type: ListProjectsResponseDto })`; `@ApiResponse({ status: 400 })` for bad query. |
| `GET /projects/:slug` | class-level | `Get a published project by slug` | — | `@ApiResponse({ status: 200, type: ProjectResponseDto })`; `@ApiResponse({ status: 404 })`. |
| `POST /projects` | class-level | `Create a new project` | ✓ | `@ApiBody({ type: CreateProjectDto })`; `@ApiResponse({ status: 201, type: ProjectResponseDto })`; `@ApiResponse({ status: 400 })`; `@ApiResponse({ status: 401 })`; `@ApiResponse({ status: 409 })`. |
| `PATCH /projects/:id` | class-level | `Update a project (DIFF urls, partial body)` | ✓ | `@ApiBody({ type: UpdateProjectDto })`; `@ApiResponse({ status: 200, type: ProjectResponseDto })`; `@ApiResponse({ status: 400 })`; `@ApiResponse({ status: 401 })`; `@ApiResponse({ status: 404 })`; `@ApiResponse({ status: 409 })`. |
| `DELETE /projects/:id` | class-level | `Delete a project (cascades to project_urls)` | ✓ | `@ApiResponse({ status: 204 })`; `@ApiResponse({ status: 401 })`; `@ApiResponse({ status: 404 })`. |

`@ApiTags('projects')` is on the class. The 3 protected handlers also
carry `@UseGuards(JwtAuthGuard)`. The `@ApiResponse` status codes are
the spec-locked outcomes — 4xx/5xx body shape is the canonical envelope
(filter handles it; no per-route override).

## Test Strategy

### Unit (colocated `*.spec.ts`)

| File | What it covers | Mocking |
|---|---|---|
| `src/projects/entities/project.entity.spec.ts` | `@Entity('projects')`; columns (id, title, slug, description, content, coverImage, tags, isPublished, createdAt, updatedAt); `slug unique: true`; `isPublished default false`; `tags` is `text[]`; one-to-many to `ProjectUrlEntity`; `@CreateDateColumn`/`@UpdateDateColumn` named `created_at`/`updated_at`. | `getMetadataArgsStorage()` — no DB. |
| `src/projects/entities/project-url.entity.spec.ts` | `@Entity('project_urls')`; columns; `ManyToOne` to `ProjectEntity`; `JoinColumn` named `project_id`; `onDelete: 'CASCADE'`. | Same. |
| `src/projects/dto/create-project.dto.spec.ts` | happy path; missing `title` → rejects; missing `slug` → rejects; bad `slug` format → rejects; bad `coverImage` URL → rejects; bad `tags` type → rejects; `urls` with duplicate `url` value → rejects; `urls` with bad nested URL → rejects; unknown field → rejects (`forbidNonWhitelisted`); empty `urls` accepted. | `validate(dto)` against the class with the global pipe options (mirror `test/bootstrap.e2e-spec.ts` pattern). |
| `src/projects/dto/update-project.dto.spec.ts` | every field optional; `urls: []` accepted; `urls: undefined` accepted; `urls` with duplicate `url` rejects. | Same. |
| `src/projects/dto/list-projects-query.dto.spec.ts` | `?page=2&pageSize=5` → `{ page: 2, pageSize: 5 }`; `?tags=react&tags=nestjs` → `["react", "nestjs"]`; `?tags=react,nestjs` → `["react", "nestjs"]`; `?tags=` (empty) → `[]`; `?pageSize=500` is accepted by the DTO (`@Max(100)` would reject — design uses service-level silent cap instead, see below). | Same. |
| `src/projects/projects.service.spec.ts` | `findPublic` — defaults (`isPublished: true`, `page: 1`, `pageSize: 20`); `tags` filter emits `tags @> ARRAY[...]`; `pageSize > 100` silently clamped; envelope `{ data, total, page, pageSize }` shape. `findOneBySlug` — returns project when `isPublished: true`; throws 404 on missing; throws 404 on `isPublished: false` (no existence leak). `create` — slug pre-check throws 409; happy path persists project + urls in a transaction; `QueryFailedError("23505")` rethrows 409. `update` — DIFF algorithm: insert added, delete removed, no-op on matches, `urls: []` removes all, `urls` absent leaves rows untouched; slug collision throws 409; missing project throws 404. `remove` — cascade to urls (mocked `manager.delete`); 404 on missing. | Fake repositories via `getRepositoryToken`; fake `dataSource.transaction(async (m) => m)` to capture the manager; `manager.create`, `manager.save`, `manager.insert`, `manager.delete`, `manager.find` are jest.fn(). |
| `src/projects/projects.controller.spec.ts` | 5 routes; status codes; guard on the 3 protected methods (mirror `auth.controller.spec.ts`); Swagger padlock assertions. | `Test.createTestingModule` with controller + service + fake repos; `supertest` against the app. |
| `src/common/filters/all-exceptions.filter.spec.ts` | `HttpException(NotFoundException)` → canonical envelope; `HttpException(BadRequestException)` from ValidationPipe → canonical envelope with array message; raw `Error` in production → sanitized 500; raw `Error` in development → envelope with original `message`; `req.id` and `req.user.id` included in the log context for 5xx; no stack in any body; the `timestamp` is a valid ISO-8601 string; the `path` matches `req.originalUrl`. | `httpAdapterHost.httpAdapter.reply` is a `jest.fn()` capturing the body; `Logger` is replaced with a stub. |
| `src/common/middleware/request-id.middleware.spec.ts` | Inbound `x-request-id: abc-123` → `req.id === "abc-123"`; missing header → UUID generated; bad header (e.g. with `<`) → UUID generated; response header `x-request-id` echoes the value. | Plain function call. |

### E2E (`test/projects.e2e-spec.ts` — new)

`process.env` stubbed at the top per `test/auth.e2e-spec.ts:1-12`.
`@nestjs/typeorm` mocked the same way
(`test/auth.e2e-spec.ts:15-26`). `Test.createTestingModule` builds
the full app (`ProjectsModule` + the two repos + the global pipe +
`useGlobalFilters(new AllExceptionsFilter(...))`). `supertest` drives
the HTTP surface. A `JwtService` is instantiated with the test secret
to mint bearer tokens for the protected cases (mirror
`test/auth.e2e-spec.ts:342-350`).

Scenarios (per spec, in this order):

1. `GET /api/v1/projects` — 200 + envelope `{ data: [], total: 0, page: 1, pageSize: 20 }` (empty DB).
2. `GET /api/v1/projects?tags=react&tags=nestjs` — service called with `tags: ["react", "nestjs"]` and the `@>` SQL fragment in the captured query.
3. `GET /api/v1/projects?isPublished=false` — overrides the public default.
4. `GET /api/v1/projects?page=2&pageSize=10` — pagination math.
5. `GET /api/v1/projects?pageSize=500` — silently clamped to 100; `pageSize === 100` in the response.
6. `GET /api/v1/projects/portfolio-app` — 200 (with `isPublished: true` row in fake repo).
7. `GET /api/v1/projects/does-not-exist` — 404 with canonical envelope.
8. `GET /api/v1/projects/draft-idea` (row exists with `isPublished: false`) — 404 with the **same** envelope body shape as #7 (no existence leak).
9. `POST /api/v1/projects` without `Authorization` → 401.
10. `POST /api/v1/projects` with bearer + valid body → 201 + project body; fake repo `insert` called with project row + N url rows in one `manager.transaction`.
11. `POST /api/v1/projects` with bearer + duplicate `slug` → 409.
12. `POST /api/v1/projects` with bearer + duplicate `url` in `urls` → 400 (DTO-level).
13. `POST /api/v1/projects` with bearer + unknown field → 400 (`forbidNonWhitelisted`).
14. `PATCH /api/v1/projects/:id` without bearer → 401.
15. `PATCH /api/v1/projects/:id` with bearer + `urls: [{new}]` → 200; fake `manager.insert` called once, `manager.delete` called zero times.
16. `PATCH /api/v1/projects/:id` with bearer + `urls: []` → 200; fake `manager.delete` called for both existing rows.
17. `PATCH /api/v1/projects/:id` with bearer + `urls` absent → 200; no `manager.insert` or `manager.delete` called.
18. `DELETE /api/v1/projects/:id` without bearer → 401.
19. `DELETE /api/v1/projects/:id` with bearer + existing id → 204; `projects.delete` called.
20. `DELETE /api/v1/projects/:id` with bearer + unknown id → 404.
21. Filter shape — any `HttpException` renders `{ statusCode, error, message, timestamp, path }`; 5xx body is sanitized; 5xx log entry includes `requestId`, `userId`, `method`, `path`.

### Real DB

**Deferred.** The E2E harness stubs `DATABASE_URL` and mocks
`@nestjs/typeorm`; the unit suite uses fake repositories. Real
Postgres fixtures (e.g. via `better-sqlite3` or a dockerised PG) are
explicitly out of scope per the proposal. A follow-up change adds a
docker-compose fixture and a real-DB E2E subset.

## Chained PRs Split (4 PRs)

Total forecast: **~670 LOC additions + ~30 LOC deletions** (the stub
controller, stub service, and stub DTOs are replaced). Each PR is
well under the 400-line review budget; no further split is needed.

| # | PR title (conventional commit) | Files added / modified | Depends on | Test scope | Verification gate | Merge target |
|---|---|---|---|---|---|---|
| 1 | `feat(projects): entities + global exception filter + DataSource` | `+ src/projects/entities/project.entity.ts` (REPL stub) `+ src/projects/entities/project-url.entity.ts` (new) `+ src/projects/entities/project.entity.spec.ts` (new) `+ src/projects/entities/project-url.entity.spec.ts` (new) `+ src/common/filters/all-exceptions.filter.ts` (new) `+ src/common/filters/all-exceptions.filter.spec.ts` (new) `+ src/common/middleware/request-id.middleware.ts` (new) `+ src/common/middleware/request-id.middleware.spec.ts` (new) `M src/data-source.ts` (+2 entities) `M src/main.ts` (+`useGlobalFilters` + `RequestIdMiddleware.use`) `M src/config/env.config.ts` (+`NODE_ENV` Joi key + interface) `M src/app.module.spec.ts` (extend guard-rail) `M src/main.spec.ts` (assert filter + middleware are wired) | — | Unit (entities, filter, middleware) + bootstrap e2e (smoke check) | `npm run lint && npm test && npm run build && npm run test:e2e` | `stacked-to-main` (recommendation) |
| 2 | `feat(projects): DTOs + service + controller + Swagger` | `+ src/projects/dto/create-project.dto.ts` (REPL stub) `+ src/projects/dto/update-project.dto.ts` (REPL stub — already wraps `PartialType`) `+ src/projects/dto/list-projects-query.dto.ts` (new) `+ src/projects/dto/project-url.dto.ts` (new) `+ src/projects/dto/project-url-response.dto.ts` (new) `+ src/projects/dto/project-response.dto.ts` (new) `+ src/projects/dto/list-projects-response.dto.ts` (new) `+ src/projects/dto/validators/is-unique-url-in-array.validator.ts` (new) `+ src/projects/dto/create-project.dto.spec.ts` (new) `+ src/projects/dto/update-project.dto.spec.ts` (new) `+ src/projects/dto/list-projects-query.dto.spec.ts` (new) `+ src/projects/projects.service.ts` (REPL stub) `+ src/projects/projects.service.spec.ts` (REPL stub) `+ src/projects/projects.controller.ts` (REPL stub) `+ src/projects/projects.controller.spec.ts` (REPL stub) `+ src/projects/projects.module.ts` (add `TypeOrmModule.forFeature([...])`) | PR1 | Unit (DTOs + service + controller) | `npm run lint && npm test && npm run build` | `stacked-to-main` |
| 3 | `test(projects): e2e coverage of the 5 routes + filter shape` | `+ test/projects.e2e-spec.ts` (new, ~21 scenarios) `M test/jest-e2e.json` (no change — already matches `*.e2e-spec.ts`) | PR2 | E2E (the new file) | `npm run lint && npm test && npm run build && npm run test:e2e` | `stacked-to-main` |
| 4 | `docs(projects): README endpoints table + error response shape` | `M README.md` (add projects table + error shape subsection) | PR3 | None | `npm run lint && npm run build` (no test changes) | `stacked-to-main` |

**LOC budget per PR (additions + deletions, rounded):**

- PR1: ~200 LOC (entity metadata + filter + middleware + 4 spec files + bootstrap glue).
- PR2: ~300 LOC (5 DTOs + validator + service + controller + 4 spec files + module wire).
- PR3: ~150 LOC (1 e2e spec file).
- PR4: ~20 LOC (1 doc file).

**Dependency diagram:**

```
PR1 (foundation) ──► PR2 (domain) ──► PR3 (e2e) ──► PR4 (docs)
   📍                       📍             📍           📍
```

**Merge strategy recommendation (NOT a lock):** `stacked-to-main`. Each
PR targets `main` directly with `[WIP]` prefix on the first three and
relies on a tight CI gate (the `&&` chain in the verification column)
to keep `main` green between merges. The orchestrator will re-confirm
this with the user at `sdd-apply` per the chained-pr skill's
"Execution Steps 2 — ask for a chain strategy when none is cached".

**Why not `feature-branch-chain` (tracker PR)?** The 4 PRs are
self-contained and can each land to `main` without breaking the
previous one. PR1 lands with the filter + entities — the rest of the
app still works because the existing controllers haven't changed
(only `main.ts` and `data-source.ts` have new wiring). PR2 lands
the DTOs + service + controller; the previous PR's filter is already
shipping 4xx/5xx uniformly. PR3 is e2e-only. PR4 is docs. A tracker
PR would add a no-merge target that gates 3 follow-on PRs for no
real reason.

## DBML Implications

**The DBML MUST change in two places**, both as part of the PR1 + a
follow-up archive mirror:

1. `projects.tags` — `varchar[]` → `text[]`
   (line 19). TypeORM emits `text[]`; matching the DBML is the
   "single source of truth" rule from `bootstrap-api-config` ADR-1.

2. New `Indexes` block on `projects` (after line 22):

   ```
   Indexes {
     (lower(slug)) [name: 'idx_projects_slug_lower']
     (tags) [name: 'idx_projects_tags_gin', type: 'gin']
   }
   ```

   The first is a case-insensitive read optimisation (see §TypeORM Data
   Model above). The second supports the `@>` array-contains operator
   from ADR-3.

3. The FK from `project_urls.project_id` to `projects.id` is declared
   in the DBML (line 27) WITHOUT `onDelete: 'CASCADE'` syntax — DBML's
   default behaviour is RESTRICT, not CASCADE. To match the TypeORM
   relation, the DBML line is updated to:

   ```
   project_id uuid [ref: > projects.id, not null, note: 'ON DELETE CASCADE']
   ```

   (DBML 5.x does not have a `delete: cascade` setting on the ref
   itself; the canonical way to express intent is a `note` plus a
   follow-up `typeorm migration:generate` that emits the constraint
   with `ON DELETE CASCADE`. The migration is part of PR1 — see
   §Migration Plan.)

The `users`, `reviews`, `review_comments`, `contacts`, and
`refresh_tokens` tables are unchanged.

## Migration Plan

**Yes — this change needs a TypeORM migration.** `synchronize: false`
in `data-source.ts:19` means the schema in any environment is NOT
auto-mutated by entity metadata; the DBML delta has to land in the
DB. The migration:

- File: `src/database/migrations/<timestamp>-projects-domain.ts`
  (the directory is new — `data-source.ts:18` has `migrations: []`
  which is updated to point at `src/database/migrations/*.ts`).
- Contents (sketch): `CREATE TABLE projects (...)`, `CREATE TABLE
  project_urls (...)` with `FOREIGN KEY (project_id) REFERENCES
  projects(id) ON DELETE CASCADE`, `CREATE INDEX idx_projects_slug_lower
  ON projects (LOWER(slug))`, `CREATE INDEX idx_projects_tags_gin ON
  projects USING GIN (tags)`, and a backfill step (no-op — the
  tables are empty in any environment that has not yet shipped the
  change).

**Generation timing:** the migration file is **generated in PR1**
using `typeorm migration:generate` against the canonical DBML
(applied to a throwaway Postgres via docker-compose; that
infrastructure is set up in PR1 and is the only piece of new tooling
in this change). The file is checked in alongside the entities, so
PR1 ships the schema + the entities + the filter together.

**Verification:** the bootstrap E2E test (existing
`test/bootstrap.e2e-spec.ts`) is extended in PR1 with a single
smoke check that asserts the migration file is listed in
`AppDataSource.options.migrations` and that the migration's
`up()` is a non-empty string (a no-op would catch a bad
`typeorm migration:generate` run).

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Global filter leaks stack/message in 5xx. | Med | The filter unit spec (`all-exceptions.filter.spec.ts`) asserts the production body is the exact generic envelope and the dev body has the original `message` but no `stack`. The bootstrap E2E (`test/bootstrap.e2e-spec.ts`) gains a smoke check that a `throw new Error('postgres ECONNREFUSED')` from a test-only controller renders the sanitized 500. The `app.module.spec.ts` guard-rail (line 143-156) is extended to assert the filter is wired in `main.ts` and not registered as a global provider. |
| `@nestjs/typeorm` mock in `test/auth.e2e-spec.ts:15-26` is brittle if a future change adds a TypeORM call before the test module is built. | Low | The projects E2E uses the same pattern; the global filter is a plain class, not DI-dependent, so `useGlobalFilters(new AllExceptionsFilter(...))` works inside the test module. |
| `tags @> ARRAY[:...tags]` parameter binding fails because TypeORM 1.x changes the array parameter syntax. | Low | The service spec exercises a captured `qb.andWhere` call with the exact `tags: ["react"]` parameter shape; the E2E asserts the controller returns 200 with the expected envelope (the SQL is captured by the fake query builder, not run against a real DB). |
| `forbidNonWhitelisted` rejects a `PATCH` body that contains a legitimate field absent from `UpdateProjectDto` (e.g. `coverImage` not in the DTO because of a typo). | Low | DTO spec covers every field with a happy-path + missing-field case. ADR-1 commits "field absent = no change" so a client that omits `urls` is not punished. |
| Chained PRs: PR1 lands the filter, the rest of the app starts rendering through it; an auth-domain 401/400 regression slips in. | Med | The bootstrap E2E is extended in PR1 to assert the existing 400 (`forbidNonWhitelisted`) and the existing 401 (auth e2e) both render through the new filter with the canonical envelope. The auth e2e (`test/auth.e2e-spec.ts`) is unchanged but its 401 assertions are upgraded to assert the envelope shape (single-line change in PR1). |
| The `+id` numeric coercion on the stub controller is copied into a future write method by a contributor who pattern-matches the stub. | Low | Stub controller is fully replaced in PR2; the `M src/projects/projects.controller.ts` diff is the full file, not a partial edit. A one-line comment on the `:id` param in the new controller warns that `:id` is a uuid. |
| `project_urls` DIFF race — a concurrent PATCH from another admin between read and write loses data. | Low | Wrap the diff+apply in `manager.transaction` with retry on `40001`/`40P01` (ADR-4). The unit spec covers the happy path; the race itself is documented in the proposal's risk table. |
| Pre-existing 8 unused-DTO-param lint errors in `src/{auth,contact,projects,reviews}/*.service.ts` linger. | Low | Projects service is rewritten with real DTO usage so its 2 errors resolve. Auth/Reviews/Contact stay untouched — flagged in the verify report so the next domain change knows. |
| DBML `varchar[]` → `text[]` delta breaks an existing environment that has rows with a `varchar(255)`-bound tags column. | Low | No environment has data yet (`synchronize: false`, no prior migration). The DBML delta is shipped with the first migration in PR1; the column is created as `text[]` from day one. |
| Custom `IsUniqueUrlInArray` validator has a behaviour drift from `class-validator`'s default error shape (`ValidationPipe` returns an array of messages). | Low | The validator's `defaultMessage()` returns a string; the pipe aggregates it into the standard `string[]` shape. The DTO spec asserts the `message` is a non-empty array containing the validator's default. |

## Open Questions for the Apply Phase

None blocking. All 7 architectural open points from the orchestrator
are resolved by the ADRs above. Two quality-of-implementation
clarifications for `sdd-apply`:

1. **`isPublished` column default on TypeORM** — should it be
   declared `@Column({ ..., default: false })` (TypeORM emits
   `DEFAULT false` in the CREATE TABLE) or rely on the Postgres
   column default from the DBML? The auth-domain precedent is
   `default: false` in the decorator. The migration will emit the
   DDL based on the decorator, so applying `default: false` is
   the safer choice. Confirm during PR1.

2. **Timestamps on the new entities** — `UserEntity` uses
   `@CreateDateColumn` AND `@UpdateDateColumn`. The
   `ProjectEntity` follows the same pattern. The DBML has both
   `created_at` and `updated_at`. The migration will emit
   `DEFAULT now()` for both, then the TypeORM-side
   `@UpdateDateColumn` triggers on row update. No drift, but
   worth a one-line note in the apply log so the verify report
   catches it.
