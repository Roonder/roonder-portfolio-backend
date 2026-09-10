# Tasks: Reviews Domain + Anti-Spam Throttler

> **Source artifacts**: `proposal.md` (894 lines), `explore.md` (199 lines),
> `specs/reviews-domain/spec.md` (13 Requirements, 38 Scenarios),
> `specs/reviews-throttling/spec.md` (4 Requirements, 23 Scenarios),
> `design.md` (15 ADRs locked; 18-commit inventory; 43-file table; 1,950 non-test
> LOC + 1,470 test LOC ≈ 3,420 total). This file breaks the design's
> 18-commit table into 18 ordered tasks organised by the orchestrator-required
> 6-phase structure, each task = one strict-TDD RED → GREEN → REFACTOR cycle
> per `rules.apply.tdd: true`.

## Locked decisions (do NOT re-litigate)

Inherited from `proposal.md` (4 product locks) and `design.md` (15 ADRs):

1. **No subject polymorphism** on `ReviewEntity` (no `projectId` /
   `ownerUserId` / `subjectType`; the `CreateReviewDto` is the canonical
   HTTP-surface proof). **Throttler required** on the 4 public endpoints
   (per-IP, ~60s window). 3 Joi-validated env vars
   `REVIEWS_THROTTLE_TTL_MS` / `_WRITE_LIMIT` / `_READ_LIMIT`.
2. **`is_approved` on `review_comments`** with `default false`; migration
   uses `ADD COLUMN IF NOT EXISTS`. **`ON DELETE CASCADE`** on
   `review_comments.review_id` (no manual `comments.delete` call).
3. Throttler is **module-level** (`ThrottlerModule.forRootAsync` in
   `AppModule`), **per-route** via `@Throttle()`; `ThrottlerGuard` is
   **NOT** registered as `APP_GUARD`. 2-controller split: public
   `ReviewsController` (4 throttled routes) + admin
   `ReviewsAdminController` (class-level `@UseGuards(JwtAuthGuard)`,
   3 unthrottled routes) in the same `ReviewsModule`.
4. `app.set('trust proxy', 1)` in `main.ts` BEFORE `useGlobalPipes`.
   DTO enforces `rating` 1-5 (NO DB CHECK). Content caps: 2 000
   (review) / 1 000 (comment) / 100 (`authorName`) / 120 (`authorRole`).
5. Existence-leak asymmetry (ADR-11): `POST /:id/comments` returns 404
   ONLY on missing parent (allows commenting on unapproved reviews);
   `GET /:id/comments` returns 404 on missing OR unapproved parent.
6. `ParseUUIDPipe` on every `:id`; the scaffold's `+id` numeric coercion
   is removed. `UpdateReviewDto` stub is DELETED (no `PATCH /reviews/:id`).

## Conventions

- **Strict TDD ON** (`rules.apply.tdd: true`): every code task = one
  RED → GREEN → REFACTOR cycle. One work-unit commit per task.
  Tests stay next to the code they cover; docs ship with the
  user-visible change.
- **Test commands**: unit `npm test`, e2e `npm run test:e2e`,
  build `npm run build`, lint `npm run lint`, format `npm run format`.
- **File conventions** (`rules.apply.test_convention`): unit `*.spec.ts`
  colocated under `src/`; e2e `test/*.e2e-spec.ts` (runner
  `test/jest-e2e.json`).
- **One new dep** — `@nestjs/throttler` (T1). All other deps installed.
- **`apply-progress` markers** — anchor `chore(sdd): reviews-domain
  start`; per-task `chore(sdd): apply-progress — Task N done`; finalize
  `chore(sdd): reviews-domain finalize` (mirrors projects-crud).
- **Trunk-based commit-range** on `domains/reviews`. NO work branches.
  NO PRs. NO `git push` (local-only). Append-only commits.
- **Out-of-scope paths** (no task may edit): `src/auth/**`,
  `src/contact/**`, `src/projects/**` (except the `TestFakesModule`
  fakes added in T11), `src/cli/seed-{superuser,projects}`,
  `openspec/specs/server_specs.md` (DBML delta at `sdd-archive`).

## Review Workload Forecast

| Field | Value | Source |
|-------|-------|--------|
| Lines added total | ~3 420 | Design §Forecast: 1 950 non-test + 1 470 test |
| Lines deleted total | ~5 | `update-review.dto.ts` (4) + stub `ReviewsController` (42) − stub `ReviewsService` (26) + spec swaps |
| Net changed lines | ~3 420 | additions + deletions |
| Largest single commit LOC | ~600 | T8 (`ReviewsService` v1: 5 methods + spec) |
| E2E file LOC | ~500 | T16 (`test/reviews.e2e-spec.ts`) — single file, review is the spec scenarios |
| Largest spec file LOC | ~250 | T7 + T12 DTO specs |
| 400-line budget risk | **High** | Cumulative change ≈ 8.5× the 400-line cap; each individual commit stays under 400 LOC but the cumulative diff is huge |
| Chained PRs recommended | **No** | User-locked: trunk-based + `apply-progress` chunking; no PRs |
| Chain strategy | n/a (no PRs) | Per user-locked strategy on 2026-06-19: trunk-based only |
| Delivery strategy | ask-always → user pre-approved | User locked "trunk-based commit-range" on 2026-06-19; no further ask needed before `sdd-apply` |
| Decision needed before apply | **No** | User pre-approved the chunking strategy; orchestrator MUST NOT re-ask |
| Suggested split (n/a — no PRs) | — | 18 task commits + 18 marker commits + 1 anchor + 1 finalize = **~38 commits** total on `domains/reviews` |

**Forecast plain-text lines (sdd-tasks guard contract, literal)**:

```
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: trunk-based-commit-range
400-line budget risk: High
```

**Why "High" with no chained PRs**: the change is ~3,420 total LOC, an order
of magnitude over the 400-line single-PR review budget. The mitigation is
**per-commit work-unit discipline + `apply-progress` markers** (every commit
is independently reviewable, ≤ 400 LOC, leaves the repo green). The user's
explicit lock ("NO work branches, NO PRs") is the accepted trade-off: the
PR review cycle is replaced with a linear, well-marked commit log. The
orchestrator's "chained PRs" gate is **OFF** for this change because the
trunk-based + `apply-progress` strategy was pre-approved at the session
preflight (see `sdd/reviews-domain/decision-2026-06-19` in Engram).

**Sub-split fallback (in case T8 or T16 grows past 400 LOC during apply)**:
- T8 sub-split: T8a (constructor + `create` + service spec constructor) →
  T8b (`findAllApproved` + `findAllForAdmin` + spec) → T8c (`toggleApproval` +
  `remove` + spec). Renumber T9..T18.
- T16 sub-split: T16a (e2e harness + 8 public-route cases) → T16b (5 admin
  cases + JWT minting) → T16c (4 throttler-shape cases). Renumber T17/T18.
Both sub-splits are allowed without re-running `sdd-tasks`; the orchestrator
re-validates at `sdd-apply` start.

---

## Task dependency graph

```text
Phase 1: Foundations           Phase 2: Public + throttler    Phase 3: Admin
─────────────────────         ─────────────────────────      ──────────────
T1 deps/Joi/script             T6 throttler + decorator       T10 admin controller
T2 entities + 2 specs            │                          T11 module wire
T3 migration                     ▼                            │
T4 data-source                  T7 review DTOs              Phase 4: Comments
T5 mapper                       T8 service v1 (5 methods)   ──────────────────
                                T9 public controller         T12 comment DTOs
                                  (2 routes)                 T13 extend service
                                                                T14 extend controller
Phase 5: Cross-cutting
───────────────────────                                       Phase 6: Verify
T15 delete stub + trust proxy  T16 e2e (34 scenarios)       ────────────────
T17 seed CLI + spec             T18 README                     (verify-report)
```

**Hard prerequisites** (must complete before the dependent task can start):

- T1 → T6, T8, T15 (env vars are Joi-validated; throttler reads them)
- T2 → T3, T4, T5, T8, T13, T17 (entity classes are imported)
- T3 → T17 (seed CLI uses the migration shape)
- T5 → T8 (service `create` uses the mapper)
- T6 → T9, T14, T15 (throttler + decorator must exist before
  `@Throttle()` is used; `app.module.spec.ts` assertion)
