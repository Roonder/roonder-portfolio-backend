# Tasks: Projects Domain CRUD + Global Exception Filter

> **Source artifacts**: `proposal.md`, `explore.md`, `specs/projects-domain/spec.md`,
> `specs/global-exception-filter/spec.md`, `design.md` (7 ADRs locked). This file
> breaks the design into reviewable work units grouped by PR, with strict
> RED-first TDD per `rules.apply.tdd: true`.

## Conventions

- **Strict TDD is ON.** Every code task lists RED → GREEN → refactor. Each task
  is a separate work-unit commit (one commit per task) per the
  `work-unit-commits` skill: tests stay next to the code they cover; docs go
  with the user-visible change.
- **Test commands**: unit `npm test`, e2e `npm run test:e2e`, build `npm run
  build`, lint `npm run lint`, format `npm run format`.
- **File conventions** (per `openspec/config.yaml > rules.apply.test_convention`):
  - Unit: `*.spec.ts` colocated next to the source under `src/`.
  - E2E: `test/*.e2e-spec.ts` (separate runner `test/jest-e2e.json`).
- **No new dependencies** — every package needed (`@nestjs/typeorm`,
  `@nestjs/swagger`, `class-validator`, `class-transformer`, `typeorm`, `pg`)
  is already installed.
- **No code + docs mix.** README lives in PR4 only. Tiniest docstring on a new
  class is fine.
- **Out-of-scope paths** (no task may edit them): `src/auth/**`,
  `src/contact/**`, `src/reviews/**`, `src/cli/**`, `src/app.module.ts` (only
  `app.module.spec.ts` is touched in PR1 to extend the static guard-rail),
  `openspec/specs/server_specs.md`, `openspec/specs/auth-domain/**`,
  `openspec/specs/api-bootstrap/**`, and any other file not explicitly listed
  in a task below.

## Review Workload Forecast

- Chained PRs recommended: Yes
- 400-line budget risk: Medium
- Total estimated changed lines: ~885
- Per-PR forecast:
  - PR1 foundation: ~315 lines
  - PR2 api-surface: ~400 lines
  - PR3 e2e: ~150 lines
  - PR4 readme: ~20 lines
- Decision needed before apply: No
- Decision needed (if Yes): n/a (user locked chained PRs on 2026-06-18)

**Forecast plain-text lines (sdd-tasks guard contract, literal)**:

```
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: Medium
```

**Risk note on PR2 (~400 LOC at the ceiling):** if any single task in PR2 grows
during apply, the orchestrator's Review Workload Guard re-validates at
`sdd-apply` start. If PR2's actual diff exceeds 400, sub-split per design
fallback: **PR2a** (DTOs + `@IsUniqueUrlInArray` validator) → **PR2b** (service
+ controller + module wire) → renumber PR3/PR4. A 5-PR chain is allowed as
an exception; it does not require re-running `sdd-tasks`, only a re-split at
apply.

## Chain strategy

- **Strategy**: `feature-branch-chain` (selected by the user on 2026-06-18).
- **Chosen interpretation**: **Interpretation B** — every child PR targets
  `domain/projects` directly. The "chain" is conceptual (PR order); the
  diff for each PR is reviewed against the current `domain/projects` HEAD.
- **Rationale** for B over A:
  1. The user explicitly said "Todo va a domain/projects!" (every PR goes to
     `domain/projects`).
  2. Removes a layer of branch management — no child-branch retargeting.
  3. The 4-PR split still keeps each PR's diff under 400 LOC; child branches
     add operational complexity without reducing review scope.
  4. The user still merges `domain/projects` → `main` once at the end.
- **Tracker branch**: `domain/projects` (already exists, tracking
  `origin/domain/projects`; HEAD `85d3001`).
- **PR work-branch naming** (local-only, cut from `domain/projects`):
  - `domain/projects/pr1-foundation`
  - `domain/projects/pr2-api-surface`
  - `domain/projects/pr3-e2e`
  - `domain/projects/pr4-readme`
- **PR targets**: every PR's `base` is `domain/projects`. Branches are kept
  local during implementation; the work-branches are deleted after each PR
  merges (the user only sees the merge to `domain/projects`).
- **Merge order**: PR1 → PR2 → PR3 → PR4, each merged to `domain/projects`
  in sequence. After PR4 lands, the user manually merges `domain/projects`
  → `main`.
- **Review budget**: 400 LOC per PR (hard ceiling). The orchestrator's Review
  Workload Guard re-validates at `sdd-apply` start.
- **Per-PR work-unit commits** follow the `work-unit-commits` skill — each
  commit self-contained, tests pass independently, conventional commits only,
  no AI attribution.

---

## PR1 — Foundation (entities + filter + middleware + DataSource + DBML + migration)

- **Branch**: `domain/projects/pr1-foundation` (cut from `domain/projects` HEAD)
- **Merges into**: `domain/projects` (Interpretation B)
- **Verification gate**: `npm run lint && npm test && npm run build &&
  npm run test:e2e`
- **LOC estimate**: ~315

### Task 1.1 — Add `ProjectEntity` TypeORM entity mirroring DBML

- **Files**: `src/projects/entities/project.entity.ts` (replaces stub),
  `src/projects/entities/project.entity.spec.ts` (new)
- **DBML ↔ entity map** (per design §TypeORM Data Model):
  `id uuid pk`, `title varchar not null`, `slug varchar unique not null`,
  `description text not null`, `content text nullable`, `cover_image
  varchar nullable`, `tags text[] nullable default ARRAY[]::text[]`
  (ADR-3), `is_published boolean default false`, `created_at`, `updated_at`;
  one-to-many `urls: ProjectUrlEntity[]`.
