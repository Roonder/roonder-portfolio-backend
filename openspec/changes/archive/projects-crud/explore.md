# Exploration: projects-crud

## Goal

Build the Projects domain CRUD on top of the `bootstrap-api-config` and
`auth-domain` foundations. Public reads (list, detail) on `/api/v1/projects`
and `/api/v1/projects/:slug`; protected writes (create, update, delete) on
`POST /api/v1/projects`, `PATCH /api/v1/projects/:id`, and
`DELETE /api/v1/projects/:id` behind the existing `JwtAuthGuard`. Ship
TypeORM entities for `projects` and `project_urls`, the full DTO surface
(create / update / list-query / response with nested `project_urls`), and
a global exception filter so failures stop returning bare `500`s.

Source intent: `openspec/changes/projects-crud/description` (Spanish) and
`openspec/specs/server_specs.md` §3.2. Source schema:
`openspec/specs/database-schema.dbml` tables `projects` (lines 12-23) and
`project_urls` (lines 25-32).

## Current State

### What's already wired (foundations in place)

- **`api/v1` global prefix** is applied at `src/main.ts:19` via
  `app.setGlobalPrefix("api/v1")` (no `exclude` per ADR-6). Every
  controller declares its path without the prefix.
- **Global `ValidationPipe`** is registered in `src/main.ts:24-31` with
  `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true`,
  `transformOptions: { enableImplicitConversion: true }` per ADR-2.
  Body DTOs stay strict (no implicit string→number coercion); query/param
  DTOs MUST use `@Type(() => Number)` / `@Type(() => Date)` on numeric
  and date fields.
- **CORS function-callback** at `src/main.ts:44-59` echoes
  `FRONTEND_URL` only on matching origin, returns `false` otherwise.
- **Swagger** is mounted at `/api/v1/docs` (HTML) and
  `/api/v1/docs-json` (JSON). `addBearerAuth()` is registered globally
  in `src/main.ts:60-64`, so any future `@ApiBearerAuth()` on a
  controller plugs straight into the existing security scheme.
- **Auth foundation** (from `auth-domain` archive):
  - `JwtAuthGuard` lives at `src/auth/guards/jwt-auth.guard.ts`, extends
    `AuthGuard("jwt")` from `@nestjs/passport`. `validate()` returns
    `{ id, email }` from the JWT payload.
  - The guard is **per-controller / method-level** with
    `@UseGuards(JwtAuthGuard)` — NOT registered as a global `APP_GUARD`.
    `src/app.module.spec.ts:143-156` has a static guard-rail that
    asserts `app.module.ts` never registers it globally; this MUST stay
    green.
  - `JwtStrategy` validates `JWT_SECRET` via
    `ConfigService.get('JWT_SECRET', { infer: true })`. To exercise any
    protected route in tests, mint a token signed with the same secret.
- **DataSource wiring**: `src/data-source.ts` declares a shared
  `AppDataSource` with `synchronize: false` and the entity list
  `[UserEntity, RefreshTokenEntity]`. `src/app.module.ts:23-27` wires
  `TypeOrmModule.forRootAsync({ useFactory: () => AppDataSource.options })`
  so the runtime Nest app and the seed CLI consume the same config.