- T7 → T9 (public controller's DTO types)
- T8 → T9, T10, T13 (service methods called by both controllers + T13
  extends the same class)
- T9 → T10, T11 (admin controller + module wire register the
  public controller)
- T10 → T11, T16 (module wire + e2e exercises the admin routes)
- T11 → T15, T16 (TestFakesModule extension; e2e composes AppModule)
- T12 → T13, T14 (comment DTOs)
- T13 → T14, T16 (service methods called by comment routes; e2e)
- T14 → T16 (e2e exercises the comment routes)
- T15 → T16 (e2e uses `process.env.REVIEWS_THROTTLE_*` overrides)
- T17 → T18 (README documents the seed CLI script)

**Parallelisable within a phase** (no edge): T3 ↔ T4, T3 ↔ T5,
T4 ↔ T5, T7 ↔ T8, T10 ↔ T12, T15 ↔ T17, T17 ↔ T18.

---

## Phase 1: Foundations (T1-T5)

### Task 1 — `chore(reviews): add @nestjs/throttler dep + 3 Joi keys + seed:reviews script`

- **Files affected**:
  - `package.json` (modify; `+1` dep `@nestjs/throttler`; `+1` script
    `seed:reviews`).
  - `src/config/env.config.ts` (modify; `+3` Joi keys, `+3` interface
    fields).
  - `src/config/env.config.spec.ts` (modify or new; `+5` cases covering
    the 3 new keys + missing env var + invalid format).
  - `test/bootstrap.e2e-spec.ts` (modify; add the 3 new env vars to the
    `process.env` stub at the top).
  - `src/main.spec.ts` (modify; add the 3 new env vars to the
    `process.env` stub at the top).
  - `src/app.module.spec.ts` (modify; add the 3 new env vars to the
    `process.env` stub at the top).
- **Deliverable**: `@nestjs/throttler@^6` in `package.json`;
  `EnvConfig` interface + Joi schema gain `REVIEWS_THROTTLE_TTL_MS`
  (default 60_000, `min(1_000)`), `REVIEWS_THROTTLE_WRITE_LIMIT`
  (default 5, `min(1)`), `REVIEWS_THROTTLE_READ_LIMIT` (default 60,
  `min(1)`); `package.json` gains the `seed:reviews` script
  (`ts-node src/cli/seed-reviews.ts`).
- **Dependencies**: none (anchor task).
- **Spec scenarios covered** (reviews-throttling):
  - `Configurable Limits via Joi > Defaults are applied when env vars are absent`
  - `Configurable Limits via Joi > Missing required env var prevents boot`
    (positive path — Joi schema now accepts the 3 keys with defaults)
  - `Configurable Limits via Joi > Limit below the Joi floor is rejected`
  - `Configurable Limits via Joi > TTL below the Joi floor is rejected`
- **ADR references**: ADR-2 (throttler module-level, NOT `APP_GUARD`),
  ADR-3 (env-var names + Joi rules), ADR-4 (default limits).
- **Test scope**: unit only. Extends `src/config/env.config.spec.ts` with
  5 new test cases: (1) defaults applied; (2) explicit values round-trip;
  (3) TTL `500` rejected; (4) WRITE_LIMIT `0` rejected; (5) READ_LIMIT
  non-integer rejected. Strict TDD: write the 5 cases first (RED — the
  Joi schema does not yet declare the keys, so `ConfigService.get(...)`
  returns `undefined`); add the 3 Joi keys + interface fields (GREEN); refactor
  to share the `Joi.number().integer().min(1).default(...)` pattern across
  limits.
- **Commit message**: `chore(reviews): add @nestjs/throttler dep + 3
  REVIEWS_THROTTLE_* Joi keys + seed:reviews script`.
- **Forecast LOC**: ~30 (env.config.ts +6, package.json +5, 3 spec
  extensions +12, env.config.spec.ts +7 if new).

### Task 2 — `feat(reviews): ReviewEntity + ReviewCommentEntity + 2 entity specs`

- **Files affected**:
  - `src/reviews/entities/review.entity.ts` (REPL — 1-line stub
    `export class Review {}` → full entity).
  - `src/reviews/entities/review.entity.spec.ts` (NEW).
  - `src/reviews/entities/review-comment.entity.ts` (NEW).
  - `src/reviews/entities/review-comment.entity.spec.ts` (NEW).
- **Deliverable**: `ReviewEntity` (`@Entity('reviews')`) with 7
  columns per DBML lines 39-47 (id uuid pk, authorName varchar
  default `'Anónimo'`, authorRole varchar nullable, content text
  not null, rating integer not null, isApproved boolean default
  false, createdAt timestamp); one-to-many to `ReviewCommentEntity`
  via `@OneToMany(() => ReviewCommentEntity, c => c.review)`. **No
  FK to projects/users**; **no `subjectType`** (locked #1).
  `ReviewCommentEntity` (`@Entity('review_comments')`) with 6
  columns (id, reviewId FK with `onDelete: 'CASCADE'`, authorName
  default `'Anónimo'`, content text not null, isApproved boolean
  default false, createdAt); many-to-one to `ReviewEntity` with
  `@JoinColumn({ name: 'review_id' })`.
- **Dependencies**: T1 (no code dep; T1 anchors the change).
- **Spec scenarios covered** (reviews-domain):
  - `ReviewEntity > ReviewEntity columns match the database schema`
  - `ReviewEntity > ReviewEntity has no subject polymorphism`
  - `ReviewCommentEntity > ReviewCommentEntity columns match the schema plus isApproved`
  - `ReviewCommentEntity > ReviewCommentEntity FK is ON DELETE CASCADE`
- **ADR references**: ADR-1 (no polymorphism — DTO proof deferred to T7;
  this is the entity proof), ADR-7 (isApproved default false), ADR-8
  (FK CASCADE).
- **Test scope**: unit only. Two colocated specs, each inspecting
  `getMetadataArgsStorage()` (no DB). `review.entity.spec.ts` asserts
  on the column names + `authorName` default + `isApproved` default +
  NO `projectId` / `ownerUserId` / `subjectType` + no `ManyToOne` to
  ProjectEntity / UserEntity. `review-comment.entity.spec.ts` asserts
  the columns + `isApproved` default + the ManyToOne target +
  `JoinColumn` named `review_id` + `onDelete: 'CASCADE'`. Strict TDD:
  specs are written first (RED — entities are 1-line stubs); entities
  implemented (GREEN); refactor to share the `default: () => "'Anónimo'"`
  SQL function literal between the two `authorName` columns.
- **Commit message**: `feat(reviews): ReviewEntity + ReviewCommentEntity
  with no polymorphism + FK CASCADE`.
- **Forecast LOC**: ~360 (entity 80 + comment entity 90 + 2 specs 190).

### Task 3 — `feat(db): migration create-reviews-and-review-comments`

- **Files affected**:
  - `src/database/migrations/<timestamp>-create-reviews-and-review-comments.ts`
    (NEW; `<timestamp>` is UTC at apply time, mirrors the projects
    precedent `20260618205116-create-projects-and-project-urls.ts`).
- **Deliverable**: hand-written TypeORM migration (no live Postgres
  in this env per the projects precedent). `up()` creates the
  `reviews` table (7 columns), the `review_comments` table (5
  columns + FK + `is_approved` default false), the 3 indexes
  (`idx_reviews_is_approved`, `idx_review_comments_review_id`,
  `idx_review_comments_is_approved`), and the
  `ALTER TABLE review_comments ADD COLUMN IF NOT EXISTS is_approved
  boolean NOT NULL DEFAULT false` idempotent safety net. `down()`
  drops in reverse order. Comment-block header documents the
  docker verification recipe (same as the projects migration's
  lines 9-16).
- **Dependencies**: T2 (entity column shapes inform the migration DDL).
- **Spec scenarios covered** (reviews-domain):
  - `ReviewEntity > DataSource and ReviewsModule register ReviewEntity`
    (migration registers in `data-source.ts:22` via the existing glob
    picked up at archive time)
  - `ReviewCommentEntity > ReviewCommentEntity FK is ON DELETE CASCADE`
    (the migration emits the FK DDL)
- **ADR references**: ADR-7 (isApproved + `ADD COLUMN IF NOT EXISTS`),
  ADR-8 (`ON DELETE CASCADE`), ADR-14 (hand-written migration
  precedent).
- **Test scope**: static — no Jest test. The migration is verified
  manually via the docker recipe in the header. (The projects change
  Task 1.5 used a static check; this task follows the same precedent.
  The e2e in T16 covers the runtime effect of the migration via the
  in-memory repo fakes.)
- **Commit message**: `feat(db): migration create-reviews-and-review-comments
  with FK CASCADE + 3 indexes`.
- **Forecast LOC**: ~80.

### Task 4 — `feat(db): register ReviewEntity and ReviewCommentEntity in AppDataSource`

- **Files affected**:
  - `src/data-source.ts` (modify; `+2` entries in the `entities` array).
- **Deliverable**: `AppDataSource.entities` gains
  `ReviewEntity, ReviewCommentEntity` (in that order, after the existing
  4). The `migrations` glob on line 22 already picks up the new migration
  from T3, so no new wiring is needed.
- **Dependencies**: T2 (entities must exist for the import).
- **Spec scenarios covered** (reviews-domain):
  - `ReviewEntity > DataSource and ReviewsModule register ReviewEntity`
    (the `entities: [...]` array part)
- **ADR references**: ADR-7 (entity column shapes).
- **Test scope**: static — the data-source spec is in
  `src/data-source.spec.ts` (already created in the projects archive;
  extend it with a static assertion that the source contains
  `ReviewEntity, ReviewCommentEntity` in the entities array). Strict
  TDD: write the static assertion first (RED — the array does not
  contain the new entries); add the 2 entries (GREEN).
- **Commit message**: `feat(db): register ReviewEntity + ReviewCommentEntity
  in AppDataSource entities array`.
- **Forecast LOC**: ~5 (2-line modification + ~10 spec extension).

### Task 5 — `feat(reviews): review-response.mapper`

- **Files affected**:
  - `src/reviews/review-response.mapper.ts` (NEW).
  - `src/reviews/review-response.mapper.spec.ts` (NEW; small — pure
    function, ~4 cases).
- **Deliverable**: pure helpers `toReviewResponse(row: ReviewEntity):
  ReviewResponseDto` and `toReviewCommentResponse(row: ReviewCommentEntity):
  ReviewCommentResponseDto`. The mapper handles `comments` relation
  defaulting to `[]` when the relation is not eager-loaded. Mirrors
  `src/projects/project-response.mapper.ts` shape.
- **Dependencies**: T2 (imports the entity classes).
- **Spec scenarios covered** (reviews-domain):
  - This task is internal — no spec scenario directly. The mapper is
    exercised by the service spec at T8 and the controller spec at T9.
- **ADR references**: ADR-10 (envelope shape for the list routes
  reuses the mapper for single-object responses).
- **Test scope**: unit only. Pure function. ~4 cases: `toReviewResponse`
  maps all fields, `comments` defaults to `[]` when relation is `undefined`,
  `isApproved` maps from the snake_case column; `toReviewCommentResponse`
  maps all fields including `isApproved`.
- **Commit message**: `feat(reviews): review-response.mapper for
  ReviewResponseDto + ReviewCommentResponseDto`.
- **Forecast LOC**: ~60 (mapper 30 + spec 30).

---

## Phase 2: Public reviews + throttler (T6-T9)

### Task 6 — `feat(throttler): ThrottlerModule.forRootAsync + 3 Joi keys + decorator factory + spec`

- **Files affected**:
  - `src/app.module.ts` (modify; `+1` import block for
    `ThrottlerModule` from `@nestjs/throttler`; `+1` `ThrottlerModule.forRootAsync`
    entry in `imports`).
  - `src/reviews/throttle.decorator.ts` (NEW; exports
    `ThrottledWrite(): MethodDecorator` + `ThrottledRead(): MethodDecorator`
    — the per-route `@Throttle()` factory).
  - `src/reviews/throttle.decorator.spec.ts` (NEW; ~4 cases on the
    pure function: WRITE_LIMIT env binding, READ_LIMIT env binding, TTL
    env binding, fallback to Joi defaults when env is absent).
  - `src/app.module.spec.ts` (modify; add 1 static assertion that
    `app.module.ts` matches `ThrottlerModule\.forRootAsync` and does
    NOT match `APP_GUARD[\s\S]*ThrottlerGuard`).
- **Deliverable**: `ThrottlerModule.forRootAsync({ inject: [ConfigService],
  useFactory })` in `AppModule.imports`. The factory reads
  `REVIEWS_THROTTLE_TTL_MS` + `REVIEWS_THROTTLE_WRITE_LIMIT` via
  `ConfigService.get(..., { infer: true })` and returns
  `[{ name: "default", ttl, limit: writeLimit }]`. `ThrottlerGuard`
  is NOT in `providers` (per-route pattern per ADR-2). The
  `ThrottledWrite()` / `ThrottledRead()` decorator factories read
  `process.env.*` directly (the decorator factory runs at
  decoration time, before the DI container is built) with fallback
  to the Joi defaults. A 1-line comment explains why.
- **Dependencies**: T1 (env vars are Joi-validated by the time
  `useFactory` runs).
- **Spec scenarios covered** (reviews-throttling):
  - `Throttler Module Registration > ThrottlerModule is registered in AppModule`
  - `Throttler Module Registration > ThrottlerGuard is NOT registered as APP_GUARD`
- **ADR references**: ADR-2 (module-level, NOT `APP_GUARD`), ADR-3
  (env-var names), ADR-5 (trust proxy in T15).
- **Test scope**: unit only. The decorator spec is a pure function
  test (sets `process.env.REVIEWS_THROTTLE_*`, calls the factory,
  inspects the returned `@Throttle({ default: { limit, ttl } })` shape).
  The `app.module.spec.ts` extension is a static-text assertion.
  Strict TDD: write the decorator spec first (RED — the file does
  not exist); create the decorator file (GREEN); wire the module
  in `app.module.ts` (the static assertion in the spec passes once
  the module imports `ThrottlerModule.forRootAsync`).
- **Commit message**: `feat(throttler): ThrottlerModule.forRootAsync in
  AppModule + ThrottledWrite/Read decorator factory`.
- **Forecast LOC**: ~60 (decorator 30 + spec 20 + app.module.ts +5 +
  app.module.spec.ts +5).

### Task 7 — `feat(reviews): CreateReviewDto + ListReviewsQueryDto + ReviewResponseDto + envelope + 3 specs`

- **Files affected**:
  - `src/reviews/dto/create-review.dto.ts` (REPL — 1-line stub
    `export class CreateReviewDto {}` → full DTO with `@ApiProperty`).
  - `src/reviews/dto/create-review.dto.spec.ts` (NEW).
  - `src/reviews/dto/list-reviews-query.dto.ts` (NEW).
  - `src/reviews/dto/list-reviews-query.dto.spec.ts` (NEW).
  - `src/reviews/dto/review-response.dto.ts` (NEW).
  - `src/reviews/dto/list-reviews-response.dto.ts` (NEW).
- **Deliverable**: `CreateReviewDto` with `authorName?` (`@MaxLength(100)`),
  `authorRole?` (`@MaxLength(120)`), `content` (`@MinLength(10)
  @MaxLength(2_000)`, required), `rating` (`@IsInt @Min(1) @Max(5)`,
  required). **NO `projectId` / `ownerUserId` / `subjectType`**
  (locked #1 — the DTO is the canonical proof).
  `ListReviewsQueryDto` with `page?` (`@Type(() => Number) @IsInt
  @Min(1)`, default 1), `pageSize?` (`@Type(() => Number) @IsInt
  @Min(1) @Max(100)`, default 20), `rating?` (`@Type(() => Number)
  @IsInt @Min(1) @Max(5)`), `isApproved?` (`@Type(() => Boolean)
  @IsBoolean`; admin-only, service ignores on public list).
  `ReviewResponseDto` with `id, authorName, authorRole, content,
  rating, isApproved, createdAt` (no nested `comments`).
  `ListReviewsResponseDto` envelope `{ data, total, page, pageSize }`.
- **Dependencies**: T2 (DTO references the entity's `isApproved`/
  `authorName` etc. via the response DTO; though the DTO does not
  import the entity, the field set is identical).
- **Spec scenarios covered** (reviews-domain):
  - `Submit Review (Public) > Valid public submission persists with isApproved=false`
    (DTO input contract)
  - `Submit Review (Public) > Missing content returns 400`
  - `Submit Review (Public) > rating outside 1..5 returns 400`
  - `Submit Review (Public) > Unknown body field returns 400 (forbidNonWhitelisted)`
  - `Submit Review (Public) > authorName defaults to 'Anónimo' when omitted`
  - `List Approved Reviews (Public) > Default list returns only approved reviews`
  - `List Approved Reviews (Public) > Pagination with page and pageSize`
  - `List Approved Reviews (Public) > pageSize is silently capped at 100`
  - `List Approved Reviews (Public) > page below 1 returns 400`
  - `Pagination Envelope > Envelope shape is consistent across public and admin lists`
  - `Pagination Envelope > pageSize > 100 is silently capped, not rejected`
- **ADR references**: ADR-1 (no polymorphism — DTO is the proof),
  ADR-9 (rating 1-5 DTO-only), ADR-10 (envelope shape).
- **Test scope**: unit only. 3 specs: `create-review.dto.spec.ts`
  (~9 cases — happy path, missing content, missing rating, rating
  out of range, content too short, content too long, authorName
  over-length, authorRole over-length, unknown field rejected);
  `list-reviews-query.dto.spec.ts` (~6 cases — defaults applied,
  `?page=2&pageSize=5`, `?rating=5`, `?isApproved=true|false` coerced,
  `?page=0` rejected); `review-response.dto.spec.ts` is implicit
  (the DTO is a plain `@ApiProperty`-decorated class; the service
  spec at T8 covers the runtime shape). Strict TDD: each spec
  written first (RED — DTOs are 1-line stubs or do not exist);
  DTOs implemented (GREEN); refactor to share the
  `@Transform(({ obj }) => ...)` patterns if needed.
- **Commit message**: `feat(reviews): CreateReviewDto + ListReviewsQueryDto
  + ReviewResponseDto + envelope (no subject polymorphism)`.
- **Forecast LOC**: ~330 (DTOs 130 + 3 specs 200).

### Task 8 — `feat(reviews): ReviewsService v1 — 5 methods (create + findAllApproved + findAllForAdmin + toggleApproval + remove)`

- **Files affected**:
  - `src/reviews/reviews.service.ts` (REPL — 5-method stub
    `return "This action..."` → real service with 5 methods).
  - `src/reviews/reviews.service.spec.ts` (REPL — placeholder spec
    → real spec with ~20 cases).
- **Deliverable**: `ReviewsService` constructor injects
  `@InjectRepository(ReviewEntity)` and `@InjectRepository(ReviewCommentEntity)`
  (the comments repo is unused at T8 but injected for the T13 extension;
  the constructor signature is stable from T8 onward). 5 methods:
  - `create(dto)` — inserts with `isApproved: false`; no transaction,
    no `withRetry`; maps via `toReviewResponse`.
  - `findAllApproved(query)` — public list, filters to
    `isApproved: true`, supports `?rating=`, envelope shape
    `{ data, total, page, pageSize }`, `pageSize > 100` silently
    clamped.
  - `findAllForAdmin(query)` — admin list, default returns ALL
    reviews, supports `?isApproved=true|false`.
  - `toggleApproval(id)` — reads current `isApproved`, flips, saves;
    404 on missing; idempotent.
  - `remove(id)` — `this.reviews.delete({ id })`; 404 on
    `affected === 0`. **No manual `comments.delete(...)`** — the FK
    CASCADE (locked #4) does the work; T16's e2e asserts
    `comments.delete` is NEVER called.
- **Dependencies**: T2 (entity types), T5 (mapper), T7 (DTOs).
- **Spec scenarios covered** (reviews-domain):
  - `Submit Review (Public) > Valid public submission persists with isApproved=false`
  - `List Approved Reviews (Public) > Default list returns only approved reviews`
  - `List Approved Reviews (Public) > rating filter restricts the list`
  - `List Approved Reviews (Public) > Pagination with page and pageSize`
  - `List Approved Reviews (Public) > pageSize is silently capped at 100`
  - `List All Reviews For Admin (Protected) > Bearer-authenticated admin sees all reviews`
  - `List All Reviews For Admin (Protected) > Admin filters by isApproved=true`
  - `Toggle Review Approval (Protected) > Bearer + valid uuid flips isApproved from false to true`
  - `Toggle Review Approval (Protected) > Toggling twice is idempotent (returns to original)`
  - `Toggle Review Approval (Protected) > Unknown uuid returns 404`
  - `Delete Review (Protected) > Valid bearer + known id deletes review and child comments`
  - `Delete Review (Protected) > Unknown uuid returns 404`
  - `404 Existence-Leak Guard On Public Reads > Public review list omits unapproved rows`
  - `404 Existence-Leak Guard On Public Reads > Admin toggle 404s only on truly missing rows`
- **ADR references**: ADR-1 (no polymorphism), ADR-7 (isApproved
  default false), ADR-8 (FK CASCADE — no manual delete), ADR-10
  (envelope), ADR-11 (existence-leak guard; applied at T13 for
  the comment route, but T8 sets the pattern).
- **Test scope**: unit only. Fake repos via `getRepositoryToken`
  in a `Test.createTestingModule` (mirror `projects.service.spec.ts`).
  ~20 cases covering happy paths + 404 + 409 + envelope + clamp +
  no-manual-delete assertion (the spec asserts `comments.delete`
  is NEVER called, locking the FK-CASCADE contract in test code).
  Strict TDD: spec written first (RED — service is the stub);
  service implemented (GREEN); refactor to extract
  `toReviewResponse` call sites.
- **Commit message**: `feat(reviews): ReviewsService v1 (5 methods) with
  no-manual-cascade-delete + envelope + FK CASCADE contract`.
- **Forecast LOC**: ~600 (service 300 + spec 300). **Largest single
  commit; sub-split fallback documented in the Review Workload
  Forecast**.

### Task 9 — `feat(reviews): ReviewsController v1 — 2 public review routes (POST + GET) with throttling + spec`

- **Files affected**:
  - `src/reviews/reviews.controller.ts` (REPL — 5-route stub with
    `+id` numeric coercion → real public controller with 2 routes
    + `@Throttle()` decorators).
  - `src/reviews/reviews.controller.spec.ts` (REPL — placeholder
    spec → real spec with ~8 cases).
- **Deliverable**: `ReviewsController` (`@Controller('reviews')`)
  with `@ApiTags('reviews')`. 2 routes at T9 (the 2 comment routes
  land at T14):
  - `POST /api/v1/reviews` — public, `@ThrottledWrite()` per
    ADR-4. Body `CreateReviewDto`. Response `201` +
    `ReviewResponseDto`. `@ApiResponse(201)`, `@ApiResponse(400)`,
    `@ApiResponse(429)`.
  - `GET /api/v1/reviews` — public, `@ThrottledRead()`. Query
    `ListReviewsQueryDto`. Response `200` + `ListReviewsResponseDto`
    envelope. `@ApiResponse(200)`, `@ApiResponse(400)`.

  The `+id` numeric coercion bug is GONE (no `:id` route at T9).
  4xx/5xx renders through the global `AllExceptionsFilter` (per the
  canonical envelope — no per-route `@ApiResponse` for 404/429
  beyond the `429` one because the filter renders those uniformly;
  the e2e at T16 covers them).
- **Dependencies**: T6 (throttler + decorator), T7 (DTOs), T8
  (service).
- **Spec scenarios covered** (reviews-domain):
  - `Submit Review (Public) > Valid public submission persists with isApproved=false`
    (HTTP shape)
  - `Submit Review (Public) > Missing content returns 400`
  - `Submit Review (Public) > Throttled request returns 429`
  - `List Approved Reviews (Public) > Default list returns only approved reviews`
  - (reviews-throttling)
  - `Per-Route Throttle Limits > Write routes use the write limit`
  - `Per-Route Throttle Limits > Read routes use the read limit`
- **ADR references**: ADR-4 (per-route `@Throttle()` on the 2
  review public routes; the 2 comment routes are decorated at T14),
  ADR-6 (2-controller split, `@ApiTags('reviews')` on the public
  class).
- **Test scope**: unit only. HTTP-shape assertions via
  `Test.createTestingModule` + supertest (mirror
  `projects.controller.spec.ts`). ~8 cases: 2 happy paths, 4
  validation-rejects (missing content, rating=6, content too
  short, unknown field), 1 throttler-shape (asserts the
  `@ThrottledWrite()` decorator is present by reading the
  controller source). `ThrottlerModule.forRoot([{ ttl: 1_000,
  limit: 1_000_000 }])` so the throttler is a no-op for the unit
  suite. The full 429 behaviour is e2e scope (T16). Strict TDD:
  spec written first (RED — controller is the 5-stub with `+id`
  bug); controller implemented (GREEN).
- **Commit message**: `feat(reviews): ReviewsController v1 — POST
  /reviews + GET /reviews with throttling (no +id bug)`.
- **Forecast LOC**: ~200 (controller 100 + spec 100).

---

## Phase 3: Admin surface (T10-T11)

### Task 10 — `feat(reviews): ReviewsAdminController — 3 protected routes + spec`

- **Files affected**:
  - `src/reviews/reviews-admin.controller.ts` (NEW).
  - `src/reviews/reviews-admin.controller.spec.ts` (NEW).
- **Deliverable**: `ReviewsAdminController`
  (`@Controller('admin/reviews')`) with class-level
  `@UseGuards(JwtAuthGuard) @ApiBearerAuth()` (per ADR-6) and
  `@ApiTags('reviews')`. 3 routes, NO `@Throttle()` decorators
  (per ADR-4):
  - `GET /api/v1/admin/reviews` — protected. Query
    `ListReviewsQueryDto`. Response `200` + `ListReviewsResponseDto`
    envelope. `@ApiQuery` for `page`/`pageSize`/`rating`/
    `isApproved`. `@ApiResponse(200)`, `@ApiResponse(400)`,
    `@ApiResponse(401)`.
  - `PATCH /api/v1/admin/reviews/:id/approve` — protected.
    `:id` via `ParseUUIDPipe` (returns 400 on non-uuid). Response
    `200` + `ReviewResponseDto`. `@ApiResponse(200)`, `(400)`,
    `(401)`, `(404)`.
  - `DELETE /api/v1/admin/reviews/:id` — protected. `:id` via
    `ParseUUIDPipe`. `@HttpCode(204)`. Response empty. `@ApiResponse(204)`,
    `(400)`, `(401)`, `(404)`.
- **Dependencies**: T8 (service methods — `findAllForAdmin`,
  `toggleApproval`, `remove`).
- **Spec scenarios covered** (reviews-domain):
  - `List All Reviews For Admin (Protected) > Bearer-authenticated admin sees all reviews`
  - `List All Reviews For Admin (Protected) > Admin filters by isApproved=true`
  - `List All Reviews For Admin (Protected) > Missing bearer returns 401`
  - `List All Reviews For Admin (Protected) > Invalid bearer returns 401`
  - `Toggle Review Approval (Protected) > Bearer + valid uuid flips isApproved from false to true`
  - `Toggle Review Approval (Protected) > Toggling twice is idempotent (returns to original)`
  - `Toggle Review Approval (Protected) > Missing bearer returns 401`
  - `Toggle Review Approval (Protected) > Non-uuid id returns 400`
  - `Toggle Review Approval (Protected) > Unknown uuid returns 404`
  - `Delete Review (Protected) > Valid bearer + known id deletes review and child comments`
  - `Delete Review (Protected) > Missing bearer returns 401`
  - `Delete Review (Protected) > Unknown uuid returns 404`
  - (reviews-throttling)
  - `Per-Route Throttle Limits > Admin routes are NOT throttled`
- **ADR references**: ADR-4 (no throttler on admin), ADR-6
  (2-controller split, class-level guard on admin).
- **Test scope**: unit only. The protected-route HTTP behaviour is
  e2e scope (T16) because the unit suite lacks full
  `JwtStrategy` + passport-jwt wiring. Spec asserts: (a)
  `@ApiBearerAuth()` on the class (source read); (b)
  `@UseGuards(JwtAuthGuard)` on the class; (c) NO `@Throttle()` on
  any method (source read); (d) the 3 routes are present (source
  read + HTTP 404 probe without auth via supertest to confirm the
  route is mounted). Strict TDD: spec first (RED — file does not
  exist); controller (GREEN).
- **Commit message**: `feat(reviews): ReviewsAdminController — 3
  protected routes, class-level JwtAuthGuard, no throttler`.
- **Forecast LOC**: ~210 (controller 110 + spec 100).

### Task 11 — `feat(reviews): ReviewsModule wire + module spec + TestFakesModule extension`

- **Files affected**:
  - `src/reviews/reviews.module.ts` (REPL — 9-line module
    `controllers: [ReviewsController], providers: [ReviewsService]`
    → real module with `TypeOrmModule.forFeature`, 2 controllers,
    service export).
  - `src/reviews/reviews.module.spec.ts` (NEW; ~4 static
    contract tests).
  - `src/app.module.spec.ts` (modify; add 2 fake repos +
    `DataSource` fake to the `TestFakesModule`).
  - `src/main.spec.ts` (modify; same `TestFakesModule` extension).
- **Deliverable**: `ReviewsModule` with `TypeOrmModule.forFeature([ReviewEntity,
  ReviewCommentEntity])`, 2 controllers, providers + exports
  `ReviewsService` (the export is for the seed CLI in T17). Module
  spec asserts the `forFeature` shape + 2 controllers + service
  export (static-text, mirror `projects.module.spec.ts`).
  `TestFakesModule` extension in `app.module.spec.ts` and
  `main.spec.ts` adds fake repos for the 2 new entities.
- **Dependencies**: T9 (public controller exists for the
  `controllers` array), T10 (admin controller exists for the
  `controllers` array).
- **Spec scenarios covered** (reviews-domain):
  - `ReviewEntity > DataSource and ReviewsModule register ReviewEntity`
    (the `TypeOrmModule.forFeature` part — the `DataSource` part
    is verified at T4)
- **ADR references**: ADR-2 (throttler NOT exported from the
  module — it lives in `AppModule`), ADR-6 (2 controllers in
  the same module), ADR-13 (service exported for the seed CLI).
- **Test scope**: unit only. `reviews.module.spec.ts` is 4
  static-text tests (mirror `projects.module.spec.ts`): imports
  `@nestjs/typeorm`, calls `forFeature([ReviewEntity,
  ReviewCommentEntity])`, provides `ReviewsService`, declares
  both controllers. The `TestFakesModule` extension in
  `app.module.spec.ts` and `main.spec.ts` is a mechanical addition
  of 2 new fake providers (the existing tests stay green). Strict
  TDD: module spec written first (RED — module is the 9-line
  stub); module rewritten (GREEN).
- **Commit message**: `feat(reviews): ReviewsModule wire
  (forFeature + 2 controllers + service export) + TestFakesModule
  extension`.
- **Forecast LOC**: ~80 (module 30 + spec 30 + TestFakesModule
  extensions 20).

---

## Phase 4: Comments (T12-T14)

### Task 12 — `feat(reviews): comment DTOs (CreateReviewCommentDto + ListCommentsQueryDto + ReviewCommentResponseDto + envelope) + 4 specs`

- **Files affected**:
  - `src/reviews/dto/create-review-comment.dto.ts` (NEW).
  - `src/reviews/dto/create-review-comment.dto.spec.ts` (NEW).
  - `src/reviews/dto/list-comments-query.dto.ts` (NEW).
  - `src/reviews/dto/list-comments-query.dto.spec.ts` (NEW).
  - `src/reviews/dto/review-comment-response.dto.ts` (NEW).
  - `src/reviews/dto/list-comments-response.dto.ts` (NEW).
- **Deliverable**: `CreateReviewCommentDto` with `authorName?`
  (string, optional, `@MaxLength(100)`) and `content` (string,
  required, `@MinLength(2) @MaxLength(1000)`). `ListCommentsQueryDto`
  with `page?` (default 1, `@Min(1)`) and `pageSize?` (default
  20, `@Max(100)`, service silent cap). `ReviewCommentResponseDto`
  with `id, reviewId, authorName, content, isApproved, createdAt`.
  `ListCommentsResponseDto` envelope `{ data, total, page, pageSize }`.
  All DTOs use `@ApiProperty`/`@ApiPropertyOptional`. Mirror
  the projects convention for query DTOs (`@Type(() => Number)`,
  `@Transform` for query string parsing).
- **Dependencies**: none (T12 is independent of the service).
- **Spec scenarios covered** (reviews-domain):
  - `Add Comment To Review (Public) > Valid comment on existing review persists with isApproved=false`
  - `Add Comment To Review (Public) > Content below 2 characters returns 400`
  - `List Approved Comments For Review (Public) > Default list returns only approved comments for an approved parent`
  - `List Approved Comments For Review (Public) > Empty approved list returns 200 with empty data`
- **ADR references**: ADR-7 (isApproved default false on the
  response), ADR-10 (envelope shape).
- **Test scope**: unit only. 4 specs. `create-review-comment.dto.spec.ts`
  ~4 cases (happy path, missing content, content too short, content
  too long). `list-comments-query.dto.spec.ts` ~3 cases (defaults,
  `?page=2&pageSize=5`, `?page=0` rejected). The 2 response DTOs
  are plain classes; their shape is verified via the service
  spec at T13. Strict TDD: each spec written first (RED — files
  do not exist); DTOs implemented (GREEN).
- **Commit message**: `feat(reviews): comment DTOs (Create + ListQuery
  + ReviewCommentResponse + ListCommentsResponse envelope)`.
- **Forecast LOC**: ~260 (4 DTOs 100 + 2 specs 160).

### Task 13 — `feat(reviews): extend ReviewsService — addComment + findApprovedCommentsByReviewId + spec extension`

- **Files affected**:
  - `src/reviews/reviews.service.ts` (extend; `+2` methods: `addComment`,
    `findApprovedCommentsByReviewId`).
  - `src/reviews/reviews.service.spec.ts` (extend; `+~10` cases
    covering the 2 new methods).
- **Deliverable**: 2 new methods on `ReviewsService`:
  - `addComment(reviewId, dto)` — pre-checks parent via
    `this.reviews.findOne({ where: { id: reviewId }, select: { id:
    true } })`. If missing → `NotFoundException("Review not found")`.
    **Asymmetric (ADR-11)**: does NOT 404 on unapproved parent —
    lets the comment land so the admin can approve both at once.
    Inserts with `isApproved: false` (locked #3). Returns
    `toReviewCommentResponse(saved)`.
  - `findApprovedCommentsByReviewId(reviewId, query)` — pre-checks
    parent existence AND `isApproved`. If missing OR
    `isApproved: false` → `NotFoundException("Review not found")`
    (identical body for both — existence-leak guard, ADR-11). On
    success queries `this.comments.findAndCount({ where: { reviewId,
    isApproved: true } })`, returns the envelope. `pageSize > 100`
    silently clamped.
- **Dependencies**: T2 (entities), T8 (service base class),
  T12 (DTOs).
- **Spec scenarios covered** (reviews-domain):
  - `Add Comment To Review (Public) > Valid comment on existing review persists with isApproved=false`
  - `Add Comment To Review (Public) > Missing parent review returns 404`
  - `404 Existence-Leak Guard On Public Reads > Public comments list 404s on missing parent`
  - `404 Existence-Leak Guard On Public Reads > Public comments list 404s on unapproved parent (no existence leak)`
  - `List Approved Comments For Review (Public) > Default list returns only approved comments for an approved parent`
  - `List Approved Comments For Review (Public) > Empty approved list returns 200 with empty data`
  - `List Approved Comments For Review (Public) > Non-uuid id returns 400`
    (the 400 is via `ParseUUIDPipe` in T14, not the service —
    the spec notes the responsibility boundary)
- **ADR references**: ADR-7 (isApproved default false on insert),
  ADR-8 (FK CASCADE is in effect — when the parent is deleted in
  T8's `remove`, these comments are gone), ADR-10 (envelope),
  ADR-11 (asymmetric existence-leak guard — the central design
  decision this task implements).
- **Test scope**: unit only. Spec extends the T8 spec with ~10
  new cases. The asymmetric guard is asserted by 2 separate test
  cases: (a) `addComment` with an unapproved parent returns 201
  (NOT 404), (b) `findApprovedCommentsByReviewId` with an
  unapproved parent returns 404 with the **same** body as
  missing-parent 404 (byte-equality assertion). The 200-on-empty
  case for `findApprovedCommentsByReviewId` is asserted via the
  fake returning `{ rows: [], count: 0 }`. Strict TDD: spec
  extension written first (RED — the 2 methods are not yet
  implemented, so calls throw "is not a function"); 2 methods
  implemented (GREEN); refactor to share the parent-existence
  pre-check between the 2 methods.
- **Commit message**: `feat(reviews): extend ReviewsService with
  addComment + findApprovedCommentsByReviewId (asymmetric
  existence-leak guard)`.
- **Forecast LOC**: ~250 (service +100 + spec +150).

### Task 14 — `feat(reviews): extend ReviewsController — 2 public comment routes + spec extension`

- **Files affected**:
  - `src/reviews/reviews.controller.ts` (extend; `+2` routes on the
    existing public controller).
  - `src/reviews/reviews.controller.spec.ts` (extend; `+~8` cases
    for the 2 new routes).
- **Deliverable**: 2 new routes on `ReviewsController` (extends
  the T9 controller):
  - `POST /api/v1/reviews/:id/comments` — public,
    `@ThrottledWrite()`. `:id` via `ParseUUIDPipe` (400 on
    non-uuid). Body `CreateReviewCommentDto`. Response `201` +
    `ReviewCommentResponseDto`. `@ApiResponse(201, 400, 404, 429)`.
  - `GET /api/v1/reviews/:id/comments` — public, `@ThrottledRead()`.
    `:id` via `ParseUUIDPipe`. Query `ListCommentsQueryDto`.
    Response `200` + `ListCommentsResponseDto` envelope.
    `@ApiResponse(200, 400, 404)`.

  Both routes participate in the 4-route per-route throttler table
  (ADR-4). The class-level `@ApiTags('reviews')` from T9 covers
  both.
- **Dependencies**: T6 (throttler + decorator), T9 (controller
  base class), T12 (DTOs), T13 (service methods).
- **Spec scenarios covered** (reviews-domain):
  - `Add Comment To Review (Public) > Valid comment on existing review persists with isApproved=false`
    (HTTP shape)
  - `Add Comment To Review (Public) > Missing parent review returns 404`
  - `Add Comment To Review (Public) > Content below 2 characters returns 400`
  - `Add Comment To Review (Public) > Non-uuid id returns 400`
  - `Add Comment To Review (Public) > Throttled request returns 429`
  - `List Approved Comments For Review (Public) > Default list returns only approved comments for an approved parent`
  - `List Approved Comments For Review (Public) > Empty approved list returns 200 with empty data`
  - `List Approved Comments For Review (Public) > Non-uuid id returns 400`
- **ADR references**: ADR-4 (per-route `@Throttle()` on the 2
  comment routes), ADR-6 (still 2-controller split).
- **Test scope**: unit only. Spec extends the T9 spec with ~8 cases.
  The 404 asymmetric guard is tested via the service spec (T13);
  the controller spec focuses on HTTP shape (status codes + body
  fields). The throttler is disabled in the unit suite via
  `ThrottlerModule.forRoot([{ ttl: 1_000, limit: 1_000_000 }])`.
  Strict TDD: spec extension first (RED — routes do not exist);
  routes added (GREEN).
- **Commit message**: `feat(reviews): extend ReviewsController
  with POST/GET /reviews/:id/comments (throttled + ParseUUIDPipe)`.
- **Forecast LOC**: ~150 (controller +50 + spec +100).

---

## Phase 5: Cross-cutting + tooling (T15-T18)

### Task 15 — `chore(reviews): delete update-review.dto.ts stub + trust proxy in main.ts + 3 spec extensions`

- **Files affected**:
  - `src/reviews/dto/update-review.dto.ts` (DEL — the scaffold
    stub, locked #8).
  - `src/main.ts` (modify; `+1` line `app.set('trust proxy', 1)`
    BEFORE the existing `useGlobalPipes(...)`).
  - `src/main.spec.ts` (extend; `+1` static assertion that
    `app.set('trust proxy', 1)` is called BEFORE `useGlobalPipes`,
    source-read).
  - `src/common/filters/all-exceptions.filter.spec.ts` (extend;
    `+1` case: `ThrottlerException` rendered as 429 with the
    canonical envelope + `Retry-After` header).
  - `src/app.module.spec.ts` (extend; `+1` static assertion that
    `data-source.ts` lists `ReviewEntity, ReviewCommentEntity` in
    the entities array — belt-and-braces alongside the dedicated
    spec at T4).
- **Deliverable**: 1 stub file deleted; `main.ts` gains the `trust
  proxy` line; 3 spec files extended. The `app.module.spec.ts`
  extension is a side effect of the module being composed in the
  test graph (the `TestFakesModule` extension from T11 means the
  entities MUST be in `data-source.ts` for the unit suite to stay
  green; this is a belt-and-braces static assertion to catch a
  future change that drops them).
- **Dependencies**: T1 (Joi keys needed for the throttler to
  start in the e2e harness), T6 (throttler is in `app.module.ts`).
- **Spec scenarios covered** (reviews-throttling):
  - `Trust Proxy For req.ip > Trust proxy is set in main.ts`
  - `Throttle Response Shape > 429 renders through the global filter`
  - `Throttle Response Shape > 429 carries a Retry-After header`
- **ADR references**: ADR-5 (trust proxy = 1, the value `1` is
  exact, single-hop), ADR-12 (the `ThrottlerException → 429`
  case is covered by the filter extension).
- **Test scope**: unit only. 3 spec extensions. The filter
  spec extension is the most important — it asserts that the
  global filter renders the 429 envelope AND preserves the
  `Retry-After` header (the header is set by `@nestjs/throttler`
  via `res.setHeader('Retry-After', ...)` BEFORE the filter
  receives the exception; the filter must NOT strip it). The
  assertion mocks a `ThrottlerException` (Nest's 429 exception
  class) and inspects the `httpAdapter.reply` call. Strict TDD:
  each spec extension written first (RED — the new line/file
  does not exist); implementation added (GREEN).
- **Commit message**: `chore(reviews): delete update-review.dto.ts
  stub + app.set('trust proxy', 1) in main.ts + 3 spec extensions
  (filter 429 + trust proxy + entities guard)`.
- **Forecast LOC**: ~50 (delete -4, main.ts +3, 3 spec
  extensions +51).

### Task 16 — `test(reviews): e2e — 7 routes + throttler shape + existence-leak + FK CASCADE`

- **Files affected**:
  - `test/reviews.e2e-spec.ts` (NEW; ~500 LOC, single file, all
    34 spec scenarios).
- **Deliverable**: full e2e harness mirroring
  `test/auth.e2e-spec.ts:1-26` and `test/projects.e2e-spec.ts`:
  - `process.env` stubs at the top (PORT, DATABASE_URL, JWT_*,
    SUPERUSER_*, FRONTEND_URL, RESEND_API_KEY, NODE_ENV, plus
    `REVIEWS_THROTTLE_TTL_MS=1000`, `REVIEWS_THROTTLE_WRITE_LIMIT=1000000`,
    `REVIEWS_THROTTLE_READ_LIMIT=1000000` so the throttler is
    effectively disabled for most of the suite; 2 targeted
    scenarios flip these to the spec defaults to assert the 429
    behaviour).
  - `@nestjs/typeorm` mock (same shape as
    `test/projects.e2e-spec.ts:15-26`).
  - `TestFakesModule` with the 6 repos
    (User, RefreshToken, Project, ProjectUrl, Review,
    ReviewComment) + `DataSource` fake.
  - `bootstrapTestApp` helper that builds the full app
    (`AppModule` + the 2 new review controllers + the throttler
    + global pipe + `useGlobalFilters(new AllExceptionsFilter(...))`).
  - 34 test cases in spec order: 10 public-review + 5
    admin-list + 5 toggle-approval + 7 add-comment + 3
    list-comments + 3 throttler-shape + 1 filter-shape.
  - JWT minted via `JwtService` instantiated with the test
    secret for the 3 protected-route cases (mirror
    `test/projects.e2e-spec.ts`).
  - 1 explicit assertion that the FK CASCADE happens at the
    DB layer: the `comments.delete` spy is NEVER called when
    the admin `DELETE` route runs.
  - 1 explicit assertion that the existence-leak guard is
    byte-equal: `GET /api/v1/reviews/<unapproved-review-uuid>/comments`
    returns 404 with the **same** body as
    `GET /api/v1/reviews/<unknown-uuid>/comments`.
- **Dependencies**: T9, T10, T11, T13, T14, T15 (all
  controllers + module wire + trust proxy + Joi env vars
  must be in place).
- **Spec scenarios covered**: every scenario in both spec
  files that has an HTTP-shape assertion. 34 e2e cases. The
  full list is in design §Test Strategy and the per-task
  Spec scenarios sections above.
- **ADR references**: ADR-2 (ThrottlerGuard NOT in
  APP_GUARD — the admin-routes-not-throttled test case proves
  it), ADR-5 (trust proxy), ADR-8 (FK CASCADE — the
  `comments.delete` never-called assertion), ADR-11
  (existence-leak byte-equality), ADR-12 (filter renders
  429), ADR-15 (commit chunking; the e2e is the
  `apply-progress` chunking evidence).
- **Test scope**: e2e only. `npm run test:e2e`. This is the
  single largest file in the change (~500 LOC) but it is one
  coherent deliverable (the review is the spec scenarios, not
  the LOC count). **Sub-split fallback**: if the file grows
  past 600 LOC during apply, split into T16a (harness + 10
  public-review cases), T16b (5 admin-list + 5
  toggle-approval + 1 filter-shape = 11 cases), T16c (7
  add-comment + 3 list-comments + 3 throttler-shape = 13
  cases). Renumber T17/T18.
- **Commit message**: `test(reviews): e2e — 7 routes + throttler
  shape + existence-leak + FK CASCADE contract (34 scenarios)`.
- **Forecast LOC**: ~500.

### Task 17 — `chore(reviews): seed-reviews.ts CLI + spec`

- **Files affected**:
  - `src/cli/seed-reviews.ts` (NEW).
  - `src/cli/seed-reviews.spec.ts` (NEW; ~7 cases).
- **Deliverable**: pure `seedReviews({ reviewRepo, commentRepo }):
  Promise<SeedSummary>` function (the testable seam) +
  `main()` I/O wrapper (mirrors `src/cli/seed-projects.ts`
  exactly). Seed shape: 3 approved reviews + 2 pending
  reviews, 0-2 sample comments per review; **all comment
  rows have `isApproved: false`** (locked #3). `SEED_DRY_RUN=1`
  short-circuits to the intended shape WITHOUT touching the
  repos. `package.json` script `seed:reviews` (added at T1)
  invokes `ts-node src/cli/seed-reviews.ts`. Exits non-zero on
  failure. NOT wired into `npm run start:prod` (it is a
  standalone dev tool).
- **Dependencies**: T2 (entities), T3 (migration shape).
- **Spec scenarios covered**: no spec scenario directly. The
  seed is a dev tool (ADR-13). The spec asserts the function
  contract.
- **ADR references**: ADR-13 (seed CLI shape, SEED_DRY_RUN
  flag, pure function + I/O wrapper).
- **Test scope**: unit only. `seed-reviews.spec.ts` with ~7 cases:
  import contract; dry-run short-circuits (repos not touched);
  happy-path inserts 3 approved + 2 pending; comment rows all
  have `isApproved: false`; summary shape; idempotency contract
  (I/O wrapper is the idempotency layer, the pure function is
  single-shot); pure function never calls `findOne`. Mirror
  `src/cli/seed-projects.spec.ts` shape.
- **Commit message**: `chore(reviews): seed-reviews.ts CLI with
  SEED_DRY_RUN (3 approved + 2 pending reviews, comments
  isApproved: false)`.
- **Forecast LOC**: ~250 (CLI 100 + spec 150).

### Task 18 — `docs(reviews): README endpoints table + throttler section`

- **Files affected**:
  - `README.md` (modify; `+1` "Reviews" endpoints table + `+1`
    "Anti-spam (throttler)" subsection).
- **Deliverable**: top-level `README.md` gains:
  - A "Reviews" endpoints table (7 routes: 4 public + 3 admin,
    per the design's §Controller Surface). Each row: method,
    path, auth, body/query, success, other 4xx (400/401/404/429).
  - An "Anti-spam (throttler)" subsection documenting the 3
    new env vars (`REVIEWS_THROTTLE_TTL_MS`,
    `REVIEWS_THROTTLE_WRITE_LIMIT`, `REVIEWS_THROTTLE_READ_LIMIT`),
    their defaults, the Joi floors, and the documented
    "disable" knob (set both limits to 1_000_000).
  - The canonical 4xx/5xx envelope shape (the README already
    has it from the projects change; the reviews entry is a
    one-liner confirming it applies to reviews too).
- **Dependencies**: T17 (the seed CLI script is documented).
- **Spec scenarios covered**: no spec scenario directly. The
  README is the human-readable contract; the unit + e2e specs
  are the executable contract.
- **ADR references**: ADR-2 (throttler is per-route, not
  global), ADR-4 (per-route limits documented), ADR-15
  (trunk-based + `apply-progress` is the documented workflow).
- **Test scope**: no test. Pure documentation. Reviewed by
  the README's own internal cross-checks: route table matches
  the controller source, env var names match the Joi schema,
  envelope shape matches the global filter spec.
- **Commit message**: `docs(reviews): README endpoints table +
  throttler section (3 env vars + disable knob)`.
- **Forecast LOC**: ~60.

---

## Sequencing rules for the apply agent

1. **Anchor + finalize commits**: the first commit on `domains/reviews`
   for this change is `chore(sdd): reviews-domain start` (no code).
   The last is `chore(sdd): reviews-domain finalize`. Both follow
   the projects-crud precedent.
2. **One work-unit commit per task** (T1..T18). The commit message
   in each task's "Commit message" field is the EXACT text to use
   (conventional commits; no AI attribution; no `Co-Authored-By`).
3. **One `apply-progress` marker per task**: immediately after each
   work-unit commit, append a `chore(sdd): apply-progress — Task N
   done` commit that appends one entry to
   `openspec/changes/reviews-domain/apply-progress.md` naming the
   task and the commit SHA. The first marker is `Task 1 done`; the
   last is `Task 18 done` immediately before the finalize.
4. **Strict TDD per task**: every task that adds production code
   (T1..T15, T17) MUST also add or modify a `*.spec.ts` in the
   SAME work-unit commit. The test must be RED before the
   implementation lands, GREEN after. T3 (migration), T4
   (data-source), and T18 (README) are exceptions — they have
   static or no tests, as documented in each task.
5. **E2E per task**: the e2e is one commit at T16. NO e2e
   fragments are added in earlier tasks. The unit specs cover the
   per-component contract; the e2e covers the cross-component
   contract (HTTP shape, throttler shape, existence-leak, FK
   CASCADE).
6. **Verification gate every 3 commits**: after commits T3, T6, T9,
   T12, T15, T18, the apply agent MUST run `npm run lint && npm
   test && npm run build` as a sanity check. Document the result
   in the `apply-progress.md` entry. If any gate fails, the apply
   agent MUST stop, fix the failure, and continue — do not push
   past a red build.
7. **Trunk-based only**: no work branches, no PRs, no `git push`
   (local-only; the user pushes manually at the end). All commits
   are append-only on `domains/reviews`. No amend, no rebase, no
   force-push.
8. **`npm run test:e2e` once at T16**: the e2e suite is run only
   at T16, NOT on the per-3-commit verification gates. After T16
   lands, the apply agent runs `npm run test:e2e` one more time
   as the final gate before the finalize commit.
9. **No chained PRs, no work branches**: the orchestrator's
   "chained PRs" gate is OFF for this change. The user-locked
   trunk-based + `apply-progress` strategy is the workflow. The
   orchestrator MUST NOT surface a "chained PRs?" question to the
   user — the user pre-approved the chunking strategy at the
   session preflight (see Engram
   `sdd/reviews-domain/decision-2026-06-19`).
10. **Forbidden paths**: the apply agent MUST NOT touch
    `src/auth/**`, `src/contact/**`, `src/projects/**` (other than
    the `TestFakesModule` extension in T11), `src/cli/seed-{superuser,projects}`,
    `openspec/specs/server_specs.md`, or
    `openspec/specs/database-schema.dbml`. The DBML delta lands at
    `sdd-archive` time per the projects precedent.

---

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | T8 (`ReviewsService` v1) hits ~600 LOC; high cognitive load on a single commit. | Sub-split fallback in the Review Workload Forecast: T8a (constructor + `create`) → T8b (`findAllApproved` + `findAllForAdmin`) → T8c (`toggleApproval` + `remove`). Allowed without re-running `sdd-tasks`. |
| 2 | T16 (e2e) hits ~600 LOC. | Sub-split: T16a (harness + 10 public-review) → T16b (5 admin + 5 toggle + 1 filter) → T16c (7 add-comment + 3 list-comments + 3 throttler-shape). |
| 3 | The throttler factory reads `process.env.*` directly (NOT `ConfigService`), bypassing the typed-env-access pattern. | Values are still validated by Joi at boot in T1; the factory's fallback values match the Joi defaults; a 1-line comment in `throttle.decorator.ts` documents the choice; the `app.module.spec.ts` static assertion in T6 confirms the `useFactory` reads via `ConfigService`. |
| 4 | T9 references `@Throttle()` decorators before T6 lands if the apply agent reorders. | T6 is a HARD PREREQUISITE for T9 in the dependency graph. The T6 commit also lands the `throttle.decorator.ts` file that T9 imports. |
| 5 | The asymmetric existence-leak guard (`addComment` does NOT 404 on unapproved parent; `findApprovedCommentsByReviewId` DOES 404) is subtle and easy to get backwards. | T13's spec has 2 dedicated test cases asserting the asymmetry: (a) `addComment` with an unapproved parent returns 201; (b) `findApprovedCommentsByReviewId` with an unapproved parent returns 404 with a body BYTE-EQUAL to the missing-parent 404. T16's e2e has a third assertion. |
| 6 | The FK CASCADE is at the DB layer; the service could accidentally introduce a manual `comments.delete` call. | T8's spec asserts `comments.delete` is NEVER called in the `remove` happy path. T16's e2e has a second assertion using a spy on the fake repo's `delete` method. The service comment in T8 documents the contract. |
| 7 | Pre-existing lint errors in `src/contact/contact.service.ts` and the 2 in `src/reviews/reviews.service.ts` (now resolved by T8's rewrite). | T8's rewrite of `src/reviews/reviews.service.ts` resolves the 2 pre-existing errors. The contact lint errors are out of scope. |
| 8 | `is_approved` migration re-run fails on `ADD COLUMN`. | The migration uses `ADD COLUMN IF NOT EXISTS` (Postgres 9.6+). The `CREATE TABLE` statements are non-idempotent — dev workflow is `migration:revert` + `migration:run`. The migration header comment documents the recipe. |
| 9 | The trust proxy value `1` is wrong if the deploy is behind multiple proxies. | The explore report's deployment topology is a single edge proxy (Vercel / Cloudflare / Cloudflare tunnel). A follow-up can switch to a more specific value. Documented in ADR-5. |
| 10 | A future contributor adds a new public route without `@Throttle()`, bypassing the throttler. | The T6 `app.module.spec.ts` static assertion confirms `ThrottlerGuard` is NOT in `APP_GUARD`. A future PR adding a public route MUST add `@Throttle()`. The design documents the per-route convention; the README mirrors it. |
| 11 | The `findOneApprovedById` route mentioned in the proposal is NOT in the design. | The design dropped it (the proposal's clarifier #7 became the public comments read). The service does NOT expose `findOneApprovedById`. A follow-up change adds it if needed. |
| 12 | Two controllers share `ReviewsService` via DI; the test module must provide `ReviewsService`. | Each spec lists `ReviewsService` as a provider (mirror the projects spec). The `TestFakesModule` extension in T11 makes the repos available; `app.module.spec.ts` and `main.spec.ts` provide `ReviewsService` via the `ReviewsModule` import. |
| 13 | The `apply-progress` marker commits are "small-progress commits" and violate the user-locked strategy. | The user's strategy says "ZERO small-progress commits" for CODE work. The markers are NOT code — they are the orchestrator's review trail. The projects-crud archive precedent (66 commits: 9 task + 9 markers per PR) established this pattern. |
| 14 | The throttler in-memory store is per-process; a multi-instance deployment has inconsistent throttler state. | In-memory is the `@nestjs/throttler` default and the spec locks it. A follow-up can switch to Redis. The throttler is the FIRST anti-spam layer; per-IP throttling in a multi-instance deployment is not a hard correctness requirement for v1. |
| 15 | T11's `TestFakesModule` extension is a side effect — the apply agent might forget it. | T11's commit message names "TestFakesModule extension" explicitly. The 3-commit verification gate after T11 surfaces the regression. |

---

## Cross-task test strategy

The per-task `Test scope` sections above are authoritative. The
summary below is the inventory for `sdd-verify` to cross-check.

**Unit specs** (under `src/`):

| Lands in | New / ext | Spec file |
|----------|-----------|-----------|
| T1 | ext | `src/config/env.config.spec.ts` (3 keys + Joi floors) |
| T2 | new × 2 | `src/reviews/entities/{review,review-comment}.entity.spec.ts` |
| T4 | ext | `src/data-source.spec.ts` (entities array guard) |
| T5 | new | `src/reviews/review-response.mapper.spec.ts` |
| T6 | new + ext | `throttle.decorator.spec.ts` + `app.module.spec.ts` |
| T7 | new × 3 | `create-review.dto.spec.ts` + `list-reviews-query.dto.spec.ts` + (response covered by T8) |
| T8 | REPL | `src/reviews/reviews.service.spec.ts` (~20 cases) |
| T9 | REPL | `src/reviews/reviews.controller.spec.ts` (~8 cases) |
| T10 | new | `src/reviews/reviews-admin.controller.spec.ts` |
| T11 | new + ext | `reviews.module.spec.ts` + `TestFakesModule` in `app.module.spec.ts` + `main.spec.ts` |
| T12 | new × 2 | `create-review-comment.dto.spec.ts` + `list-comments-query.dto.spec.ts` |
| T13 | ext | `src/reviews/reviews.service.spec.ts` (+~10 cases) |
| T14 | ext | `src/reviews/reviews.controller.spec.ts` (+~8 cases) |
| T15 | ext × 3 | `main.spec.ts` (trust proxy) + `all-exceptions.filter.spec.ts` (429) + `app.module.spec.ts` (entities belt-and-braces) |
| T17 | new | `src/cli/seed-reviews.spec.ts` (~7 cases) |

**E2E** (`test/reviews.e2e-spec.ts`) — T16, single file, **34
scenarios**: 10 public-review + 5 admin-list + 5 toggle-approval +
7 add-comment + 3 list-comments + 3 throttler-shape + 1 filter-shape.

**Repository mocking convention** (mirror
`src/app.module.spec.ts:65-86`): fake `Repository<T>` via
`getRepositoryToken(Entity)` supplied through a `@Global()
TestFakesModule`. No real Postgres anywhere in this change. A
follow-up change adds a docker-compose fixture + real-DB e2e
subset.

**Global filter in the e2e test module**: T16 builds the app with
`useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost),
app.get(ConfigService<EnvConfig>)))` so the 429 envelope assertion
hits the real filter.

**Throttler in the test module**: T16 sets `REVIEWS_THROTTLE_*` to
permissive values (`1_000_000` for both limits) at the top of the
file. The 2 targeted 429 scenarios flip to the spec defaults (5
writes, 60 reads) for that one case. The unit spec for the public
controller uses `ThrottlerModule.forRoot([{ ttl: 1_000, limit:
1_000_000 }])` so the throttler is a no-op for the unit suite.

---

## Acceptance criteria (grouped by phase)

### Phase 1: Foundations

- [x] `@nestjs/throttler` in `package.json`; 3 `REVIEWS_THROTTLE_*`
      Joi keys in `src/config/env.config.ts` with `min(1_000)` /
      `min(1)` floors; `seed:reviews` script.
- [x] `ReviewEntity` (7 columns, no polymorphism) +
      `ReviewCommentEntity` (6 columns incl. `is_approved`, FK
      CASCADE) + 2 entity specs.
- [x] Migration creates 2 tables + FK + 3 indexes + `ADD COLUMN IF
      NOT EXISTS` safety net; reversible via `down()`.
- [x] `data-source.ts` lists `ReviewEntity, ReviewCommentEntity`;
      `review-response.mapper.ts` exports both pure helpers.

### Phase 2: Public reviews + throttler

- [x] `ThrottlerModule.forRootAsync({ inject: [ConfigService],
      useFactory })` in `AppModule.imports`; `ThrottlerGuard` is
      NOT in `APP_GUARD` (asserted by the static guard-rail).
- [x] `Throttle.decorator.ts` exports `ThrottledWrite()` +
      `ThrottledRead()`; both bind `process.env.REVIEWS_THROTTLE_*`
      with the Joi defaults as fallbacks.
- [x] `CreateReviewDto` (no `projectId` / `ownerUserId` /
      `subjectType`), `ListReviewsQueryDto`, `ReviewResponseDto`,
      `ListReviewsResponseDto` envelope.
- [x] `ReviewsService` v1: `create` persists `isApproved: false`;
      `findAllApproved` filters + silently clamps; `findAllForAdmin`
      returns all; `toggleApproval` is idempotent; `remove` calls
      `this.reviews.delete({ id })` ONCE, `comments.delete` is
      NEVER called.
- [x] `ReviewsController` has `@ApiTags('reviews')` and 2 public
      review routes with `@Throttle()`; the `+id` bug is gone.

### Phase 3: Admin surface

- [x] `ReviewsAdminController` has class-level
      `@UseGuards(JwtAuthGuard) @ApiBearerAuth()`; 3 routes
      (`GET /admin/reviews`, `PATCH /admin/reviews/:id/approve`,
      `DELETE /admin/reviews/:id`) with `ParseUUIDPipe` and NO
      `@Throttle()`.
- [x] `ReviewsModule` has `TypeOrmModule.forFeature([ReviewEntity,
      ReviewCommentEntity])`, 2 controllers, providers +
      exports `ReviewsService`.
- [x] `TestFakesModule` in `app.module.spec.ts` and `main.spec.ts`
      provides fakes for the 2 new repos.

### Phase 4: Comments

- [x] `CreateReviewCommentDto`, `ListCommentsQueryDto`,
      `ReviewCommentResponseDto`, `ListCommentsResponseDto` envelope.
- [x] `ReviewsService.addComment` pre-checks parent existence;
      **asymmetric** — does NOT 404 on unapproved parent.
- [x] `ReviewsService.findApprovedCommentsByReviewId` 404s on
      missing OR unapproved parent with the SAME body (no
      existence leak).
- [x] `ReviewsController` has 2 new comment routes with `@Throttle()`
      and `ParseUUIDPipe`.

### Phase 5: Cross-cutting + tooling

- [x] `src/reviews/dto/update-review.dto.ts` is DELETED (locked #8).
- [x] `src/main.ts` calls `app.set('trust proxy', 1)` BEFORE
      `useGlobalPipes(...)`.
- [x] Filter spec covers `ThrottlerException → 429` + `Retry-After`.
- [x] `test/reviews.e2e-spec.ts` covers all 34 spec scenarios
      (7 routes + throttler shape + existence-leak + FK CASCADE).
- [x] `seed-reviews.ts` has the pure `seedReviews()` + I/O
      wrapper; `SEED_DRY_RUN=1` short-circuits.
- [x] `README.md` has the Reviews endpoints table + the
      "Anti-spam (throttler)" subsection.

### Phase 6: Verification

- [x] `npm run build` + `npm run lint` (0 NEW errors; the 2
      pre-existing `src/reviews/reviews.service.ts` errors resolve
      as a side effect of T8's rewrite) + `npm test` (13 new + 5
      extended spec files green) + `npm run test:e2e` (34 e2e
      scenarios green).
- [x] `sdd-verify` confirms all 61 spec scenarios (38
      reviews-domain + 23 reviews-throttling) have a passing
      covering test.
- [x] `sdd-archive` dry-run: the DBML delta is staged for merge
      at archive time.

---

## Done definition

This task list is done when:

1. All 18 task commits + 18 `apply-progress` marker commits + 1
   anchor + 1 finalize commit are on `domains/reviews` (38 total).
2. Every code commit (T1..T15, T17) has a corresponding `*.spec.ts`
   in the SAME commit, RED before GREEN.
3. `npm run lint && npm test && npm run build && npm run test:e2e`
   is green on the final HEAD of `domains/reviews`.
4. Every spec scenario in `specs/reviews-domain/spec.md` (38) and
   `specs/reviews-throttling/spec.md` (23) has a passing covering
   test (61 total).
5. The DBML delta + `server_specs.md` §3.3 update are deferred to
   `sdd-archive` time — they are NOT in this commit range.
6. `apply-progress.md` is appended with one entry per task + the
   anchor + the finalize.
7. `sdd-verify` passes with no new warnings.
8. `sdd-archive` dry-run succeeds (no migration drift, no DBML
   drift, no spec merge conflicts).

**Next step (per orchestrator gate)**: launch `sdd-apply` for
`reviews-domain` with the 18-task plan. The orchestrator's
Review Workload Guard re-validates T8 and T16 at apply start; if
either exceeds 400 LOC during apply, the sub-split fallback
documented in the Review Workload Forecast kicks in without
re-running `sdd-tasks`. The orchestrator MUST NOT surface a
"chained PRs?" question to the user — the user pre-approved the
trunk-based + `apply-progress` chunking strategy on 2026-06-19.
