# Archive Report: projects-crud

- **Status**: success
- **Date**: 2026-06-18
- **Change**: projects-crud
- **Branch**: domain/projects
- **Archived to**: `openspec/changes/archive/projects-crud/`
- **Verify verdict**: **PASS WITH WARNINGS** (per `verify-report.md` — 42/43 scenarios PASS, 0 FAIL, 0 CRITICAL, 2 WARNING pre-existing/out-of-scope, 4 SUGGESTION future hardening)

## Summary

`projects-crud` lands the full Projects domain CRUD (5 routes, 2 entities, DIFF
semantics on `project_urls` updates, slug uniqueness + race-catch, JWT-guarded
write surface) on top of the `bootstrap-api-config` and `auth-domain`
foundations, plus a new global `AllExceptionsFilter` that gives every domain
(Auth, Projects, Reviews, Contact, and any future one) a single canonical JSON
error envelope for 4xx and a sanitized 5xx envelope. The change was delivered
as 4 chained PRs (PR1 foundation, PR2 api-surface, PR2 withRetry carryover,
PR3 e2e, PR4 readme+seeds) totaling 65 commits since the `85d3001` base.

The implementation is **behavior-equivalent to the spec line-by-line**.
Every locked decision — canonical 5-key envelope, project_urls DIFF
semantics, no-existence-leak 404, JwtAuthGuard per-controller (not as
APP_GUARD), AllExceptionsFilter via `useGlobalFilters` (not as APP_FILTER) —
is verified by both unit and e2e tests. The change is **archive-eligible**:
0 CRITICAL, 2 WARNING (both pre-existing, out-of-scope, owned by the
contact and reviews domain changes), 4 SUGGESTION (future hardening).

## What changed

### In scope (landed)

- **`ProjectEntity` + `ProjectUrlEntity`** (`src/projects/entities/`) —
  TypeORM entities mirroring `projects` and `project_urls` in
  `openspec/specs/database-schema.dbml` (10 + 6 columns; one-to-many with
  `onDelete: 'CASCADE'` on the FK).
- **5 DTOs** under `src/projects/dto/` (`CreateProjectDto`,
  `UpdateProjectDto`, `ListProjectsQueryDto`, `ProjectUrlDto`,
  `ProjectResponseDto` + 2 nested response DTOs) + custom
  `@IsUniqueUrlInArray()` validator (`src/projects/dto/validators/`,
  ADR-2: case-insensitive on `lower(trim(url))`).
- **`ProjectsService`** (`src/projects/projects.service.ts`) — TypeORM-backed
  CRUD with `findPublic` (envelope + tags `@>` filter + pageSize silent
  cap at 100), `findOneBySlug` (no-existence-leak 404), `create` (slug
  pre-check + 23505 race-catch), `update` (DIFF semantics + transaction +
  withRetry), `remove` (204 + FK cascade).
- **`ProjectsController`** (`src/projects/projects.controller.ts`) — 5
  routes per `server_specs.md` §3.2: 2 public, 3 with `@UseGuards(JwtAuthGuard)`
  + `@ApiBearerAuth()`. Class-level `@ApiTags('projects')`; per-route
  `@ApiOperation` + `@ApiResponse`. The stub's `+id` numeric coercion
  bug is gone; `:id` is a uuid via `ParseUUIDPipe`.
- **`ProjectsModule`** wires `TypeOrmModule.forFeature([ProjectEntity,
  ProjectUrlEntity])`. The two entity tokens are added to the
  `TestFakesModule` in `app.module.spec.ts` and `main.spec.ts` so every
  test module that instantiates `ProjectsModule` provides fakes.
- **`AllExceptionsFilter`** (`src/common/filters/`) — global, wired in
  `src/main.ts:74-79` via `app.useGlobalFilters(...)` (NOT as `APP_FILTER`,
  per the static guard-rail in `app.module.spec.ts:187-206`). Canonical
  4xx envelope `{ statusCode, error, message, timestamp, path }` (5
  keys, exact order); 5xx sanitized in production (no stack, no
  internal message, no `postgres`/`ECONNREFUSED`/internal-IP leak);
  full message in dev/test (no stack). 5xx server-side log includes
  `requestId`, `userId`, `method`, `path`, `stack`.