- **TDD**:
  - RED: write `project.entity.spec.ts` asserting
    `getMetadataArgsStorage().columns.filter(c => c.target ===
    ProjectEntity).map(c => c.propertyName)` contains all 10 columns;
    `slug` column has `unique: true`; `isPublished` defaults to `false`;
    `tags` column has `type: "text", array: true`. Run `npm test` — fails
    (entity is the 1-line stub).
  - GREEN: replace the stub with the decorators from design §TypeORM Data
    Model. Run `npm test` — passes.
  - Refactor: ensure `isPublished` column uses
    `default: false` per design Open Question #1.
- **Commit boundary**: ONE commit. Message:
  `feat(data): add Project entity mirroring DBML`.
- **Verification**: `npm test -- --testPathPattern=project.entity`.
- **LOC estimate**: ~80 (entity ~50 + spec ~30).

### Task 1.2 — Add `ProjectUrlEntity` TypeORM entity

- **Files**: `src/projects/entities/project-url.entity.ts` (new),
  `src/projects/entities/project-url.entity.spec.ts` (new)
- **DBML ↔ entity map**: `id uuid pk`, `project_id uuid ref > projects.id
  onDelete CASCADE` (ADR-1), `title varchar not null`, `url varchar not
  null`, `created_at`, `updated_at`. Use `@ManyToOne` with
  `onDelete: 'CASCADE'` and `@JoinColumn({ name: 'project_id' })`.
- **TDD**:
  - RED: write `project-url.entity.spec.ts` asserting FK column name is
    `project_id`, `@ManyToOne` target is `ProjectEntity`, and the FK
    `onDelete` is `'CASCADE'`. Run `npm test` — fails (no file).
  - GREEN: create the entity. Run `npm test` — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(data): add ProjectUrl entity with FK CASCADE`.
- **Verification**: `npm test -- --testPathPattern=project-url.entity`.
- **LOC estimate**: ~60 (entity ~30 + spec ~30).

### Task 1.3 — Register both entities in shared `AppDataSource`

- **Files**: `src/data-source.ts`
- **Change**: add `ProjectEntity, ProjectUrlEntity` to the explicit
  `entities: [...]` array (per ADR-7). Add a migrations glob
  `migrations: [join(process.cwd(), 'src/database/migrations/*.{ts,js}')]`
  to point at the directory Task 1.6 creates.
- **Commit boundary**: ONE commit (combine with Task 1.1 + 1.2? **No** —
  one commit per task). Message: `chore(data): register projects entities
  in AppDataSource`.
- **Verification**: `npm run build` resolves both entities.
- **LOC estimate**: ~10.

### Task 1.4 — DBML delta (3 changes)

- **Files**: `openspec/specs/database-schema.dbml`
- **Deltas** (per design §DBML Implications):
  1. `projects.tags` `varchar[]` → `text[]` (line 19, ADR-3).
  2. New `Indexes` block on `projects` (after line 22):
     `(lower(slug)) [name: 'idx_projects_slug_lower']` and
     `(tags) [name: 'idx_projects_tags_gin', type: 'gin']`.
  3. FK from `project_urls.project_id` → `projects.id`: add a `note:
     'ON DELETE CASCADE'` annotation (DBML 5.x has no inline
     `delete: cascade`; the migration in Task 1.5 emits the actual DDL).
- **TDD**: static — no Jest test. The migration in Task 1.5 and the
  service test in PR2 (Task 2.4) verify the runtime effect.
- **Commit boundary**: ONE commit. Message:
  `docs(dbml): tags→text[]; add CASCADE note + indexes`.
- **LOC estimate**: ~15.

### Task 1.5 — TypeORM migration for `projects` + `project_urls`

- **Files**: `src/database/migrations/<timestamp>-create-projects-and-project-urls.ts`
  (new directory + new file).
- **Generation**: run `npx typeorm migration:generate` against a throwaway
  Postgres (docker-compose) using the entities from Tasks 1.1 + 1.2. If CI
  cannot spin up Postgres, hand-write the migration with a header comment
  `// Verified against \`typeorm schema:log\` on YYYY-MM-DD.` and commit
  both the migration and the schema log.
- **Migration contents** (sketch):
  - `CREATE TABLE projects (...)` with `tags text[] NOT NULL DEFAULT
    '{}'::text[]`, `is_published boolean NOT NULL DEFAULT false`, slug
    unique, FK from project_urls in the next statement.
  - `CREATE TABLE project_urls (...)` with
    `FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE`.
  - `CREATE INDEX idx_projects_slug_lower ON projects (LOWER(slug));`
  - `CREATE INDEX idx_projects_tags_gin ON projects USING GIN (tags);`
  - No data backfill needed (no rows in any env).