- **Test harness conventions** (from `bootstrap-api-config` and
  `auth-domain`):
  - Unit tests colocated as `*.spec.ts` next to source files
    (Jest `rootDir: src`, `testRegex: .*\.spec\.ts$`).
  - E2E tests live in `test/` (NOT `src/`) under `*.e2e-spec.ts` and
    use `test/jest-e2e.json`. The current e2e files are
    `test/bootstrap.e2e-spec.ts` (9 tests, all pass) and
    `test/auth.e2e-spec.ts`.
  - Every test that imports `ConfigModule` stubs `process.env` at the
    **very top** of the file, BEFORE imports (ES module hoisting trap —
    see `apply-progress.md` §"Design clarifications discovered" #3).
    Use `ConfigModule.forRoot({ ignoreEnvFile: true, ... })` inside
    `Test.createTestingModule` to avoid the real `.env` from leaking
    into the test.
  - The unit suite mocks `@nestjs/typeorm` entirely in
    `src/app.module.spec.ts:19-30` so no test opens a real Postgres
    connection. The current pattern is: build a `Test.createTestingModule`
    with the controller + service + a fake `{ provide:
    getRepositoryToken(Entity), useValue: fakeRepo }` for each entity,
    then drive it with `supertest` against the in-memory app.
  - Entity metadata is verified via `getMetadataArgsStorage()` (see
    `src/auth/entities/user.entity.spec.ts`).
- **Current `npm test` baseline**: 18/18 unit pass.
  **`npm run test:e2e` baseline**: 9/9 e2e pass.

### What's missing (the gap this change fills)

- **No `ProjectEntity` or `ProjectUrlEntity`**. The files exist as
  one-line stubs:
  - `src/projects/entities/project.entity.ts` is `export class Project {}`.
  - There is no `project-url.entity.ts` — the directory contains only
    `project.entity.ts`.
- **No `DataSource` registration** for the new entities. `src/data-source.ts:17`
  lists only `[UserEntity, RefreshTokenEntity]`. Even if the entities
  were created, TypeORM would not load them at runtime.
- **No DTO content**:
  - `src/projects/dto/create-project.dto.ts` is `export class CreateProjectDto {}`.
  - `src/projects/dto/update-project.dto.ts` is
    `PartialType(CreateProjectDto)` — it inherits an empty class, so
    every field is implicitly optional in the wrong way (it has zero
    fields). It will work once `CreateProjectDto` is filled, but
    `PartialType` from `@nestjs/swagger` is the right primitive
    (already in use by the auth response DTOs); no replacement needed.
- **Stub controller does not match the spec**:
  - `findOne` is `@Get(':id')` and the service signature is
    `findOne(id: number)` (uses `+id` numeric coercion).
  - The DBML `id` is `uuid`, not `number`. This is a bug carried from
    the original NestJS scaffold and must be corrected.
  - The spec routes are:
    `GET /api/v1/projects` (public, list),
    `GET /api/v1/projects/:slug` (public, detail),
    `POST /api/v1/projects` (protected),
    `PATCH /api/v1/projects/:id` (protected),
    `DELETE /api/v1/projects/:id` (protected).
    This is a **read-by-slug / write-by-id** split. The stub mixes
    everything through `:id` and `+id`.
- **Stub service methods return string placeholders** (`'This action
  adds a new project'`, etc.). They do not touch the database.
- **No `@UseGuards(JwtAuthGuard)`, no `@ApiTags`, no `@ApiOperation`,
  no `@ApiBearerAuth`** on the projects controller. The auth
  controller (`src/auth/auth.controller.ts:45, 99`) already uses the
  pattern — the projects change should mirror it.
- **No global exception filter**. `src/main.ts` registers pipes
  and middleware but no `useGlobalFilters(...)`. Search for
  `ExceptionFilter`, `HttpException`, `UseFilters`, `catch(` in
  `src/` returns zero matches. The user explicitly asked for
  "gestión de errores adecuada para no solo recibir códigos 500" —
  this gap is in-scope for this change.
- **No slug utility** (e.g. slugifier). Decisions on slug
  auto-generation vs. client-supplied are open.
- **No pagination utility** for the list endpoint. Decisions on
  page/limit shape are open.
- **No pre-existing test coverage of projects**. Only
  `should be defined` smoke tests in `projects.controller.spec.ts`
  and `projects.service.spec.ts`.

## Affected Areas

### Source files to create

- `src/projects/entities/project.entity.ts` (replace stub) — the
  `projects` TypeORM entity. Maps every column in
  `openspec/specs/database-schema.dbml:12-23` and the relation to
  `ProjectUrlEntity`.
- `src/projects/entities/project-url.entity.ts` (new) — the
  `project_urls` TypeORM entity per
  `openspec/specs/database-schema.dbml:25-32`.
- `src/projects/dto/create-project.dto.ts` (replace stub) — body for
  `POST /api/v1/projects`. Includes the nested `urls: ProjectUrlDto[]`.
- `src/projects/dto/update-project.dto.ts` (replace stub) — body for
  `PATCH /api/v1/projects/:id`. `PartialType(CreateProjectDto)` is
  the right primitive (already in use) but every field must remain
  optional and `urls` should support a "replace all" semantics
  (open question — see below).
- `src/projects/dto/list-projects-query.dto.ts` (new) — query string
  for `GET /api/v1/projects`. Per ADR-2, MUST use
  `@Type(() => Number)` on numeric fields and `@IsOptional()` on
  every field.
- `src/projects/dto/project-url.dto.ts` (new) — nested
  `{ title: string; url: string }` reused inside create / update /
  response DTOs.
- `src/projects/dto/project-response.dto.ts` (new) — the API
  response shape for a single project (used by create / update /
  findOne / list). Wraps the entity (or a typed projection of it)
  with Swagger `@ApiProperty` annotations. Reusing a single
  response DTO across all four endpoints keeps the OpenAPI
  document consistent.
- `src/projects/projects.controller.ts` (replace stub) — five
  routes wired with `@ApiTags('projects')`, `@ApiOperation`,
  `@ApiResponse`, and `@UseGuards(JwtAuthGuard)` on the three
  write methods.
- `src/projects/projects.service.ts` (replace stub) — real
  TypeORM-backed CRUD, slug-uniqueness check, pagination, nested
  `project_urls` save logic.
- `src/projects/projects.module.ts` (replace stub) — add
  `TypeOrmModule.forFeature([ProjectEntity, ProjectUrlEntity])`
  (mirrors `auth.module.ts:16`).
- `src/common/filters/all-exceptions.filter.ts` (new) — the
  global exception filter. Lives under `src/common/` to leave it
  reusable by future domain changes (reviews, contact). Formats
  every error as `{ statusCode, error, message, timestamp, path }`,
  distinguishes 4xx (HttpException) from 5xx (sanitised generic
  message, no stack), and logs the original 5xx for ops.
- `src/projects/projects.controller.spec.ts` (replace) and
  `src/projects/projects.service.spec.ts` (replace) — colocated
  unit tests for the new surface (HTTP shape, service
  behaviour, slug-uniqueness, nested-url save).
- `src/projects/entities/project.entity.spec.ts` (new) and
  `src/projects/entities/project-url.entity.spec.ts` (new) —
  entity metadata tests mirroring `src/auth/entities/user.entity.spec.ts`.
- `test/projects.e2e-spec.ts` (new) — end-to-end coverage of
  the public reads + the protected writes (mint a JWT signed
  with the test secret, attach `Authorization: Bearer ...`).

### Source files to modify

- `src/main.ts` — register the new exception filter with
  `app.useGlobalFilters(new AllExceptionsFilter())`. The rest of
  the bootstrap is already in place; no other change required.
- `src/app.module.ts` — no change strictly required, but a future
  cleanup might add the filter to providers. For now, the
  `app.useGlobalFilters()` call in `main.ts` is the documented
  path. If we want DI access (e.g. for a logger), promoting the
  filter to a `MainModule` provider wired in `AppModule` is the
  alternative — but `useGlobalFilters` accepts a class with DI
  through Nest's `app.select()`, so a plain `new` works for a
  filter that needs no injected deps.
- `src/data-source.ts` — add `ProjectEntity, ProjectUrlEntity` to
  the `entities` array. This file is the single source of truth
  shared by the runtime Nest app and the seed CLI; both will
  pick up the new entities.
- `README.md` — update the Projects table if any of the
  resolved open questions change the public surface (e.g. add
  an admin list endpoint), and document any new convention
  introduced by the exception filter (e.g. error response shape).

### Files to read for context during apply (already covered above)

- `openspec/specs/server_specs.md` — canonical backend design.
- `openspec/specs/database-schema.dbml` — entity shapes.
- `openspec/changes/archive/bootstrap-api-config/` — house style
  for proposal, design, tasks, spec deltas, verify, archive.
- `src/auth/auth.controller.ts` — pattern for `@ApiTags`,
  `@ApiBearerAuth`, `@UseGuards(JwtAuthGuard)`, per-route
  Swagger annotations.
- `src/auth/auth.controller.spec.ts` — pattern for e2e-style
  HTTP unit tests with mocked repos, `app.setGlobalPrefix`,
  `app.useGlobalPipes`, `request(app.getHttpServer())`.
- `src/auth/auth.service.ts` — pattern for service-layer use
  of `Repository<T>` and `HttpException` (`UnauthorizedException`).
- `src/auth/entities/user.entity.ts` + `user.entity.spec.ts` —
  entity + entity-metadata-test pattern.
- `src/auth/auth.module.ts` — pattern for `TypeOrmModule.forFeature`
  in a domain module.
- `src/app.module.spec.ts:143-156` — the static guard-rail that
  keeps `JwtAuthGuard` per-controller only. Must NOT be broken.

## Approaches

### Approach A — Direct port of the spec (recommended)

Implement the 5 routes exactly as the spec describes, in a single
domain module, with the new global exception filter.

- `GET /api/v1/projects` (public) — paginated, default
  `is_published = true` filter, `?page` and `?limit` query
  params (per ADR-2, `@Type(() => Number)`).
- `GET /api/v1/projects/:slug` (public) — by **slug**, returns
  the project only if `is_published = true`; otherwise 404.
- `POST /api/v1/projects` (JWT) — accepts a body that includes
  an array of `project_urls` (create them inside the same
  transaction).
- `PATCH /api/v1/projects/:id` (JWT) — by **id**, accepts a
  partial body. If `urls` is provided, replace-all (delete
  existing then insert new) for simplicity; document this.
- `DELETE /api/v1/projects/:id` (JWT) — hard delete per DBML
  (no `deleted_at` column). Cascades to `project_urls` rows
  via TypeORM's `onDelete: 'CASCADE'` on the FK.
- Global `AllExceptionsFilter` shapes 4xx and 5xx uniformly.
- Entities, DTOs, service, controller, filter, unit + e2e
  tests, DataSource update.

Pros:
- Matches `server_specs.md` §3.2 exactly. No new spec deltas
  needed (only the project-domain capability, which becomes
  its own spec at archive time).
- Mirrors the auth-domain structure already in the repo, so a
  reviewer can compare side by side.
- The exception filter is reusable by future domain changes
  (reviews, contact) — single investment.
- The read-by-slug / write-by-id asymmetry is the spec's own
  choice; documenting it is enough.

Cons:
- Read-by-slug is unusual for a public REST API (most public
  APIs expose by id too). An admin who knows only the id
  cannot preview an unpublished project. Documented as a
  known scope gap.
- Replace-all `urls` semantics on update is a footgun for
  clients that want to edit one link without resending the
  whole list. Tradeoff: simplicity vs. granular control.
- The change spans ~500-600 lines (entities + DTOs +
  service + controller + filter + tests). It crosses the
  400-line review budget — see the Chained-PRs note below.

Effort: **High** (single PR or chained PRs; see "Chained-PRs
decision" under Recommendation).

### Approach B — Read-by-id (admin override) + nested endpoints

Add an alternate `GET /api/v1/projects/:id` for admin use,
plus granular `POST /api/v1/projects/:id/urls` and
`DELETE /api/v1/projects/:id/urls/:urlId` endpoints. Keeps
the spec endpoints intact but adds more.

Pros:
- Admins can preview unpublished projects by id.
- Granular URL management avoids the replace-all footgun.

Cons:
- 7 routes instead of 5. Out of spec.
- More code to test, more routes in the OpenAPI doc, more
  surface for the exception filter to handle.
- Two ways to identify a project (id vs. slug) is a UX
  hazard; pick one.

Effort: **Higher** than A, and the spec delta cost outweighs
the benefit for a single-admin portfolio.

### Approach C — Defer the exception filter to its own change

Ship the CRUD without the global filter, add the filter as
a separate `global-exception-filter` change.

Pros:
- Smaller PR per change, easier review.

Cons:
- The user explicitly listed the filter as a requirement
  ("gestión de errores adecuada"). Shipping CRUD without it
  means a follow-up change, which is a worse experience.
- Without the filter, the CRUD itself can return bare 500s
  on unexpected errors (e.g. Postgres connection drop),
  defeating the user's intent.

Effort: **Same** total, but delivered in two change-cycles.
Rejected — the user wanted both in one.

## Recommendation

**Approach A**, with chained PRs to stay under the 400-line
review budget. Concretely:

### Chain 1 — Foundation (entities, DataSource, exception filter)

- Create `ProjectEntity` and `ProjectUrlEntity` with
  TypeORM metadata mirroring the DBML.
- Add both entities to `src/data-source.ts` and to
  `ProjectsModule.imports` via
  `TypeOrmModule.forFeature([ProjectEntity, ProjectUrlEntity])`.
- Add `src/common/filters/all-exceptions.filter.ts` and wire
  it in `src/main.ts` with `app.useGlobalFilters(...)`.
- Entity metadata specs
  (`src/projects/entities/{project,project-url}.entity.spec.ts`).
- Filter unit spec.

Why first: every other layer depends on the entities and the
filter. The filter is wired here (not in a later chain) so
later chains' tests can rely on the consistent error shape.

Estimated ~200 lines.

### Chain 2 — DTOs + service + controller

- Fill `CreateProjectDto`, `UpdateProjectDto`,
  `ListProjectsQueryDto`, `ProjectUrlDto`, `ProjectResponseDto`.
- Replace `ProjectsService` with TypeORM-backed CRUD, slug
  uniqueness check, nested `project_urls` save logic
  (transactional), pagination, list filtering by
  `is_published`.
- Replace `ProjectsController` with the 5 spec routes,
  `@UseGuards(JwtAuthGuard)` on the 3 write methods,
  `@ApiTags('projects')`, `@ApiOperation`, `@ApiResponse`,
  `@ApiBearerAuth()` on the protected methods.
- Update `projects.service.spec.ts` and
  `projects.controller.spec.ts` to cover the new surface.

Estimated ~300 lines (right at the boundary; may need to be
split further if reviewability suffers).

### Chain 3 — E2E test

- `test/projects.e2e-spec.ts` covering:
  - `GET /api/v1/projects` paginated, only-published
    default, custom `is_published` rejected on public.
  - `GET /api/v1/projects/:slug` happy + 404.
  - `POST /api/v1/projects` 201 happy + 400 (validation) +
    401 (no token) + 409 (duplicate slug).
  - `PATCH /api/v1/projects/:id` 200 + 401 + 404.
  - `DELETE /api/v1/projects/:id` 204/200 + 401 + 404.
  - Filter shape: 4xx body matches
    `{ statusCode, error, message, timestamp, path }`;
    500 body has sanitised message (no stack).

Estimated ~150 lines.

### Chain 4 — README

- Update the Projects table only if any spec assumption
  changed (none expected).
- Add a short "Error response shape" subsection documenting
  the global filter's contract — this is the convention the
  next domain change will inherit.

Estimated ~20 lines.

### Chained-PRs decision

Total estimated ~670 lines across 4 chains. Without chaining,
the single PR is ~600 lines, well above the 400-line budget.
Recommend chained PRs as the default delivery mode for this
change; the proposal phase should propose the split and let
the user confirm.

### Specific recommendations the proposal should make

- **Slug uniqueness**: pre-check in service via
  `findOne({ where: { slug } })` and throw `ConflictException`
  before insert; on the rare race, also catch
  `QueryFailedError` (Postgres `23505`) and re-throw
  `ConflictException`. Do NOT rely solely on the DB error.
- **`is_published` default on public list**: `true` (only
  published). Protected create/update accepts any value.
- **Public detail (`GET :slug`)**: returns 404 for both
  "not found" and "exists but not published" — do not leak
  the existence of unpublished projects to the public.
- **`content` length**: spec is silent. Recommend
  `@MaxLength(50_000)` (50KB of Markdown) as a soft cap. Open
  to the proposal phase.
- **`tags` normalization**: `@Transform(({ value }) =>
  value.map((v) => v.trim().toLowerCase()).filter(Boolean))`
  on the DTO. Empty/duplicate tags silently dropped.
- **Tags array column**: `type: 'text', array: true` on the
  TypeORM column (Postgres `text[]`). Matches DBML `varchar[]`
  semantically (Postgres has no `varchar[]` distinct from
  `text[]`); `varchar[]` is a length-constrained array which
  is rarely what you want for tags. The DBML says `varchar[]`
  literally — the proposal should call this out as a
  deliberate entity-level choice (we may need to update the
  DBML during archive if the user agrees).
- **Cover image URL**: `@IsUrl({ require_protocol: true,
  protocols: ['http', 'https'] }) @IsOptional()`. Reject
  relative paths because the spec note says pre-signed
  Supabase URLs are HTTPS.
- **`project_urls` save strategy**: create — accept the array
  in the body, persist project + urls in a single
  TypeORM transaction (use `manager.save` on both, or
  `manager.transaction` with two saves). Update — replace-all
  (delete existing `project_urls` rows, then insert the
  provided list). Cascade via FK
  `onDelete: 'CASCADE'` so a `DELETE /:id` cleans up
  `project_urls` automatically.
- **List pagination response shape**:
  `{ data: ProjectResponseDto[], meta: { page, limit, total,
  totalPages } }`. The auth domain does not paginate, so
  this is new — the proposal should own the shape.
- **No soft delete** in v1. DBML has no `deleted_at`. Hard
  delete is the spec.

## Open Questions for the Proposal Phase

1. **Should `findOne` by id be supported for the public?** (Spec
   says slug only. Admin previews unpublished projects by slug
   is awkward but workable if the admin can list them — but
   no admin list endpoint exists in the spec either. Proposal
   should propose either adding `GET /api/v1/admin/projects`
   or accepting the awkwardness for v1.)
2. **Is `urls` replace-all on update acceptable?** (Simpler
   than granular endpoints; minor footgun.)
3. **List response envelope**: `data + meta` vs. raw array
   with `X-Total-Count` header? (Both are common; the
   project's house style has not yet established a
   preference because auth does not paginate.)
4. **Filter shape**: do we want a
   `{ statusCode, error, message, timestamp, path }` envelope,
   or stick to Nest's default `HttpException` body? (The user
   asked for "gestión de errores adecuada" — explicit envelope
   is recommended, but it diverges from Nest's default and
   may surprise clients.)
5. **Are 5xx bodies sanitized to a generic message, or do we
   include the exception class name?** (Generic message +
   server-side log of the real error is the standard tradeoff
   for not leaking internal details. The proposal should
   confirm this is the project's intent.)
6. **DBML `tags varchar[]` vs. entity `text[]`**: do we keep
   the DBML as-is (it has `varchar[]`) and use `type:
   'varchar', array: true` to match exactly, or do we
   normalize to `text[]` in the entity and update the DBML
   at archive time? (The behavior is identical for
   arbitrary-length tags, so this is a documentation
   consistency question.)
7. **Chained PRs vs. single PR**: confirm with the user
   before the proposal locks in the chain split.

## Risks

1. **No global exception filter exists today.** A wrong move
   on the filter (e.g. leaking the stack in 5xx bodies, or
   inadvertently breaking the existing auth 401/refresh 500
   flows) can degrade the rest of the API. Mitigation: a
   filter unit spec that exercises both `HttpException` and
   raw `Error` paths, plus a sanity check in
   `test/bootstrap.e2e-spec.ts` that the existing
   `forbidNonWhitelisted` 400 still has the expected shape.
2. **`getRepositoryToken` for the new entities is added to
   `AppDataSource` but the test harness mocks
   `@nestjs/typeorm`.** A test that forgets to provide a
   fake repository for `ProjectEntity` or `ProjectUrlEntity`
   will fail with "Nest can't resolve dependencies".
   Mitigation: the apply agent MUST add fakes for both
   entities in every `Test.createTestingModule` that
   instantiates `ProjectsModule` (see the pattern in
   `src/app.module.spec.ts:65-86`).
3. **The stub `findOne(@Param('id') id: string)` uses
   `+id` numeric coercion.** A future contributor who copies
   the stub pattern into a write method will silently
   introduce the same bug. Mitigation: the proposal should
   propose removing the `+id` cast in the spec delta or in
   the implementation (the controller will be rewritten
   anyway — no extra work, but the stub `.spec.ts` will
   need updating too).
4. **Tags as Postgres `varchar[]` does not have a single
   canonical TypeORM column declaration.** Both
   `type: 'varchar', array: true` and `type: 'text', array:
   true` work; the choice has DBML implications (see Open
   Question #6). Mitigation: pick one in the proposal and
   update the DBML during archive if needed.
5. **Chained-PRs risk: a foundation-only first PR can sit
   in review while the next two chains are still being
   written.** If the user expects a single delivery, the
   chained mode looks like a stall. Mitigation: the
   proposal MUST flag this in the rollback plan and confirm
   the delivery mode before apply.
6. **Pre-existing 8 unused-DTO-param lint errors** in
   `src/{auth,contact,projects,reviews}/*.service.ts` will
   naturally resolve when the projects service is rewritten
   with real DTO usage, but the auth / reviews / contact
   services will still have the same error. Out of scope;
   mention in the verify report so the next domain change
   knows.

## Ready for Proposal

**Yes.** The change is well-scoped:

- The spec intent maps to 5 routes, 2 entities, 4-5 DTOs, 1
  service, 1 controller, 1 global filter, 2 unit specs, 1
  e2e spec, 1 DataSource update, 1 README tweak.
- Every dependency needed (guard, prefix, pipe, Swagger,
  DataSource) is already in place.
- House style is established by the auth-domain and
  bootstrap-api-config changes — the proposal and design
  should mirror their structure closely.
- Open questions are bounded and do not block the
  proposal; they are clarifications the proposal can
  answer with a recommendation.

**The orchestrator should tell the user:**

- Approve the chained-PRs delivery mode (4 chains, ~670
  lines total) or override to a single PR.
- Confirm the read-by-slug / write-by-id asymmetry is
  acceptable for v1 (no admin preview by id).
- Confirm the global filter shape
  (`{ statusCode, error, message, timestamp, path }` with
  sanitised 5xx bodies) is the project's intent.
- The 7 open questions above are pre-resolved with
  recommendations; the proposal can adopt them or open
  them up again.

After user confirmation, the next phase is `sdd-propose`.