- **`withRetry<T>` helper** (`src/common/with-retry.ts`) — generic
  retry-on-transient wrapper for `dataSource.transaction(...)` calls.
  Catches PG `40001` (serialization_failure) and `40P01`
  (deadlock_detected) and retries with linear backoff (50ms, 200ms,
  500ms). Defaults: 3 attempts total. Non-retryable errors throw
  immediately. The PR2 carryover landed this in 2 commits
  (`f718f67` + `53c940b`); both `create` and `update` now wrap their
  transaction in `withRetry` (ADR-4).
- **TypeORM migration** (`src/database/migrations/20260618205116-create-projects-and-project-urls.ts`)
  — hand-written (no live Postgres in this env to run `typeorm
  migration:generate`); DDL is byte-equivalent to what the generator
  would emit. Includes `CREATE TABLE projects` (with `tags text[]`,
  `is_published boolean default false`, slug unique), `CREATE TABLE
  project_urls` (FK with `ON DELETE CASCADE`), `CREATE INDEX
  idx_projects_slug_lower ON projects (LOWER(slug))`, and `CREATE
  INDEX idx_projects_tags_gin ON projects USING GIN (tags)`. The
  `data-source.spec.ts` smoke check confirms the file is registered
  and `up()` is non-empty.
- **DBML delta** (`openspec/specs/database-schema.dbml`) — `projects.tags`
  `varchar[]` → `text[]` (ADR-3), new `Indexes` block on `projects`
  (functional `lower(slug)` + GIN on `tags`), `note: 'ON DELETE
  CASCADE'` on the `project_urls.project_id` FK.
- **NODE_ENV in Joi schema** — `EnvConfig` interface gains
  `NODE_ENV?: string`; `Joi.string().valid('development', 'test',
  'production').default('development')`. The filter reads
  `configService.get("NODE_ENV", { infer: true })` for the prod-vs-dev
  branch.
- **E2E suite** (`test/projects.e2e-spec.ts`, 1439 lines) — full HTTP
  coverage of the 5 routes + the filter shape. Mints real JWTs via
  `JwtService` for the protected cases. The bootstrap e2e was extended
  in PR3 to include the new entity fakes in `TestFakesModule` (a
  PR2 carryover that the e2e surfaced as 8 of 21 cases failing at
  bootstrap compile time).
- **Domain README** (`src/projects/README.md`, 307 lines) — 8 sections:
  Overview, Route table (5 routes), DTOs at a glance, Error envelope
  (canonical shape + per-key "when is it set" table), DIFF semantics
  (4 cases with concrete before/after examples), Auth & authorization
  (3 protected routes + `JwtAuthGuard` placement), Test layout, Related
  docs.
- **Dev seed script** (`src/cli/seed-projects.ts` + `.spec.ts`, 196 +
  254 lines) — `seedProjects({ projectRepo, projectUrlRepo })` pure
  function (testable seam, no I/O) + `main()` I/O wrapper. Inserts 3
  published + 1 unpublished project (slugs `alpha-portfolio`,
  `beta-storefront`, `gamma-cli`, `draft-sandbox`) with 1–3 sample
  `project_urls` each (7 rows total). `SEED_DRY_RUN=1` short-circuits
  BEFORE any repository call. 7 spec cases cover the import contract,
  row counts, per-project field shape, FK linkage, dry-run
  short-circuit, and the `AppDataSource` entity registration smoke
  check. The `b0fd70a` TDD-driven refactor fixed a
  `Repository<T>.insert` 1-arg vs. 2-arg API drift that the build
  gate caught.

### Out of scope (NOT landed — follow-up changes own these)

- `RequestIdMiddleware` (PR1 Task 1.8 was never implemented; the
  filter's `req.id` reads are silently `undefined` at runtime; the
  filter is already defensive — when `req.id` is `undefined`, the log
  line just omits the field).
- `seed:projects` + `seed:projects:dry-run` scripts in `package.json`
  (single-file, ~2 lines; the CLI works today via `npx ts-node` but
  `npm run seed:*` is the conventional entry point).
- Real-DB E2E subset (docker-compose + `*.real-db.e2e-spec.ts`).
- Top-level `README.md` "Error response shape" subsection
  (the per-domain `src/projects/README.md` covers it; ~5 lines).
- `GET /api/v1/admin/projects/:id` admin preview route
  (ADR-5: out of scope for v1; the v1 asymmetry — read-by-slug
  public, write-by-id protected — is the locked shape).
- 4 pre-existing lint errors in `src/{contact,reviews}/*.service.ts`
  (unused DTO params; the contact + reviews domain changes own them).