- **TDD**:
  - RED: extend `test/bootstrap.e2e-spec.ts` with a smoke test asserting
    `AppDataSource.options.migrations` is a non-empty array and at least
    one migration has a non-empty `up()` string. Run `npm run test:e2e` —
    fails (`migrations: []`).
  - GREEN: create the migration file + update `data-source.ts` in Task
    1.3. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(db): add projects + project_urls migration with CASCADE + indexes`.
- **Verification**: `npm run test:e2e`; manual
  `npx typeorm migration:run` against a throwaway DB.
- **LOC estimate**: ~30.

### Task 1.6 — Add `AllExceptionsFilter` — HttpException path (RED → GREEN)

- **Files**: `src/common/filters/all-exceptions.filter.ts` (new),
  `src/common/filters/all-exceptions.filter.spec.ts` (new)
- **Spec** (`global-exception-filter/spec.md` Requirement: HttpException
  Renders the Canonical 4xx Envelope):
  - Body shape `{ statusCode, error, message, timestamp, path }`.
  - `timestamp` ISO-8601 at filter time.
  - `path` = `req.originalUrl`.
  - `error` derived from `HttpException.getResponse()`'s `error` field, or
    a `STATUS_LABELS` fallback (`{ 400: "Bad Request", 401: "Unauthorized",
    403: "Forbidden", 404: "Not Found", 409: "Conflict", 500: "Internal
    Server Error" }`).
  - `Content-Type: application/json` enforced.
  - No double-formatting: extract `getResponse()` as `{ message } | object`
    exactly once.
- **TDD**:
  - RED: write filter spec with 3 branches —
    `NotFoundException` → 404 + envelope,
    `BadRequestException` from ValidationPipe (string array `message`) →
    400 + envelope with `message: string[]`,
    `ConflictException` → 409 + envelope. Use a fake
    `httpAdapterHost.httpAdapter.reply = jest.fn()` to capture the body.
    Run `npm test` — fails (no filter file).
  - GREEN: implement the HttpException branch only (the raw `Error` branch
    is Task 1.7). Re-run — passes.
  - Refactor: extract `STATUS_LABELS` constant + `buildEnvelope(...)`
    helper.
- **Commit boundary**: ONE commit. Message:
  `feat(common): add AllExceptionsFilter HttpException branch`.
- **LOC estimate**: ~50 (filter ~25 + spec ~25).

### Task 1.7 — Add `AllExceptionsFilter` — raw Error path + prod/dev branch

- **Files**: extends `src/common/filters/all-exceptions.filter.ts` and
  `src/common/filters/all-exceptions.filter.spec.ts`.
- **Spec** (Requirement: Raw Error Renders a Sanitized 500 in Production):
  - Non-`HttpException` → 500 + envelope.
  - `NODE_ENV === "production"`: `message: "Internal server error"`,
    `error: "Internal Server Error"`, NO stack in body, NO
    `exception.message` leak.
  - `NODE_ENV !== "production"`: `message` is the raw
    `exception.message`; no `stack` field; canonical envelope preserved.
- **TDD**:
  - RED: extend filter spec with 2 branches — `NODE_ENV=production` +
    `throw new Error('postgres ECONNREFUSED on host 10.0.0.5:5432')` →
    500, body does NOT contain `postgres`, `ECONNREFUSED`, `10.0.0.5`,
    `stack`; `NODE_ENV=development` → 500, body `message` equals
    `'postgres ECONNREFUSED on host 10.0.0.5:5432'`. Run `npm test` —
    fails.
  - GREEN: add the raw-Error branch + the `isProd` lookup via injected
    `ConfigService<EnvConfig>`. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(common): filter sanitizes 5xx in production, full message in dev`.
- **LOC estimate**: ~40.

### Task 1.8 — Add `RequestIdMiddleware`

- **Files**: `src/common/middleware/request-id.middleware.ts` (new),
  `src/common/middleware/request-id.middleware.spec.ts` (new)
- **Spec** (ADR-6):
  - Reads inbound `x-request-id` header if present (length ≤ 128, must
    match `^[A-Za-z0-9_-]+$`).
  - Otherwise generates `crypto.randomUUID()`.
  - Attaches to `req.id` and echoes via response `x-request-id` header.
- **TDD**:
  - RED: middleware spec with 3 branches — inbound valid header → echoes;
    missing header → generates UUID; bad header (e.g. with `<`) → generates
    UUID. Run `npm test` — fails.
  - GREEN: implement. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(common): add request-id middleware for 5xx correlation`.
- **LOC estimate**: ~30 (middleware ~15 + spec ~15).

### Task 1.9 — Wire filter + middleware globally in `main.ts`

- **Files**: `src/main.ts`, `src/main.spec.ts` (extend).
- **Changes**:
  - `app.use(RequestIdMiddleware)` BEFORE the prefix call.
  - `app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost),
    app.get(ConfigService<EnvConfig>)))` AFTER the CORS / Swagger setup
    (so the filter is the last word on the body).
- **TDD**:
  - RED: extend `src/main.spec.ts` with two static-text assertions —
    `mainSource.toMatch(/useGlobalFilters\s*\(\s*new\s+AllExceptionsFilter/`
    and `mainSource.toMatch(/use\s*\(\s*RequestIdMiddleware/`. Run
    `npm test` — fails.
  - GREEN: wire in `main.ts`. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(main): wire AllExceptionsFilter and RequestIdMiddleware globally`.
- **Verification**: `npm run lint`, `npm test`, `npm run build`.
- **LOC estimate**: ~20.

### Task 1.10 — Add `NODE_ENV` to `EnvConfig` Joi schema + guard-rail

- **Files**: `src/config/env.config.ts`, `src/config/env.config.spec.ts`
  (new), `src/app.module.spec.ts` (extend), `src/main.spec.ts` (extend).
- **Changes**:
  - `EnvConfig` interface gains `NODE_ENV?: string`.
  - Joi key:
    `NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development')`.
  - `app.module.spec.ts` static guard-rail extended: assert no
    `APP_FILTER.*AllExceptionsFilter` is registered globally in
    `app.module.ts` (the filter is wired in `main.ts` via
    `useGlobalFilters`, not via `APP_FILTER` — this prevents accidental
    double-registration in a future change).
  - `main.spec.ts` and `bootstrap.e2e-spec.ts` process.env stubs gain
    `process.env.NODE_ENV = 'test'` (Jest default; keeps the filter's
    prod-vs-dev branch deterministic in unit tests).
- **TDD**:
  - RED: extend `app.module.spec.ts` with the no-`APP_FILTER` assertion.
    Run `npm test` — fails (env config has no `NODE_ENV` yet, Joi rejects).
  - GREEN: add the Joi key + interface field + stubs. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `chore(config): add NODE_ENV to EnvConfig Joi schema`.
- **LOC estimate**: ~10.

### PR1 summary

- 10 work-unit commits, each self-contained; `npm test` + `npm run build`
  green after each.
- Files created: 2 entities, 2 entity specs, filter, filter spec, middleware,
  middleware spec, 1 migration, 4 stub-replacement (entity, filter + spec +
  middleware = already counted; main.ts modified).
- Files modified: `src/data-source.ts`, `src/main.ts`, `src/config/env.config.ts`,
  `src/main.spec.ts`, `src/app.module.spec.ts`, `openspec/specs/database-schema.dbml`.
- LOC: ~315 (entity 80 + entity 60 + data-source 10 + DBML 15 + migration
  30 + filter 50 + filter 40 + middleware 30 + main 20 + env 10 = 345; some
  tasks include test files already; the spec file LOC varies).

---

## PR2 — API surface (DTOs + validator + service + controller + Swagger + module)

- **Branch**: `domain/projects/pr2-api-surface` (cut from `domain/projects`
  after PR1 merged)
- **Merges into**: `domain/projects`
- **Verification gate**: `npm run lint && npm test && npm run build`
- **LOC estimate**: ~400 (at the ceiling — see risk note above)

### Task 2.1 — DTOs + custom `@IsUniqueUrlInArray` validator

- **Files**:
  - `src/projects/dto/create-project.dto.ts` (replaces stub)
  - `src/projects/dto/update-project.dto.ts` (replaces stub;
    `PartialType(CreateProjectDto)` from `@nestjs/swagger`)
  - `src/projects/dto/list-projects-query.dto.ts` (new)
  - `src/projects/dto/project-url.dto.ts` (new)
  - `src/projects/dto/project-url-response.dto.ts` (new)
  - `src/projects/dto/project-response.dto.ts` (new)
  - `src/projects/dto/list-projects-response.dto.ts` (new)
  - `src/projects/dto/validators/is-unique-url-in-array.validator.ts` (new)
  - `src/projects/dto/create-project.dto.spec.ts` (new)
  - `src/projects/dto/update-project.dto.spec.ts` (new)
  - `src/projects/dto/list-projects-query.dto.spec.ts` (new)
- **Decorators** (per design §DTO Inventory):
  - `CreateProjectDto`: `title @IsString @IsNotEmpty @MaxLength(200)`;
    `slug @IsString @IsNotEmpty @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)`;
    `description @IsString @IsNotEmpty @MaxLength(500)`;
    `content @IsString @IsOptional @MaxLength(50_000)`;
    `coverImage @IsUrl({ require_protocol: true, protocols: ['http',
    'https'] }) @IsOptional`;
    `tags @IsArray @IsOptional @IsString({ each: true })
    @ArrayMaxSize(20) @Transform(({ value }) => [...new
    Set((value as string[]).map((t) => t.trim().toLowerCase()).filter(Boolean))])`;
    `isPublished @IsBoolean @IsOptional`;
    `urls @IsArray @IsOptional @ValidateNested({ each: true })
    @Type(() => ProjectUrlDto) @ArrayMaxSize(50)
    @IsUniqueUrlInArray()`.
  - `ListProjectsQueryDto`:
    `page @IsOptional @Type(() => Number) @IsInt @Min(1)`;
    `pageSize @IsOptional @Type(() => Number) @IsInt @Min(1)
    @Max(100)`; `tags @IsOptional @IsArray @IsString({ each: true })
    @Transform(({ value }) => Array.isArray(value) ? value :
    String(value).split(',').map(t => t.trim().toLowerCase()).filter(Boolean))`;
    `isPublished @IsOptional @Type(() => Boolean) @IsBoolean`.
  - `ProjectUrlDto`: `title @IsString @IsNotEmpty @MaxLength(100)`;
    `url @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
    @MaxLength(2048)`.
  - `ProjectResponseDto` + `ProjectUrlResponseDto` + `ListProjectsResponseDto`:
    plain classes with `@ApiProperty` for Swagger.
- **`@IsUniqueUrlInArray` validator** (ADR-2): custom decorator that
  normalises each `entry.url` to `lower(trim(url))` and rejects if any
  value appears twice. Async `false`. File colocated with DTOs under
  `src/projects/dto/validators/`.
- **TDD**:
  - RED: write specs for `CreateProjectDto` (happy path, missing `title`
    rejects, missing `slug` rejects, bad `slug` format rejects, bad
    `coverImage` URL rejects, bad `tags` type rejects, `urls` with
    duplicate `url` rejects, `urls` with bad nested URL rejects, unknown
    field rejects `forbidNonWhitelisted`, empty `urls` accepted),
    `UpdateProjectDto` (every field optional, `urls: []` accepted, `urls:
    undefined` accepted, `urls` with duplicate `url` rejects),
    `ListProjectsQueryDto` (`?page=2&pageSize=5` → `{ page: 2, pageSize:
    5 }`, `?tags=react&tags=nestjs` → `['react', 'nestjs']`,
    `?tags=react,nestjs` → `['react', 'nestjs']`, `?tags=` → `[]`).
    Run `npm test` — fails.
  - GREEN: implement all DTOs + validator. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(dto): add Projects DTOs and IsUniqueUrlInArray validator`.
- **Verification**: `npm test -- --testPathPattern='projects/dto'`.
- **LOC estimate**: ~140.

### Task 2.2 — `ProjectsService` skeleton (constructor + repo injection)

- **Files**: `src/projects/projects.service.ts` (replaces stub),
  `src/projects/projects.service.spec.ts` (replaces stub)
- **Changes**:
  - `@Injectable() class ProjectsService` with
    `@InjectRepository(ProjectEntity) private readonly projects:
    Repository<ProjectEntity>`,
    `@InjectRepository(ProjectUrlEntity) private readonly projectUrls:
    Repository<ProjectUrlEntity>`, `private readonly dataSource:
    DataSource` (ADR-4).
  - Stub spec asserts `ProjectsService` is constructible with fake repos
    + fake DataSource (mirror `src/app.module.spec.ts:65-86`).
- **TDD**:
  - RED: write a "skeleton" spec asserting the service is constructible
    with the 3 deps. Run `npm test` — fails (service is the stub).
  - GREEN: implement skeleton. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(projects): add ProjectsService skeleton with repo injection`.
- **Verification**: `npm test -- --testPathPattern=projects.service`.
- **LOC estimate**: ~20.

### Task 2.3 — `findPublic(query)` method

- **Files**: extends `src/projects/projects.service.ts` + spec.
- **Pseudocode** (per design): QueryBuilder with `leftJoinAndSelect('project.urls', 'url')`,
  `where is_published = :isPub` (default `true`), `orderBy created_at
  DESC`, `skip/take`, optional `andWhere("project.tags @>
  ARRAY[:...tags]")`. Returns
  `{ data: ProjectResponseDto[], total, page, pageSize }`. `pageSize` is
  silently capped at 100.
- **TDD**:
  - RED: extend service spec with 5 branches — defaults
    (`isPublished: true`, `page: 1`, `pageSize: 20`); `tags` filter
    emits `tags @> ARRAY[...]` (assert on captured QueryBuilder
    `andWhere` calls); `pageSize > 100` silently clamped; envelope shape
    matches spec; `?isPublished=false` override. Run `npm test` — fails.
  - GREEN: implement. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(projects): add findPublic with tags @> filter and pageSize cap`.
- **LOC estimate**: ~40.

### Task 2.4 — `findOneBySlug(slug)` method (no-existence-leak 404)

- **Files**: extends `src/projects/projects.service.ts` + spec.
- **Pseudocode**: `findOne({ where: { slug, isPublished: true },
  relations: { urls: true } })`; throw `NotFoundException('Project not
  found')` on either missing OR `isPublished: false` (same body for
  both — prevents existence leak).
- **TDD**:
  - RED: 3 branches — found with `isPublished: true` returns project;
    not found throws 404; found with `isPublished: false` throws 404
    (assert same body message as "not found"). Run `npm test` — fails.
  - GREEN: implement. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(projects): add findOneBySlug with no-existence-leak 404`.
- **LOC estimate**: ~25.

### Task 2.5 — `create(dto, userId)` method (slug pre-check + race catch)

- **Files**: extends `src/projects/projects.service.ts` + spec.
- **Pseudocode** (per design): slug pre-check via
  `findOne({ where: { slug }, select: { id: true } })` → throw
  `ConflictException('Slug already in use')` if exists. Else
  `withRetry(() => dataSource.transaction(async (manager) => { ... }))`
  persisting project + urls via `manager.create` / `manager.save` /
  `manager.insert`. Catch `QueryFailedError` with PG code `23505` and
  re-throw `ConflictException` (race path).
- **TDD**:
  - RED: 4 branches — happy path persists project + urls in a
    transaction (assert `dataSource.transaction` was called once with a
    function that calls `manager.create` + `manager.save` +
    `manager.insert` for the urls); pre-check on duplicate slug throws
    409; `QueryFailedError("23505")` re-throws 409; slug pre-check
    happens BEFORE the transaction (assert no
    `dataSource.transaction` call when pre-check throws). Run
    `npm test` — fails.
  - GREEN: implement. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(projects): add create with slug pre-check and 23505 race catch`.
- **LOC estimate**: ~30.

### Task 2.6 — `applyProjectUrlsDiff` private + `update(id, dto, userId)`

- **Files**: extends `src/projects/projects.service.ts` + spec.
- **Pseudocode** (ADR-1 + ADR-4):
  - `applyProjectUrlsDiff(projectId, desired, manager)`:
    `existing = manager.find(ProjectUrlEntity, { where: { projectId }
    })`; key by `${title}|${url.toLowerCase()}`; `toInsert` =
    desired not in existing; `toDelete` = existing not in desired;
    `manager.insert` / `manager.delete` accordingly.
  - `update(id, dto, userId)`:
    `withRetry(() => dataSource.transaction(async (manager) => { ...
    }))`; re-check slug uniqueness if `dto.slug` differs;
    `Object.assign(row, pickDefined(dto, [...]))`; if `"urls" in dto`
    (field-absent vs empty-array distinction per ADR-1), call
    `applyProjectUrlsDiff`. Same 23505 race-catch.
- **TDD**:
  - RED: 7 branches — DIFF inserts added rows; DIFF removes deleted
    rows; `urls: []` removes all; `urls` absent leaves rows untouched
    (assert no `manager.insert` or `manager.delete`); two urls
    sharing the same `url` rejected at DTO layer (covered in Task
    2.1's spec, but assert service is never called); slug collision
    on update throws 409; missing project throws 404. Run `npm test`
    — fails.
  - GREEN: implement. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(projects): add update with project_urls DIFF + slug race catch`.
- **LOC estimate**: ~50.

### Task 2.7 — `remove(id)` method

- **Files**: extends `src/projects/projects.service.ts` + spec.
- **Pseudocode**: `projects.delete({ id })`; 404 if `affected === 0`.
  Cascade to `project_urls` is via FK `onDelete: 'CASCADE'` (Task 1.2).
- **TDD**:
  - RED: 2 branches — happy delete (assert `projects.delete` called
    with `{ id }`); missing id throws 404. Run `npm test` — fails.
  - GREEN: implement. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(projects): add remove with 404 on missing`.
- **LOC estimate**: ~15.

### Task 2.8 — `ProjectsController` (5 routes + Swagger)

- **Files**: `src/projects/projects.controller.ts` (replaces stub),
  `src/projects/projects.controller.spec.ts` (replaces stub).
- **Routes** (per `server_specs.md` §3.2 + ADR-5):
  - `GET /projects` (public) — `@ApiQuery` for `page`, `pageSize`,
    `tags`, `isPublished`; `@ApiResponse({ status: 200, type:
    ListProjectsResponseDto })`; `@ApiResponse({ status: 400 })`.
  - `GET /projects/:slug` (public) — `@ApiResponse({ status: 200, type:
    ProjectResponseDto })`; `@ApiResponse({ status: 404 })`.
  - `POST /projects` (JwtAuthGuard + `@ApiBearerAuth()`) — `@ApiBody({
    type: CreateProjectDto })`; `@ApiResponse` for 201, 400, 401, 409.
  - `PATCH /projects/:id` (JwtAuthGuard + `@ApiBearerAuth()`) — note
    one-line comment that `:id` is uuid, not a number (the stub's `+id`
    bug is gone); `@ApiResponse` for 200, 400, 401, 404, 409.
  - `DELETE /projects/:id` (JwtAuthGuard + `@ApiBearerAuth()`) —
    `@HttpCode(204)`; `@ApiResponse` for 204, 401, 404.
  - Class-level `@ApiTags('projects')`.
- **TDD**:
  - RED: replace the stub spec with HTTP-shape assertions via
    supertest — 5 routes return the expected status + body shape;
    guard on the 3 protected methods (mirror `auth.controller.spec.ts`);
    Swagger JSON asserts `paths['/projects']` etc. Run `npm test` —
    fails (stub returns string placeholders).
  - GREEN: implement. Re-run — passes.
- **Commit boundary**: ONE commit. Message:
  `feat(controller): add ProjectsController with 5 routes + Swagger`.
- **Verification**: `npm test -- --testPathPattern=projects.controller`.
- **LOC estimate**: ~70.

### Task 2.9 — Wire `TypeOrmModule.forFeature` in `ProjectsModule`

- **Files**: `src/projects/projects.module.ts`, `src/app.module.spec.ts`
  (extend — provide fake repos for the new entities in the
  `TestFakesModule`).
- **Changes**:
  - `imports: [TypeOrmModule.forFeature([ProjectEntity,
    ProjectUrlEntity])]`.
  - `app.module.spec.ts` `TestFakesModule` adds the two new fake
    repository providers (`{ provide: getRepositoryToken(ProjectEntity),
    useValue: fakeProjectRepo }` and the same for
    `ProjectUrlEntity`).
- **TDD**:
  - RED: extend `app.module.spec.ts` with two static asserts —
    `projects.module.ts` source matches
    `TypeOrmModule\.forFeature\(\[ProjectEntity,\s*ProjectUrlEntity\]\)`,
    and the `TestFakesModule` in this test file provides both tokens
    (compile-fails without them when the module is composed). Run
    `npm test` — fails.
  - GREEN: add `TypeOrmModule.forFeature` + fake repos. Re-run —
    passes.
- **Commit boundary**: ONE commit. Message:
  `feat(module): register Project entities in ProjectsModule`.
- **LOC estimate**: ~10.

### PR2 summary

- 9 work-unit commits, ~400 LOC at the ceiling.
- Files: 7 DTO files, 1 validator, 3 DTO specs, 1 service (with 5
  method-extension commits), 1 controller, 1 controller spec, 1
  module wire, 1 spec file extension.
- **Hard ceiling alert**: if any single task grows by >20 LOC during
  apply, sub-split per design fallback (2a = DTOs + validator; 2b =
  service + controller; renumber PR3/PR4).

---

## PR3 — E2E tests

- **Branch**: `domain/projects/pr3-e2e` (cut from `domain/projects`
  after PR2 merged)
- **Merges into**: `domain/projects`
- **Verification gate**: `npm run lint && npm test && npm run build &&
  npm run test:e2e`
- **LOC estimate**: ~150
- **Harness**: `process.env` stubbed at the top of the file
  (`test/auth.e2e-spec.ts:1-12` pattern); `@nestjs/typeorm` mocked the
  same way (`test/auth.e2e-spec.ts:15-26`); `Test.createTestingModule`
  builds the full app with `ProjectsModule` + both repos + the global
  pipe + `useGlobalFilters(new AllExceptionsFilter(...))`; `supertest`
  drives the HTTP surface; a `JwtService` instantiated with the test
  secret mints bearer tokens for the protected cases.

### Task 3.1 — E2E harness + empty-list smoke

- **Files**: `test/projects.e2e-spec.ts` (new), `test/jest-e2e.json`
  (verify; no change expected).
- **Branches**:
  - `process.env` stub before imports (mirror `test/auth.e2e-spec.ts:1-12`).
  - `@nestjs/typeorm` mock (mirror `test/auth.e2e-spec.ts:15-26`).
  - `bootstrapTestApp` helper that builds the full app with the filter.
  - 1st test: `GET /api/v1/projects` → 200 + envelope
    `{ data: [], total: 0, page: 1, pageSize: 20 }`.
- **Commit boundary**: ONE commit. Message:
  `test(projects): e2e harness + empty-list smoke`.
- **LOC estimate**: ~30 (mostly the harness setup).

### Task 3.2 — Public list E2E (filters + pagination + cap)

- **Files**: extends `test/projects.e2e-spec.ts`.
- **Branches** (4 tests):
  1. `?tags=react&tags=nestjs` → service called with
     `tags: ["react", "nestjs"]` and the captured `andWhere` includes
     `@> ARRAY[:...tags]`.
  2. `?isPublished=false` → overrides the public default.
  3. `?page=2&pageSize=10` → envelope `page: 2, pageSize: 10`.
  4. `?pageSize=500` → silently clamped to 100.
- **Commit boundary**: ONE commit. Message:
  `test(projects): public list filters and pagination`.
- **LOC estimate**: ~30.

### Task 3.3 — Public detail by slug E2E (200 + 404 + no-leak)

- **Files**: extends `test/projects.e2e-spec.ts`.
- **Branches** (3 tests):
  1. `GET /portfolio-app` with `isPublished: true` → 200 + body.
  2. `GET /does-not-exist` → 404 with canonical envelope.
  3. `GET /draft-idea` with `isPublished: false` → 404 with the **same**
     envelope body shape as #2 (assert body field-by-field equality).
- **Commit boundary**: ONE commit. Message:
  `test(projects): public detail by slug with no-existence-leak 404`.
- **LOC estimate**: ~20.

### Task 3.4 — Admin CRUD E2E (401 + 201 + 409 + 200 + DIFF + 204)

- **Files**: extends `test/projects.e2e-spec.ts`.
- **Branches** (~8 tests, all JWT-signed with the test secret):
  1. `POST /projects` without bearer → 401.
  2. `POST /projects` with bearer + valid body → 201 + project body;
     fake repo `insert` called for the project + N url rows in one
     `dataSource.transaction`.
  3. `POST /projects` with bearer + duplicate `slug` → 409.
  4. `POST /projects` with bearer + duplicate `url` in `urls` → 400
     (DTO-level).
  5. `POST /projects` with bearer + unknown field → 400
     (`forbidNonWhitelisted`).
  6. `PATCH /projects/:id` without bearer → 401.
  7. `PATCH /projects/:id` with bearer + `urls: [{new}]` → 200; fake
     `manager.insert` called once, `manager.delete` zero times.
  8. `PATCH /projects/:id` with bearer + `urls: []` → 200; fake
     `manager.delete` called for both existing rows.
  9. `PATCH /projects/:id` with bearer + `urls` absent → 200; no
     `manager.insert` / `manager.delete` called.
  10. `DELETE /projects/:id` without bearer → 401.
  11. `DELETE /projects/:id` with bearer + existing id → 204;
      `projects.delete` called.
  12. `DELETE /projects/:id` with bearer + unknown id → 404.
- **Commit boundary**: ONE commit. Message:
  `test(projects): admin CRUD e2e covering 401/201/409/400/200/204`.
- **LOC estimate**: ~50.

### Task 3.5 — Global filter E2E (4xx envelope + 5xx sanitized)

- **Files**: extends `test/projects.e2e-spec.ts`.
- **Branches** (~3 tests, leveraging the projects routes that throw):
  1. `GET /does-not-exist` → 404 body shape is exactly
     `{ statusCode: 404, error: "Not Found", message: "Project not
     found", timestamp: <iso>, path: "/api/v1/projects/does-not-exist" }`.
  2. `POST /projects` with bearer + body that throws a raw `Error` (use
     a test-only controller that throws `new Error('postgres
     ECONNREFUSED on host 10.0.0.5:5432')` declared inline in the test
     file — same `__bootstrap_fixture` pattern, but named
     `__raw_error_fixture`) → 500, body does NOT contain `postgres`,
     `ECONNREFUSED`, `10.0.0.5`, `stack`.
  3. `x-request-id` is round-tripped: send a custom header in the
     request, assert the response carries the same value in
     `x-request-id` and (for 5xx) the log context includes it.
- **Commit boundary**: ONE commit. Message:
  `test(projects): e2e filter shape — 4xx envelope + 5xx sanitized`.
- **LOC estimate**: ~20.

### PR3 summary

- 5 work-unit commits, ~150 LOC, all in `test/projects.e2e-spec.ts`.
- No src/ changes; pure test additions.
- Real DB is explicitly out of scope (per design §Real DB) — the
  harness stubs `DATABASE_URL` and mocks `@nestjs/typeorm` the same
  way `test/auth.e2e-spec.ts` does.

---

## PR4 — README + dev seeds

- **Branch**: `domain/projects/pr4-readme` (cut from `domain/projects`
  after PR3 merged)
- **Merges into**: `domain/projects`
- **Verification gate**: `npm run lint && npm run build`
- **LOC estimate**: ~20

### Task 4.1 — `src/projects/README.md` + `README.md` updates

- **Files**: `src/projects/README.md` (new — domain-level readme with
  route table, error envelope shape, DIFF semantics, slug + tags
  normalization rules), `README.md` (top-level — add the same Projects
  endpoints table mirroring the auth table; add an "Error response
  shape" subsection documenting the canonical envelope `{ statusCode,
  error, message, timestamp, path }` and the prod-vs-dev branch).
- **TDD**: no test — pure documentation. Reviewed by the README's own
  internal cross-checks (route table matches the controller, error
  shape matches the filter spec).
- **Commit boundary**: ONE commit. Message:
  `docs(projects): README endpoints table + error response shape`.
- **LOC estimate**: ~20.

### Task 4.2 — Optional dev seed script

- **Files**: `src/database/seeds/projects.seed.ts` (new) — only if it
  fits the budget. If the seed script would push PR4 over 20 LOC, defer
  to a follow-up change and add a one-line `// TODO: dev seed` comment
  in `src/projects/README.md` instead.
- **Status**: **DEFERRED** — deferring per the risk note in
  `sdd-archive`'s follow-ups; the dev experience is adequate without a
  seed for v1 (Supabase can be populated manually or via the admin
  `POST` once a real admin is bootstrapped). This task is a
  placeholder; the implementation phase will only run it if budget
  allows.
- **LOC estimate**: ~0 (deferred).

### PR4 summary

- 1 work-unit commit (Task 4.2 is deferred).
- Files: `src/projects/README.md`, `README.md`.
- LOC: ~20.
- No code changes; `npm test` is not gated because no test changes.

---

## Cross-PR test strategy

**Unit (colocated `*.spec.ts`)** — listed in each task above. Key files:

| File | Covers | Lands in |
|------|--------|----------|
| `src/projects/entities/project.entity.spec.ts` | 10 columns, `slug unique`, `isPublished default`, `tags text[]` | PR1.1 |
| `src/projects/entities/project-url.entity.spec.ts` | FK + CASCADE | PR1.2 |
| `src/common/filters/all-exceptions.filter.spec.ts` | 4xx + 5xx + prod/dev | PR1.6 + PR1.7 |
| `src/common/middleware/request-id.middleware.spec.ts` | header in/out | PR1.8 |
| `src/projects/dto/create-project.dto.spec.ts` | happy + 9 reject branches | PR2.1 |
| `src/projects/dto/update-project.dto.spec.ts` | optional-everything | PR2.1 |
| `src/projects/dto/list-projects-query.dto.spec.ts` | query transforms | PR2.1 |
| `src/projects/projects.service.spec.ts` | 5 methods × spec branches | PR2.2–2.7 |
| `src/projects/projects.controller.spec.ts` | 5 routes + Swagger | PR2.8 |
| `src/config/env.config.spec.ts` (new) | NODE_ENV Joi key | PR1.10 |
| `src/main.spec.ts` (extend) | filter + middleware wired | PR1.9 |
| `src/app.module.spec.ts` (extend) | no APP_FILTER; fakes for new entities | PR1.10 + PR2.9 |

**E2E (`test/projects.e2e-spec.ts`)** — all 5 work-unit commits in
PR3. ~21 spec scenarios total, mirroring design §E2E.

**Repository mocking convention** (mirror `src/app.module.spec.ts:65-86`):
fake `Repository<T>` objects via `getRepositoryToken(Entity)` supplied
through a `@Global() TestFakesModule`. No real Postgres anywhere in
this change. A follow-up change adds a docker-compose fixture and a
real-DB E2E subset.

**Global filter in the test module** (per design): the E2E test
builds the app with `useGlobalFilters(new AllExceptionsFilter(
app.get(HttpAdapterHost), app.get(ConfigService<EnvConfig>)))` so the
envelope assertion in Task 3.5 hits the real filter, not a stub.

## Risk register

| Risk | Likelihood | Task-level mitigation |
|------|------------|------------------------|
| PR2 hits 400-line ceiling during apply. | High | Forecast risk = Medium. Sub-split fallback: PR2a (DTOs + validator), PR2b (service + controller + module). Re-number PR3/PR4. Allowed without re-running `sdd-tasks`. |
| Filter leaks stack/message in 5xx or breaks existing auth 401/400 shape. | Med | Filter spec covers 4xx + 5xx + prod/dev + log context (PR1.6/1.7). `test/bootstrap.e2e-spec.ts` smoke check in PR1.5 confirms the migration's `up()` is non-empty. `test/auth.e2e-spec.ts` 401 assertions are upgraded in PR1.9 to assert the canonical envelope (single-line change). |
| `getRepositoryToken` for the new entities is added to `AppDataSource` but the test harness mocks `@nestjs/typeorm` — every test module that instantiates `ProjectsModule` MUST provide fakes. | Med | `app.module.spec.ts` extension in PR2.9 adds fakes for both entities in `TestFakesModule`; `main.spec.ts` extension in PR2.9 does the same. Apply agent MUST keep the `TestFakesModule` global with the two new tokens. |
| Stub `+id` numeric coercion pattern is copied by a future contributor who pattern-matches the old controller. | Low | Controller is fully replaced in PR2.8; one-line comment on `:id` warns it is uuid. |
| `project_urls` DIFF race — concurrent `PATCH` between read and write loses data. | Low | `manager.transaction` + 3-retry on `40001`/`40P01` (ADR-4). Unit spec covers happy path; the race itself is documented in the proposal's risk table. |
| `forbidNonWhitelisted` rejects a legitimate PATCH body that has a typo on a field name. | Low | DTO spec covers every field (Task 2.1). ADR-1 commits "field absent = no change" so a client that omits `urls` is not punished. |
| Pre-existing 8 unused-DTO-param lint errors in `src/{auth,contact,reviews}/*.service.ts` linger. | Low | Projects service is rewritten with real DTO usage so its 2 errors resolve. Auth/Reviews/Contact stay untouched — flagged in the verify report. |
| DBML `varchar[]` → `text[]` delta breaks an existing environment that has rows. | Low | No environment has data yet (`synchronize: false`, no prior migration). DBML delta + migration in PR1 land together. |

## Next step

Hand this forecast + the 4-PR plan to the orchestrator. Per
`ask-always`-style flow with the user-locked chain decision: the
**decision needed before apply = No**, and the next phase is
`sdd-apply`. The orchestrator's Review Workload Guard re-validates
PR2 at apply start; if PR2's actual diff > 400, apply sub-splits
per the fallback above.

---

## Forecast summary

- **Total LOC**: ~885 across 4 PRs. Each PR under 400; PR2 at the
  ceiling.
- **Chain strategy locked**: `feature-branch-chain` (Interpretation B —
  all PRs target `domain/projects`).
- **Highest-risk PR**: PR2 (~400 LOC). Mitigation: sub-split fallback
  documented in the Review Workload Forecast.
- **Verification gates**:
  - PR1: lint + test + build + e2e
  - PR2: lint + test + build
  - PR3: lint + test + build + e2e
  - PR4: lint + build
- **Strict TDD ON** — every code task is RED → GREEN → refactor. PR4
  is docs-only (no RED step).
- **Risk-aware**: 8 risks catalogued, each with a per-task mitigation.
- **No new dependencies** required.

**Next step (per orchestrator gate)**: launch `sdd-apply` for
`projects-crud` with the 4-PR plan and Interpretation B.