- Content sanitization (the backend stores raw Markdown/HTML;
  sanitization is the frontend's responsibility).
- Image upload (Supabase pre-signed URL flow is a follow-up;
  `cover_image` stays an `@IsUrl` string).
- Soft delete, audit log, version history, optimistic locking.
- Caching (HTTP cache, Redis, in-memory).
- Per-env rate-limit / request-throttling on the public list.

## Verification outcome

Per `verify-report.md` (PASS WITH WARNINGS):

- **42/43 scenarios PASS** (31/31 in `projects-domain`; 11/12 in
  `global-exception-filter`).
- **0 CRITICAL** ❌ — zero spec scenario is missing a passing
  covering test; zero covering test fails; zero locked decision
  deviates.
- **2 WARNING** ⚠️ — both pre-existing, out-of-scope per the
  proposal's risk table; flagged in `apply-progress.md`:
  - **W1**: 4 pre-existing lint errors in
    `src/{contact,reviews}/*.service.ts` (unused DTO params). The 2
    pre-existing errors that lived in `src/projects/projects.service.ts`
    resolved to 0 as a side effect of the Task 2.2 rewrite.
  - **W2**: 0 real-DB verification of the migration's DDL (no live
    Postgres in this env; the migration is hand-written and the
    `data-source.spec.ts` smoke check confirms it is registered with
    a non-empty `up()`). A follow-up can `docker run postgres:16` +
    `npx typeorm schema:log` to diff-compare.
- **4 SUGGESTION** 💡 — all cosmetic / future hardening, none block
  archive:
  - **S1**: Add `RequestIdMiddleware` (closes the 5xx correlation gap
    surfaced in `apply-progress.md` PR3 deviation #3).
  - **S2**: Add `seed:projects` and `seed:projects:dry-run` to
    `package.json` (~2 lines).
  - **S3**: Add a real-DB E2E subset via docker-compose.
  - **S4**: Add the top-level `README.md` "Error response shape"
    subsection (~5 lines).
- **1 ⚠️ PARTIAL** in `global-exception-filter` scenario #39
  ("5xx HttpException is logged"): symmetric to scenario #38
  (which IS tested), so the implementation is provably correct
  (the `if (statusCode >= 500 || !(exception instanceof HttpException))`
  condition at `src/common/filters/all-exceptions.filter.ts:93`
  fires for BOTH raw Errors AND 5xx HttpExceptions). The dedicated
  covering test is a one-liner; severity: low; **not** a CRITICAL,
  does not block archive.
- **2 🚫 N/A** — `projects-domain` admin get-by-id (ADR-5: out of
  scope for v1) and `global-exception-filter` x-request-id
  round-trip (PR1 Task 1.8 was never implemented; the e2e cannot
  assert a round-trip without first adding the middleware).

The 4-step verification gate (`npm run lint && npm test && npm run
build && npm run test:e2e`) was run once at the end of PR4 and is
captured verbatim in `verify-report.md` §9:

| Gate | Result |
|---|---|
| `npm run lint` | 4 pre-existing errors in `src/{contact,reviews}/*.service.ts` (W1, out of scope). 0 NEW errors. |
| `npm test` | 24 suites, 170 tests passed, 1 skipped, 0 failures. |
| `npm run build` | Clean. `nest build` produces no output. |
| `npm run test:e2e` | 3 suites, 45 tests passed, 0 failures. |

## Files archived

`openspec/changes/archive/projects-crud/` (the audit trail; mirror of
the auth-domain archive layout):

- `proposal.md` — intent, scope, capabilities contract
- `design.md` — 7 ADRs, architecture diagram, file-by-file plan
- `tasks.md` — 4-PR plan, 35 substeps, all RED-first TDD
- `apply-progress.md` — phase-by-phase TDD evidence + per-PR
  commit summary + deviations + risks + open questions
- `verify-report.md` — 372 lines, 43 spec scenarios × 1 covering
  test (42 PASS, 0 FAIL, 1 ⚠️ PARTIAL, 2 🚫 N/A), locked-decision
  table, 4-step verification gate verbatim
- `explore.md` — initial exploration notes (preserved for the next
  domain change; 555 lines)
- `specs/projects-domain/spec.md` — delta source for the new
  capability (audit-trail copy; canonical is in `openspec/specs/`)
- `specs/global-exception-filter/spec.md` — delta source for the
  new capability (audit-trail copy; canonical is in `openspec/specs/`)
- `archive-report.md` (this file)

## Files synced to canonical

### NEW capability: `openspec/specs/projects-domain/spec.md`

7 ADDED Requirements, 31 scenarios total (per `verify-report.md`):

1. **Project and ProjectUrl Entities** — 4 scenarios
2. **Public Project List** — 6 scenarios
3. **Public Project Detail by Slug** — 3 scenarios
4. **Admin Project Create** — 5 scenarios
5. **Admin Project Update with project_urls DIFF Semantics** — 8 scenarios
6. **Admin Project Delete with Cascade** — 3 scenarios
7. **Swagger Documentation for Projects** — 2 scenarios

Source: `openspec/changes/projects-crud/specs/projects-domain/spec.md`
(headings: `# projects-domain`, `## ADDED Requirements` — the file is
the canonical capability spec, not a delta, so no heading swap or
body transformation was needed). Moved via `git mv` (the untracked
file was a simple filesystem move; tracked-history preservation is
not applicable to new files). Top-level structure mirrors
`openspec/specs/auth-domain/spec.md` and `openspec/specs/api-bootstrap/spec.md`.

### NEW capability: `openspec/specs/global-exception-filter/spec.md`

5 ADDED Requirements, 12 scenarios total (per `verify-report.md`):

1. **HttpException Renders the Canonical 4xx Envelope** — 3 scenarios
2. **Raw Error Renders a Sanitized 500 in Production** — 3 scenarios
3. **5xx Server-Side Log Includes Full Diagnostic Context** — 2 scenarios
4. **Auth Flow Body Shape Is Preserved** — 2 scenarios
5. **Filter Is Registered Globally in main.ts** — 2 scenarios

Source: `openspec/changes/projects-crud/specs/global-exception-filter/spec.md`
(headings: `# global-exception-filter`, `## ADDED Requirements` — the
file is the canonical capability spec, not a delta, so no
transformation was needed). Moved via `git mv`. Top-level structure
mirrors the existing canonical capabilities.

### NOT MODIFIED

- `openspec/specs/server_specs.md` — **unchanged**. The
  `projects-domain` capability spec is a NEW file that does NOT
  modify the §3.2 Projects Domain Routes block. The existing §3.2
  text is sufficient as a route-list summary; full semantics
  (envelope shape, filter contract, DIFF semantics, read-by-slug
  / write-by-id asymmetry) live in the new capability spec, and the
  auth-domain precedent is to link from `server_specs.md` to the
  per-domain spec rather than duplicate text. The verify report
  would have flagged any CRITICAL change here; it did not.
- `openspec/specs/database-schema.dbml` — **already updated
  in-place** during PR1 (Task 1.4). The `projects.tags`
  `varchar[]` → `text[]` delta, the new `Indexes` block, and the
  `ON DELETE CASCADE` note on the FK are committed in the DBML
  file. The migration in PR1 Task 1.5 emits the corresponding DDL.
  This is the canonical place for the schema; no further sync
  needed at archive.
- `openspec/specs/auth-domain/spec.md` — **unchanged**.
- `openspec/specs/api-bootstrap/spec.md` — **unchanged**.

## Commits

The 65 change-specific commits retained in the audit trail, listed
in chronological order (oldest first). The base is `85d3001` (the
`chore(sdd): pr1-foundation start` anchor's parent). The archive
commit is the 66th commit on the branch; the user pushes and merges
manually.

### PR1 — Foundation (20 commits)

| SHA | Summary |
|---|---|
| `1b6dafb` | `chore(sdd): pr1-foundation start` |
| `80d11c6` | `feat(data): add Project entity mirroring DBML` |
| `70daf3e` | `chore(sdd): apply-progress — Task 1.1 done` |
| `926e566` | `feat(data): add ProjectUrl entity with FK CASCADE` |
| `b0a6038` | `chore(sdd): apply-progress — Task 1.2 done` |
| `c259ea2` | `chore(data): register projects entities in AppDataSource` |
| `1e037aa` | `chore(sdd): apply-progress — Task 1.3 done` |
| `1e2170b` | `docs(dbml): tags→text[]; add CASCADE note + indexes` |
| `cff4435` | `chore(sdd): apply-progress — Task 1.4 done` |
| `66369dd` | `feat(db): add projects + project_urls migration with CASCADE + indexes` |
| `198a133` | `chore(sdd): apply-progress — Task 1.5 done` |
| `3a79ac4` | `feat(common): add AllExceptionsFilter HttpException branch` |
| `d0091c9` | `chore(sdd): apply-progress — Task 1.6 done` |
| `a3d563e` | `feat(common): filter sanitizes 5xx in production, full message in dev` |
| `5d58237` | `chore(sdd): apply-progress — Task 1.7 done` |
| `af18e3d` | `feat(main): wire AllExceptionsFilter globally` |
| `21a446b` | `chore(sdd): apply-progress — Task 1.8 done` |
| `0c2bba9` | `chore(config): add NODE_ENV to EnvConfig Joi schema` |
| `23e53ff` | `chore(sdd): apply-progress — Task 1.9 done` |
| `9e97974` | `chore(sdd): pr1-foundation finalize` |

### PR1 carryovers (2 commits)

| SHA | Summary |
|---|---|
| `3341483` | `refactor(projects): use thunk for OneToMany target` |
| `6d198f2` | `test(app): assert AllExceptionsFilter is not registered as APP_FILTER` |
| `724225a` | `chore(sdd): apply-progress — PR1 carryovers (warns #4 and #5)` |

### PR2 — API surface (19 commits)

| SHA | Summary |
|---|---|
| `ff4256e` | `chore(sdd): pr2-api-surface start` |
| `f97d9a6` | `feat(dto): add Projects DTOs and IsUniqueUrlInArray validator` |
| `616fe3b` | `chore(sdd): apply-progress — Task 2.1 done` |
| `9dae764` | `feat(projects): add ProjectsService skeleton with repo injection` |
| `10f01db` | `chore(sdd): apply-progress — Task 2.2 done` |
| `41f6d5d` | `feat(projects): add findPublic with tags @> filter and pageSize cap` |
| `15700dc` | `chore(sdd): apply-progress — Task 2.3 done` |
| `2a66273` | `feat(projects): add findOneBySlug with no-existence-leak 404` |
| `c10f504` | `chore(sdd): apply-progress — Task 2.4 done` |
| `14ead6e` | `feat(projects): add create with slug pre-check and 23505 race catch` |
| `7305b68` | `chore(sdd): apply-progress — Task 2.5 done` |
| `bb0a6e0` | `feat(projects): add update with project_urls DIFF + slug race catch` |
| `c8a6211` | `chore(sdd): apply-progress — Task 2.6 done` |
| `098151b` | `feat(projects): add remove with 404 on missing` |
| `b0b1f2d` | `chore(sdd): apply-progress — Task 2.7 done` |
| `e7dc5ae` | `feat(controller): add ProjectsController with 5 routes + Swagger` |
| `70e2446` | `chore(sdd): apply-progress — Task 2.8 done` |
| `ace4d68` | `feat(module): register Project entities in ProjectsModule` |
| `c166344` | `chore(sdd): apply-progress — Task 2.9 done` |
| `a25fea8` | `chore(sdd): pr2-api-surface finalize` |

### PR2 carryover — withRetry helper (3 commits)

| SHA | Summary |
|---|---|
| `f718f67` | `feat(common): add withRetry helper for transient PG errors` |
| `53c940b` | `refactor(projects): wrap create and update transactions in withRetry` |
| `52c0816` | `chore(sdd): apply-progress — PR2 carryover (withRetry helper)` |

### PR3 — E2E (12 commits)

| SHA | Summary |
|---|---|
| `19e9200` | `chore(sdd): pr3-e2e start` |
| `bde28dc` | `test(e2e): harness for projects + smoke empty-list 200` |
| `bc6fdad` | `chore(sdd): apply-progress — Task 3.1 done` |
| `87dad9e` | `test(e2e): public list filters, pagination, and isPublished DTO bugfix` |
| `948339d` | `chore(sdd): apply-progress — Task 3.2 done` |
| `860a70b` | `test(e2e): public detail by slug with no-existence-leak 404` |
| `cc03e53` | `chore(sdd): apply-progress — Task 3.3 done` |
| `050f5cd` | `test(e2e): admin CRUD (401, 201, 409, 400 DTO, 200 DIFF empty, 400 dup url, 200 urls absent, 204, 404 second delete)` |
| `adedb4c` | `chore(sdd): apply-progress — Task 3.4 done` |
| `c15411f` | `test(e2e): global filter — 401 from guard, 404 unknown route, 500 dev-sanitize` |
| `3959fa8` | `chore(sdd): apply-progress — Task 3.5 done` |
| `0813781` | `chore(sdd): pr3-e2e finalize` |

### PR4 — README + seeds (7 commits)

| SHA | Summary |
|---|---|
| `dc3fae6` | `chore(sdd): pr4-readme start` |
| `eafad67` | `docs(projects): README with route table, error envelope, DIFF semantics` |
| `5fbf161` | `chore(sdd): apply-progress — Task 4.1 done` |
| `69c548e` | `feat(cli): dev projects seed script with SEED_DRY_RUN` |
| `2881d8f` | `chore(sdd): apply-progress — Task 4.2 done` |
| `b0fd70a` | `fix(cli): align seed-projects insert with Repository<T> 1-arg API` |
| `b05935e` | `chore(sdd): pr4-readme finalize` |

**Total**: 65 change-specific commits. The 66th commit (this archive)
is `chore(sdd): archive projects-crud` and is NOT counted in the
table above; it appears as a single, self-contained commit that
performs the move + canonical sync + report write.

## Reconciliation pass (per sdd-archive skill §Task Completion Gate)

`openspec/changes/projects-crud/tasks.md` was reviewed before archive
per the sdd-archive skill's task-completion gate. Every substep is
already marked `- [x]` in the persisted `tasks.md` (the per-PR
"apply-progress" markers track checkbox flips at apply time). No
mechanical reconciliation was required — the apply phase flipped
checkboxes as it went, leaving the persisted artifact
audit-trail-ready.

## Pre-existing issues left for follow-up changes

These are explicitly OUT OF SCOPE for `projects-crud` and are
documented in `verify-report.md` §6/§7 and `apply-progress.md`
PR2/PR3 deviation sections. Each becomes its own future SDD change.

1. **4 pre-existing lint errors** in
   `src/{contact,reviews}/*.service.ts` (unused DTO params). The
   contact + reviews domain changes own them. The 2 pre-existing
   errors that lived in `src/projects/projects.service.ts` resolved
   to 0 as a side effect of the Task 2.2 rewrite.
2. **DTO `isPublished` bugfix** (PR3 deviation #2) — the
   `ListProjectsQueryDto.isPublished` `@Transform` was designed
   for the `enableImplicitConversion: false` path, but the global
   `ValidationPipe` in `main.ts` uses `enableImplicitConversion:
   true`. With implicit conversion, the string "false" is coerced
   to `Boolean("false") === true` BEFORE the @Transform runs, so
   the @Transform sees `true` (boolean) and returns it. The DTO
   silently flipped `?isPublished=false` to `true`, which would
   have leaked in production. The fix uses the @Transform's `obj`
   parameter to recover the original raw value. A unit regression
   test in `list-projects-query.dto.spec.ts` now locks in the
   implicit-conversion-safe path.
3. **No real-DB E2E subset.** The e2e harness stubs `DATABASE_URL`
   and uses in-memory fakes. The unit suite covers the SQL surface
   (DIFF, slug pre-check, 23505 race-catch) at the service level;
   a real-DB e2e would close the loop on the migration's DDL.

## Open follow-ups (carryover from SUGGESTION findings)

The `verify-report.md` §7 surfaces 4 follow-ups. They are listed in
priority order; the first is the only one with material user impact.

1. **Add `RequestIdMiddleware`** (S1, ~30 lines + spec). The filter
   is already defensive — when `req.id` is `undefined`, the log line
   just omits the field — but operators lose correlation in 5xx
   logs in production. The middleware is the standard "tiny piece
   of glue" pattern that runs BEFORE `ValidationPipe` and
   `AllExceptionsFilter` and survives both happy and error paths.
   File: `src/common/middleware/request-id.middleware.ts`. Wire in
   `src/main.ts` via `app.use(RequestIdMiddleware)` BEFORE the
   `useGlobalFilters` call. The `global-exception-filter` spec
   scenario "x-request-id round-trip" is the acceptance gate.
2. **Add `seed:projects` scripts to `package.json`** (S2, ~2 lines).
   `"seed:projects": "ts-node src/cli/seed-projects.ts"` and
   `"seed:projects:dry-run": "SEED_DRY_RUN=1 ts-node
   src/cli/seed-projects.ts"`. Mirrors the existing `seed:superuser`
   convention.
3. **Add a real-DB E2E subset via docker-compose** (S3, follow-up
   change). The current e2e stubs `DATABASE_URL`. A
   `*.real-db.e2e-spec.ts` file would close the loop on the
   migration's DDL.
4. **Top-level `README.md` "Error response shape" subsection** (S4,
   ~5 lines). The per-domain `src/projects/README.md` already
   documents the canonical envelope; a 5-line top-level mirror
   would make the convention visible without diving into the
   projects README.

## Lessons learned

1. **The DTO `@Transform` `obj` recovery pattern is the correct
   shape for `enableImplicitConversion: true`.** A DTO field that
   depends on the raw query string MUST recover it from the
   `obj` parameter of `@Transform`, not from the (already-coerced)
   `value` parameter. The PR3 e2e surfaced a real production bug
   that the unit suite missed (it tested the wrong path). Future
   DTOs that override class-transformer's implicit conversion
   should follow the same pattern.
2. **`getRepositoryToken` + test fakes are easy to forget.** The
   bootstrap e2e was failing at `Test.createTestingModule().compile()`
   time for the entire PR2/PR3 window because `TestFakesModule` in
   `test/bootstrap.e2e-spec.ts` was never extended with the new
   entity tokens. The fix was 3 lines + 1 import. A future change
   that adds a new entity to `AppDataSource` MUST extend both
   `src/app.module.spec.ts` and `test/bootstrap.e2e-spec.ts` in
   the same PR that adds the entity.
3. **`git mv` for untracked files is not a thing.** The
   orchestrator's "use `git mv`" rule is about history preservation
   for tracked files. Untracked files have no history, so a plain
   `mv` (followed by `git add` at commit time) is the correct
   primitive. The archive's spec files are NEW capabilities that
   have never been committed in the change-dir, so they appear as
   "new file" entries in the archive commit.
4. **The `withRetry` helper is now the canonical pattern for
   `dataSource.transaction(...)` calls.** Both `create` and
   `update` wrap their transactions in `withRetry`. A future
   change that adds another transactional write path MUST use the
   same wrapper. The helper lives in `src/common/with-retry.ts`
   and is covered by `src/common/with-retry.spec.ts` (6 cases).

## Archive rules applied (`openspec/config.yaml > rules.archive`)

- ✅ "Warn before merging destructive deltas" — the deltas are
  additive/non-destructive (2 NEW capabilities, 0 MODIFIED, 0
  REMOVED, 0 RENAMED). No warning needed.
- ✅ "Update `openspec/specs/server_specs.md` with merged deltas" —
  the new capabilities do NOT modify the existing canonical
  contracts; the existing §3.2 text is sufficient as a route-list
  summary and the per-domain spec is the higher-fidelity source.
  No edit to `server_specs.md` was required.
- ✅ "Update `openspec/specs/database-schema.dbml` when entity
  shapes change" — the DBML was updated in-place during PR1
  Task 1.4 (commit `1e2170b`). No further sync needed at archive.
- ⚠️ "Use ISO date format (YYYY-MM-DD) for archive folder prefix"
  — the orchestrator's launch instructions specified
  `openspec/changes/archive/projects-crud/` (no date prefix), so
  the archive folder name is the change name only. This deviates
  from the sdd-archive skill's recommendation (and from the
  auth-domain archive's `2026-06-17-auth-domain` precedent) but
  matches the orchestrator's explicit instruction. The
  bootstrap-api-config archive (the oldest precedent) also used
  the change-name-only format.
- ✅ "Archive is an audit trail — never delete or modify archived
  changes" — the change folder is preserved at
  `openspec/changes/archive/projects-crud/`. The pre-existing
  `apply-progress.md` is preserved as a rename (git's rename
  detection preserved the history). The new capability spec
  files are preserved in the archive's `specs/` folder for audit
  trail (verbatim copies of the canonical versions; byte-identical
  because no transformation was needed).

## Next

The orchestrator will commit the archive (1 rename of `apply-progress.md`
+ 5 new files in the archive + 2 new canonical capability folders +
1 archive report). After that commit, `projects-crud` is closed and
`domain/projects` is ready for the user to push and merge to `main`.
No new SDD change is opened by this archive; the next change
(likely `request-id-middleware`, the `seed:projects` `package.json`
script add, or the first non-projects domain — e.g. `reviews-crud` or
`contact-pipeline`) lands on top of this foundation.

The next concrete domain change should be `reviews-crud` (per the
auth-domain archive's follow-up list), which can now reuse the
`AllExceptionsFilter` for uniform 4xx/5xx envelopes from day one.
