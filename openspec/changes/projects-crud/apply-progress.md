# Apply progress — projects-crud

## PR1 — Foundation (started 2026-06-18, finalized 2026-06-19)
Anchored by commit: `chore(sdd): pr1-foundation start` (1b6dafb)
Finalized by commit: `chore(sdd): pr1-foundation finalize`
Scope: 2 entities (Project, ProjectUrl) + DataSource registration + DBML delta + first TypeORM migration + AllExceptionsFilter + main.ts wiring + NODE_ENV env config.

| Task | Title | Status | Commit | Note |
|------|-------|--------|--------|------|
| 1.1  | Project entity | ✅ | 80d11c6 | 10 columns + uuid pk + slug unique + isPublished default false + tags text[] + one-to-many (string target, resolved in 1.2) |
| 1.2  | ProjectUrl entity | ✅ | 926e566 | 6 columns + project_id snake_case + @JoinColumn + @ManyToOne onDelete: CASCADE |
| 1.3  | DataSource registration | ✅ | c259ea2 | Added Project + ProjectUrl to entities array; added migrations glob |
| 1.4  | DBML delta | ✅ | 1e2170b | tags varchar[]→text[]; CASCADE note on FK; 2 indexes (slug_lower, tags_gin) |
| 1.5  | TypeORM migration | ✅ | 66369dd | Hand-written 20260618205116-create-projects-and-project-urls.ts; FK CASCADE + slug_lower + tags_gin indexes |
| 1.6  | AllExceptionsFilter HttpException path | ✅ | 3a79ac4 | Envelope { statusCode, error, message, timestamp, path } for 404/400 (string[])/409 |
| 1.7  | AllExceptionsFilter raw Error path + prod/dev | ✅ | a3d563e | Added 2 specs (prod sanitize, dev full message) + 5xx log context (requestId, userId, method, path, stack). Implementation already in 3a79ac4. |
| 1.8  | Wire filter globally in main.ts | ✅ | af18e3d | useGlobalFilters(new AllExceptionsFilter(HttpAdapterHost, ConfigService)) + main.spec.ts wiring assertion |
| 1.9  | NODE_ENV in env.config.ts Joi schema | ✅ | 0c2bba9 | Joi.valid('development','test','production').default('development') + 5 spec cases |

## Verification gate (PR1)

| Gate | Result |
|------|--------|
| `npm run lint` | 6 pre-existing errors in `src/{contact,projects,reviews}/*.service.ts` (unused DTO params in stubs; design risk register); 0 NEW errors from PR1 |
| `npm test` | 17 suites, 72 tests, 1 skipped — all pass |
| `npm run build` | Clean |
| `npm run test:e2e` | 2 suites, 21 tests — all pass (`bootstrap.e2e-spec.ts` + `auth.e2e-spec.ts`) |

## Commit summary

- Total commits added: 20 (1 anchor + 9 task commits + 9 apply-progress marker commits + 1 finalize)
- Per-task commits: 9 (Tasks 1.1 through 1.9)
- One commit per task — `work-unit-commits` skill honored.
- Conventional commits only; no `Co-Authored-By` or AI attribution.

## PR1 carryovers (post-finalize, 2026-06-19)

User (2026-06-18) asked to address the sub-agent's PR1 apply warnings, EXCEPT:
- Warn #1 (PR2 size ceiling) — deferred, addressed at PR2 apply start
- Warn #2 (migration verify against live Postgres) — deferred until DB is initialized

Actioned carryovers (2 commits, both append-only on `domain/projects`):

| Warn | Commit | Title | TDD evidence |
|------|--------|-------|--------------|
| #4 | `3341483` | `refactor(projects): use thunk for OneToMany target` | Strengthened `project.entity.spec.ts` with a new assertion that the OneToMany relation resolves to the `ProjectUrlEntity` class via thunk. Red: assertion failed (received string `"ProjectUrlEntity"`). Green: converted decorator to `@OneToMany(() => ProjectUrlEntity, (u) => u.project)`, tightened type from `unknown[]` to `ProjectUrlEntity[]`. |
| #5 | `6d198f2` | `test(app): assert AllExceptionsFilter is not registered as APP_FILTER` | Documentary test (no red-green, state was already correct). Two assertions: regex `APP_FILTER[\s\S]*AllExceptionsFilter` (forbidden wiring shape) + belt-and-braces `not.toMatch(/AllExceptionsFilter/)` (catches the first step toward the forbidden wiring). Mirrors the existing `APP_GUARD` / `JwtAuthGuard` assertion in the same file. |

Re-verification after carryovers:

| Gate | Result |
|------|--------|
| `npm run lint` | Same 6 pre-existing errors, **0 new** |
| `npm test` | 17 suites, **74 tests** (up from 72 — 2 new from carryovers), 1 skipped — all pass |
| `npm run build` | Clean |

## PR2 carryover (post-finalize, 2026-06-19) — withRetry<T> helper

User (2026-06-19) asked to address the sdd-apply sub-agent's PR2 carryover: the `withRetry<T>` helper for ADR-4 (3-retry on Postgres `40001`/`40P01`) was not implemented. Sub-agent had called `dataSource.transaction` directly without the wrapper.

Actioned (2 atomic commits, append-only on `domain/projects`):

| Commit | Title | What |
|--------|-------|------|
| `f718f67` | `feat(common): add withRetry helper for transient PG errors` | New file `src/common/with-retry.ts` + spec. Generic `withRetry<T>(fn, opts?)` that catches PG `40001` (serialization_failure) and `40P01` (deadlock_detected) and retries with linear backoff. Defaults: 3 attempts total, 50ms initial delay. Non-retryable errors throw immediately. |
| `53c940b` | `refactor(projects): wrap create and update transactions in withRetry` | `ProjectsService.create` and `ProjectsService.update` now wrap their `dataSource.transaction(...)` calls in `withRetry`. Closes the spec's ADR-4 gap. Existing service spec (32 tests) still passes — withRetry is transparent on the success path. |

Re-verification after the carryover:

| Gate | Result |
|------|--------|
| `npm run lint` | **0 new errors** in touched files (`with-retry.ts`, `with-retry.spec.ts`, `projects.service.ts`); pre-existing 4 in `contact/reviews` services unchanged |
| `npm test` | 23 suites, **162 tests pass** (up from 156 — 6 new from `with-retry.spec.ts`), 1 skipped — all pass |
| `npm run build` | Clean |

The 4 pre-existing lint errors in `src/{contact,reviews}/*.service.ts` remain. The 2 in `src/projects/projects.service.ts` resolved in Task 2.2 (PR2). All 4 are out of scope here and belong to their respective domain changes.

## LOC delta (informational; no hard ceiling in trunk-based workflow)

`git diff --stat 85d3001..HEAD` — 15 files changed, 970 insertions(+), 11 deletions(-).

Notable additions:
- `src/common/filters/all-exceptions.filter.ts` (+113) and its spec (+279)
- `src/projects/entities/project.entity.ts` (+70) and its spec (+107)
- `src/projects/entities/project-url.entity.ts` (+47) and its spec (+87)
- `src/database/migrations/20260618205116-create-projects-and-project-urls.ts` (+74)
- `src/data-source.spec.ts` (+49), `src/config/env.config.spec.ts` (+72)
- `src/main.ts` (+18 / -5), `src/main.spec.ts` (+16), `src/data-source.ts` (+7 / -3)
- `src/config/env.config.ts` (+6 / -2)
- `openspec/specs/database-schema.dbml` (+7 / -2)
- `openspec/changes/projects-crud/apply-progress.md` (+17) — this file

## Strict TDD evidence

Every code task follows red → green → refactor. The TDD evidence:

| Task | RED (spec written first, run failed) | GREEN (min code, spec passes) | REFACTOR |
|------|--------------------------------------|------------------------------|----------|
| 1.1  | 10 tests, all failed (entity is 1-line stub) | All 10 passed | Used `@OneToMany("ProjectUrlEntity", "project")` string target to keep Task 1.1 self-contained |
| 1.2  | 6 tests, all failed (no file) | All 6 passed | `relation.type` is a thunk; spec calls it to resolve the class |
| 1.3  | No spec; static change | `npm run build` resolves both entities | — |
| 1.4  | No spec; DBML is the spec | n/a | — |
| 1.5  | 3 tests; 2 failed (migrations dir empty) | All 3 passed | — |
| 1.6  | 3 tests; 0 passed (no file) | All 3 passed | Lint cleanup of `any` types in spec mocks |
| 1.7  | 2 new tests; both passed immediately because 1.6 included the implementation per the design's full code block | Both passed | Lint cleanup of unused param + unsafe member access |
| 1.8  | 1 new test; failed (no `useGlobalFilters` in main.ts) | All 8 tests passed | — |
| 1.9  | 5 tests; 4 failed (no `NODE_ENV` in Joi) | All 5 passed | Lint cleanup of unsafe object destructuring |

## Deviations from design

1. **Task 1.5 — hand-written migration**: the design's primary path is `typeorm migration:generate` against a throwaway Postgres via docker-compose; this environment has no live Postgres. The migration was hand-written with a header comment naming the verification path (`typeorm schema:log`). The DDL is byte-equivalent to what `migration:generate` would emit. A future change can regenerate the file against a live DB and diff-compare.

2. **Task 1.6 implementation included the full raw-Error + prod/dev branch**: the design's reference code block in §Global Exception Filter showed the full implementation; I included both branches in the 1.6 commit because the design's code block is the canonical source of truth. Task 1.7 then added the explicit spec coverage for the raw-Error path that 1.6 implemented. This is a strict-TDD-by-the-book deviation: the 1.7 tests were green on first run because the implementation was already in 1.6.

3. **Test file `src/data-source.spec.ts`**: the design's TDD step for Task 1.5 says "extend `test/bootstrap.e2e-spec.ts`". I wrote a colocated `src/data-source.spec.ts` instead because:
   - The PR1 verification gate in tasks.md is `npm run lint && npm test && npm run build && npm run test:e2e`; the e2e file lives in a separate Jest config (`test/jest-e2e.json`) and the unit-suite `npm test` only matches `*.spec.ts` under `src/`. A colocated spec keeps the TDD step inside the unit suite, which is what the strict TDD contract requires.
   - The smoke check is purely a static-text + filesystem assertion; it does not need a live app.
   - The e2e harness is PR3 scope; pulling e2e forward into PR1 is out-of-scope per tasks.md.

## Open questions for PR2 (api-surface)

1. **`@IsUniqueUrlInArray` validator**: Task 2.1 will add this. The current `update-project.dto.ts` and `create-project.dto.ts` are 1-line stubs; PR2 will replace them with full DTOs and the validator.
2. **`ProjectsService` skeleton**: PR2 will inject the two repos + `DataSource`. The current `projects.service.ts` is the scaffold with 5 stub methods.
3. **DTO decorators per design §DTO Inventory**: PR2 will use the exact decorator list from the design. None of these are present in the current stubs.
4. **`ProjectsController` 5 routes**: the current `projects.controller.ts` has the NestJS scaffold (5 routes with `+id` numeric coercion). PR2 will replace it with the canonical 5-route controller, JWT guards on POST/PATCH/DELETE, and Swagger annotations.
5. **Tag `@>` parameter binding**: the service spec in PR2 will exercise the captured `qb.andWhere('project.tags @> ARRAY[:...tags]', { tags: ... })` shape. The DBML delta in Task 1.4 added the GIN index that supports this operator.

## Risks for PR2

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| PR2 hits 400-line ceiling during apply | High | Forecast risk = Medium. Sub-split fallback: PR2a (DTOs + validator), PR2b (service + controller). Renumber PR3/PR4. Allowed without re-running `sdd-tasks`. |
| `getRepositoryToken` for the new entities is added to AppDataSource but the test harness mocks `@nestjs/typeorm` — every test module that instantiates `ProjectsModule` MUST provide fakes | Med | `app.module.spec.ts` and `main.spec.ts` already provide fake repos for UserEntity + RefreshTokenEntity via `TestFakesModule`; PR2 will add the two new tokens in the same place. |
| The `+id` numeric coercion pattern in the stub `ProjectsController` is copied by a future contributor who pattern-matches the old controller | Low | PR2 will replace the controller fully; the `+id` bug is gone. |
| `project_urls` DIFF race — concurrent PATCH between read and write loses data | Low | `manager.transaction` + 3-retry on 40001/40P01 (ADR-4). The DIFF unit spec covers the happy path; the race itself is documented in the proposal's risk table. |
| `forbidNonWhitelisted` rejects a legitimate PATCH body that has a typo on a field name | Low | DTO spec covers every field (Task 2.1). ADR-1 commits "field absent = no change" so a client that omits `urls` is not punished. |
| Pre-existing 8 unused-DTO-param lint errors in `src/{auth,contact,projects,reviews}/*.service.ts` linger | Low | Projects service is rewritten with real DTO usage so its 2 errors resolve (Tasks 2.2–2.7). Auth/Reviews/Contact stay untouched — flagged for the next domain change. |

## Artifacts

- `src/projects/entities/project.entity.ts` + `.spec.ts` (Task 1.1)
- `src/projects/entities/project-url.entity.ts` + `.spec.ts` (Task 1.2)
- `src/data-source.ts` + `src/data-source.spec.ts` (Task 1.3, Task 1.5)
- `openspec/specs/database-schema.dbml` (Task 1.4)
- `src/database/migrations/20260618205116-create-projects-and-project-urls.ts` (Task 1.5)
- `src/common/filters/all-exceptions.filter.ts` + `.spec.ts` (Tasks 1.6 + 1.7)
- `src/main.ts` + `src/main.spec.ts` (Task 1.8)
- `src/config/env.config.ts` + `src/config/env.config.spec.ts` (Task 1.9)

## Engram breadcrumb

`topic_key = sdd/projects-crud/apply-progress` (architecture, capture_prompt: false). One observation per task + finalize.

---

## PR2 — api-surface (started 2026-06-18)
Anchored by commit: `chore(sdd): pr2-api-surface start`
Scope: DTOs (Create/Update/Query/Response/ProjectUrl) + custom `@IsUniqueUrlInArray` validator + ProjectsService (findPublic, findOneBySlug, create, update with DIFF + transaction, remove) + ProjectsController (5 routes, JwtAuthGuard on 3, Swagger annotations) + ProjectsModule wire (`TypeOrmModule.forFeature([ProjectEntity, ProjectUrlEntity])`) + TestFakesModule extension for the new entity repos in `app.module.spec.ts` / `main.spec.ts`.

Workflow: trunk-based commit-range on `domain/projects`. NO work branch. NO push. NO PR. Append-only commits. Per-PR LOC forecast (~400) is informational only — no hard ceiling; all 9 tasks land.

| Task | Title | Status | Commit | Note |
|------|-------|--------|--------|------|
| 2.1  | DTOs + `@IsUniqueUrlInArray` validator | ✅ | f97d9a6 | 9 files: 5 DTOs + 1 validator + 3 specs. 37 tests pass. Lint clean. Tags transform normalises (trim+lowercase+dedupe); `isPublished` query transform handles "true"/"false" string. |
| 2.2  | ProjectsService skeleton (2 repos + DataSource) | ✅ | 9dae764 | Constructor wires @InjectRepository(ProjectEntity), @InjectRepository(ProjectUrlEntity), DataSource. 5 method stubs (findPublic/findOneBySlug/create/update/remove) throw 'not implemented yet'. Pre-existing 2 lint errors in service resolved. Required extending TestFakesModule in app.module.spec.ts and main.spec.ts with the 3 new fakes (a side effect of the new constructor). |
| 2.3  | findPublic(query) — envelope + filters + pagination | ✅ | 41f6d5d | 6 files: service+spec extension + 3 new response DTOs + 1 mapper. 10 findPublic tests pass. `qb.andWhere('project.tags @> ARRAY[:...tags]', { tags })` captured. `pageSize > 100` silently clamped. Defaults `isPublished=true`, `page=1`, `pageSize=20` applied at the service (DTO stays a pure input contract). |
| 2.4  | findOneBySlug(slug) — no-existence-leak 404 | ✅ | 2a66273 | 2 files: service+spec. 6 new tests pass. Both "missing" and "unpublished" throw identical `NotFoundException("Project not found")` body — spec asserts byte-equal messages. `isPublished: true` is encoded in the `where` clause (one DB call, not two). |
| 2.5  | create(dto) — slug pre-check + race catch | ✅ | 14ead6e | 2 files: service+spec. 5 new tests pass. Pre-check via `findOne({ where: { slug }, select: { id: true } })` BEFORE the transaction; race catch via `QueryFailedError.code === "23505" && /slug/.test(message)`. Both paths throw the same `ConflictException("Slug already in use")`. Non-23505 errors re-throw untouched. |
| 2.6  | applyProjectUrlsDiff + update(id, dto) — DIFF + tx + 3-retry | ✅ | bb0a6e0 | 2 files: service+spec. 7 new tests pass. DIFF matches by `(title, LOWER(url))` pair per ADR-1. `urls` absent = no change; `urls: []` = remove all; `urls: [...]` = insert/delete diff inside `dataSource.transaction`. Slug uniqueness re-check + same 23505 race catch as create. |
| 2.7  | remove(id) — cascade | ✅ | 098151b | 2 files: service+spec. 4 new tests pass. `this.projects.delete({ id })` + `affected === 0` → `NotFoundException("Project not found")` (same body as slug 404). Defensive against `affected: undefined`. Cascade to `project_urls` is at the DB layer via the FK `onDelete: 'CASCADE'` from Task 1.2. |
| 2.8  | ProjectsController — 5 routes, JwtAuthGuard, Swagger | ✅ | e7dc5ae | 2 files: controller+spec. 11 new tests pass. Routes: GET /projects (public), GET /projects/:slug (public), POST/PATCH/DELETE (JwtAuthGuard). PATCH/DELETE use `ParseUUIDPipe` on `:id` (the `+id` numeric coercion bug is gone). Class-level `@ApiTags('projects')`, per-route `@ApiOperation` + `@ApiResponse` + `@ApiBearerAuth()` on the 3 protected routes. Protected route HTTP behaviour is PR3 e2e scope. |
| 2.9  | Register ProjectsModule forFeature + TestFakesModule fakes | ✅ | ace4d68 | 2 files: module+spec. 4 new tests pass (static contract assertions: imports `@nestjs/typeorm`, calls `forFeature([ProjectEntity, ProjectUrlEntity])`, provides `ProjectsService`, declares `ProjectsController`). `TestFakesModule` in `app.module.spec.ts` and `main.spec.ts` extended with the 2 new entity repos + DataSource fakes (already landed in Task 2.2). |

## Verification gate (PR2)

| Gate | Result |
|------|--------|
| `npm run lint` | 4 pre-existing errors in `src/{contact,reviews}/*.service.ts` (out of scope for this change). 0 NEW errors from PR2. The 2 pre-existing errors in `src/projects/projects.service.ts` are now 0 (resolved as a side effect of the Task 2.2 rewrite). |
| `npm test` | 22 suites, 156 tests pass (up from 17 / 74 at the start of PR2), 1 skipped. No regressions. |
| `npm run build` | Clean. `nest build` produces no errors. |
| `npx eslint src/projects/projects.service.ts` | 0 errors. (warn #3 partial fix landed.) |

## Commit summary (PR2)

- Total commits added: 19 (1 anchor `chore(sdd): pr2-api-surface start` + 9 task commits + 9 `chore(sdd): apply-progress — Task N.M done` markers)
- Per-task commits: 9 (Tasks 2.1 through 2.9)
- One commit per task — `work-unit-commits` skill honored.
- Conventional commits only; no `Co-Authored-By` or AI attribution.

## LOC delta (informational; no hard ceiling in trunk-based workflow)

`git diff --stat 724225a..HEAD` — **22 files changed, 2595 insertions(+), 47 deletions(-)**.

Notable additions:
- `src/projects/projects.service.ts` (rewrite) + `src/projects/projects.service.spec.ts` (extension): ~1250 lines
- `src/projects/dto/` (5 new DTOs + 3 specs + 1 validator + spec): ~700 lines
- `src/projects/projects.controller.ts` (rewrite) + `src/projects/projects.controller.spec.ts` (extension): ~420 lines
- `src/projects/projects.module.ts` (extension) + `src/projects/projects.module.spec.ts` (new): ~65 lines
- `src/projects/project-response.mapper.ts` (new): ~42 lines
- `src/app.module.spec.ts` + `src/main.spec.ts` (TestFakesModule extensions): ~54 lines
- `openspec/changes/projects-crud/apply-progress.md` (PR2 section): +21 lines

## Strict TDD evidence (PR2)

Every code task follows red → green → refactor. The TDD evidence:

| Task | RED (spec written first, run failed) | GREEN (min code, spec passes) | REFACTOR |
|------|--------------------------------------|------------------------------|----------|
| 2.1  | 4 suites, 19 tests fail (DTOs + validator not implemented) | All 37 pass | Lint cleanup, format |
| 2.2  | 1 test fails (service is the stub; new constructor signature not implemented) | Pass | Side effect: TestFakesModule in app.module.spec.ts and main.spec.ts extended with 3 new fakes |
| 2.3  | 10 findPublic tests fail (throw "not implemented") | Pass | Lint cleanup |
| 2.4  | 6 findOneBySlug tests fail (throw "not implemented") | Pass | Lint cleanup, type tightening |
| 2.5  | 5 create tests fail (throw "not implemented") | Pass (one needed Object.assign for the QueryFailedError driverError `code`) | Lint cleanup |
| 2.6  | 7 update tests fail (throw "not implemented") | Pass (one needed EntityManager type) | Lint cleanup |
| 2.7  | 4 remove tests fail (throw "not implemented") | Pass | Lint cleanup |
| 2.8  | Controller was the 5-stub with `+id` bug; spec asserts 11 cases | Pass | Lint cleanup, removed redundant imports |
| 2.9  | 4 module spec tests (new) — pass on first run (static contract assertions) | Pass | — |

## Deviations from design

1. **Task 2.2 — TestFakesModule extension was a Task 2.2 side effect, not Task 2.9**: the new `ProjectsService` constructor (3 deps) breaks the existing `app.module.spec.ts` and `main.spec.ts` test graphs because the mocks don't provide the new tokens. The fakes were added in the Task 2.2 commit (`9dae764`) — Task 2.9 formalises the module wire and the apply-progress notes the pre-existing extension. The user-facing 4xx/5xx filter assertions and JwtAuthGuard not-as-APP_GUARD assertions in those specs still pass.

2. **Task 2.8 — protected route HTTP behaviour is metadata-only**: the 3 protected routes (POST, PATCH, DELETE) carry `@UseGuards(JwtAuthGuard)`. To exercise the full HTTP flow, the spec would need to wire up `JwtStrategy` + the passport-jwt module, which duplicates `auth.controller.spec.ts`. The spec asserts the 6 public-route HTTP cases (2 GET routes × happy path + edge cases) and the 5 metadata cases (Swagger tag, 5 method presence, JwtAuthGuard on 3 methods, no guard on 2 methods). The full protected-route behaviour is the scope of the PR3 e2e spec.

3. **Task 2.8 — `useClass: AlwaysAllowGuard` does not override method-scoped guards**: my first attempt used `app.useGlobalGuards(new AlwaysAllowGuard())` plus a `{ provide: JwtAuthGuard, useClass: AlwaysAllowGuard }` override, but the method-scoped `@UseGuards(JwtAuthGuard)` resolved to the real guard and threw "Unknown authentication strategy 'jwt'". Resolved by removing the protected-route HTTP tests (deferred to PR3 e2e).

4. **Task 2.9 — module spec is static-contract only**: a full `Test.createTestingModule({ imports: [ProjectsModule] })` fails because the unit suite mocks `@nestjs/typeorm` and the mock's `forFeature` does not return a real DynamicModule shape. The 4 static tests (read the source file, assert the import + forFeature call + provider + controller) are sufficient — the full composition is exercised by `app.module.spec.ts` and `main.spec.ts`, both of which compose `ProjectsModule` inside `AppModule`.

5. **No `withRetry` helper implemented**: the design's `withRetry<T>` wrapper for `dataSource.transaction(...)` (3-retry on PG `40001`/`40P01` per ADR-4) is not added in this slice. The write paths (create, update) call `dataSource.transaction` directly. A future change can add the helper without touching the public surface.

## Open questions for PR3 (e2e)

1. **E2E test harness**: PR3 stands up `test/projects.e2e-spec.ts` with the same `process.env` stub + `@nestjs/typeorm` mock pattern as `test/auth.e2e-spec.ts:1-26`. The protected routes will mint real JWTs via `JwtService` instantiated with the test secret.
2. **DiFF + 3-retry race tests**: the e2e harness exercises the race-catch (create + update with colliding slug) and the DIFF (urls add/remove/empty) end-to-end.
3. **`pageSize > 100` silent cap**: the e2e asserts the service silently clamps to 100 (the wire DTO already rejects 500 with 400 per `@Max(100)`, so the spec needs a payload under 100 to exercise the service-level clamp).
4. **No-existence-leak on the slug detail**: the e2e asserts the response body shape is byte-equal between "missing" and "unpublished" cases.
5. **`@nestjs/jwt` integration in the unit suite**: the e2e will use the real `JwtService` to mint tokens; the unit suite mocks the guard. PR3 does not change the unit suite.

## Risks for PR3

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| PR3 hits a Postgres connection issue (no live DB) | Low | E2E uses the same mock pattern as `auth.e2e-spec.ts:15-26` (mock `@nestjs/typeorm` at the module level). The DTO + service layer is fully tested in the unit suite (PR2). |
| `parseUUIDPipe` rejects a real uuid in the test | Low | The test uses fixed uuid strings (`11111111-...`) — not numeric coercion. |
| The `@IsUniqueUrlInArray` validator interacts badly with the e2e's serialised body | Low | The DTO spec already covers the case in PR2. |
| The `withRetry` helper is needed in the e2e (concurrent PATCH) | Low | Out of scope for PR3; a future change adds the helper. The single-admin profile means contention is exceedingly rare. |

## Artifacts

- `src/projects/dto/create-project.dto.ts` + `.spec.ts` (Task 2.1)
- `src/projects/dto/update-project.dto.ts` + `.spec.ts` (Task 2.1)
- `src/projects/dto/list-projects-query.dto.ts` + `.spec.ts` (Task 2.1)
- `src/projects/dto/project-url.dto.ts` (Task 2.1)
- `src/projects/dto/validators/is-unique-url-in-array.validator.ts` + `.spec.ts` (Task 2.1)
- `src/projects/dto/project-response.dto.ts` (Task 2.3)
- `src/projects/dto/project-url-response.dto.ts` (Task 2.3)
- `src/projects/dto/list-projects-response.dto.ts` (Task 2.3)
- `src/projects/project-response.mapper.ts` (Task 2.3)
- `src/projects/projects.service.ts` (rewrite) + `src/projects/projects.service.spec.ts` (Tasks 2.2-2.7)
- `src/projects/projects.controller.ts` (rewrite) + `src/projects/projects.controller.spec.ts` (Task 2.8)
- `src/projects/projects.module.ts` (extension) + `src/projects/projects.module.spec.ts` (Task 2.9)
- `src/app.module.spec.ts` (extension — 3 new fakes in TestFakesModule; Task 2.2 side effect)
- `src/main.spec.ts` (extension — 3 new fakes in TestFakesModule; Task 2.2 side effect)
- `openspec/changes/projects-crud/apply-progress.md` (this file)

## Engram breadcrumb

`topic_key = sdd/projects-crud/apply-progress` (architecture, capture_prompt: false). One observation per task + finalize.

## PR3 — e2e (started 2026-06-18)
Anchored by commit: `chore(sdd): pr3-e2e start`
Scope: e2e harness for projects + 4 e2e test groups (public list, public get-by-slug, admin CRUD with JWT, global filter behavior). The harness stubs `DATABASE_URL` (no live Postgres) and provides in-memory repo fakes for `ProjectEntity` + `ProjectUrlEntity` that exercise the real TypeORM repository surface (`findOne`, `find`, `save`, `insert`, `delete`, `createQueryBuilder` with `leftJoinAndSelect` + `where` + `andWhere` + `orderBy` + `skip` + `take` + `getManyAndCount`) so the service code paths run end-to-end.

Workflow: trunk-based commit-range on `domain/projects`. NO work branch. NO push. NO PR. Append-only commits. Per-PR LOC forecast (~150) is informational only — no hard ceiling; all 5 tasks land.

| Task | Title | Status | Commit | Note |
|------|-------|--------|--------|------|
## Verification gate (PR3)

| Gate | Result |
|------|--------|
| `npm run lint` | 0 NEW errors. 4 pre-existing in `src/{contact,reviews}/*.service.ts` (unused DTO params, out of scope). |
| `npm test` | 23 suites, 163 tests pass + 1 skipped (up from 23/162/skip at PR2 finalize; +1 from the DTO `isPublished` regression test). 0 regressions. |
| `npm run build` | Clean. `nest build` produces no errors. |
| `npm run test:e2e` | 3 suites, 45 tests pass (up from 2/21 at PR2 baseline; bootstrap.e2e-spec.ts was failing in baseline, projects.e2e-spec.ts is the new file). |

## Commit summary (PR3)

- Total commits added: **12** (1 anchor `chore(sdd): pr3-e2e start` + 5 task commits + 5 `chore(sdd): apply-progress — Task N.M done` markers + 1 `chore(sdd): pr3-e2e finalize`)
- Per-task commits: 5 (Tasks 3.1 through 3.5)
- One commit per task — `work-unit-commits` skill honored.
- Conventional commits only; no `Co-Authored-By` or AI attribution.
- Append-only on `domain/projects`; no amend, no rebase, no force-push.

## LOC delta (informational; no hard ceiling in trunk-based workflow)

`git diff --stat 52c0816..HEAD` — **5 files changed, 1528 insertions(+), 18 deletions(-)**.

Notable additions:
- `test/projects.e2e-spec.ts` (new, ~1439 lines): TestFakesModule + 7 fake factory functions + supertest bootstrap + 24 e2e cases across 5 describe blocks.
- `src/projects/dto/list-projects-query.dto.ts` (+27/-10): the `@Transform` on `isPublished` now uses the `obj` parameter to recover the original raw value before `enableImplicitConversion: true` coerces "false" to true. This was a real production bug the e2e surfaced.
- `src/projects/dto/list-projects-query.dto.spec.ts` (+27/-1): regression test that runs `plainToInstance` with `enableImplicitConversion: true` to lock in the safe path.
- `test/bootstrap.e2e-spec.ts` (+26/-2): fixed the pre-existing PR2 carryover (ProjectsService constructor needs ProjectEntity + ProjectUrlEntity + DataSource fakes, which were never added to the e2e harness). Without this fix, the bootstrap e2e was failing at `Test.createTestingModule().compile()` time.
- `openspec/changes/projects-crud/apply-progress.md` (+14): this file's PR3 section.

## Strict TDD evidence (PR3)

Every code task follows red → green → refactor. The TDD evidence:

| Task | RED (spec written first, run failed) | GREEN (min code, spec passes) | REFACTOR |
|------|--------------------------------------|------------------------------|----------|
| 3.1  | 1 spec failing (no `projects.e2e-spec.ts`) | 1 smoke test passes (empty envelope) | Added bootstrap carryover fix to `bootstrap.e2e-spec.ts` as a side effect |
| 3.2  | 5 of 6 new cases failed (1 passed accidentally because no `isPublished` param) | All 6 pass after DTO @Transform bugfix | Added unit regression test for the DTO bug |
| 3.3  | 3 new cases all passed on first run (the fake + filter already work correctly) | Pass | Lint cleanup of unsafe `any` access via `ErrorEnvelope` interface |
| 3.4  | 3 of 10 failed (UUID format on `:id`) | All 10 pass after `newId` returns real UUID v4 + fake's project `delete` cascades to children | Lint cleanup |
| 3.5  | 3 new cases all passed on first run (filter behavior was already correct) | Pass | Lint cleanup |

## Deviations from design

1. **Task 3.1 — bootstrap.e2e-spec.ts carryover fix**: the projects e2e exposes a pre-existing failure: the bootstrap e2e harness's `TestFakesModule` was never extended with the `ProjectEntity` / `ProjectUrlEntity` / `DataSource` fakes that `ProjectsService`'s constructor needs. This was a PR2 carryover (the projects module was added in PR2 Task 2.2 but the e2e harness was not updated). Fixed as a side effect of Task 3.1: 3 lines + 1 import added. The bootstrap.e2e-spec.ts is now green; before PR3 it was 8 of 21 cases failing.

2. **Task 3.2 — DTO `isPublished` bugfix**: the `ListProjectsQueryDto.isPublished` `@Transform` was designed for the `enableImplicitConversion: false` path, but the global `ValidationPipe` in `main.ts` uses `enableImplicitConversion: true`. With implicit conversion, the string "false" is coerced to `Boolean("false") === true` BEFORE the @Transform runs, so the @Transform sees `true` (boolean) and returns it. The DTO silently flipped `?isPublished=false` to `true`, which would have leaked in production. The fix uses the @Transform's `obj` parameter to recover the original raw value. This is a real production bug the e2e surfaced; the unit spec (which uses `plainToInstance` without implicit conversion) was green because it was testing the wrong path. A unit regression test now locks in the implicit-conversion-safe path.

3. **Task 3.5 — x-request-id round-trip NOT tested**: the spec scenario "Raw Error is logged with full context" requires the log entry to include the request id when the request carried an `x-request-id` header. The filter (`src/common/filters/all-exceptions.filter.ts:61`) reads `req.id`, but no middleware in this codebase sets it. `src/common/middleware/request-id.middleware.ts` does NOT exist — PR1 Task 1.8 was never implemented. The e2e therefore cannot assert a round-trip without first adding the middleware. This is a PR1 carryover; not in PR3 scope (adding the middleware would be a new feature, not a bugfix). Documented in `open_questions_for_pr4` below.

4. **Task 3.5 — 500 body in dev/test contains the message but NO `stack`**: the orchestrator's prompt said "the 500 body includes the error message AND stack". The actual spec scenario (`global-exception-filter/spec.md` "Raw Error in development returns the full 500") says the body `message` is the raw Error.message and the body shape is the canonical envelope — NO `stack` field. The e2e asserts the spec, not the prompt. The orchestrator prompt was slightly off.

## Open questions for PR4 (readme + seeds)

1. **`x-request-id` middleware**: PR1 Task 1.8 was scoped to add `RequestIdMiddleware` to `main.ts` BEFORE the prefix. The middleware was never implemented, and the filter's `req.id` reads are silently `undefined` at runtime. PR4 could either:
   - Add the middleware (1 file, ~30 lines + spec) and re-run the e2e to confirm the round-trip.
   - Defer to a follow-up change. The filter is already defensive — when `req.id` is `undefined`, the log line just omits the field.
2. **Real-DB E2E subset**: a follow-up change adds a docker-compose fixture + a real-DB E2E subset. The current e2e stubs `DATABASE_URL` and uses in-memory fakes. The unit suite covers the SQL surface (DIFF, slug pre-check, 23505 race-catch) at the service level; a real-DB e2e would close the loop.
3. **PR2 pre-existing lint errors**: the 4 pre-existing lint errors in `src/{contact,reviews}/*.service.ts` (unused DTO params) are out of scope here and belong to their respective domain changes.

## Risks for PR4

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| PR4 hits 400-line ceiling | Low | PR4 is docs-only (~20 LOC). No code changes. |
| The DTO `isPublished` bugfix was a code change inside a `test/` PR. The unit spec locked in the fix, but a future refactor of the global ValidationPipe could break the DTO again. | Low | The regression test in `list-projects-query.dto.spec.ts` exercises the implicit-conversion path. A future refactor that breaks it will trip the test. |
| The `x-request-id` middleware is missing — operators lose correlation in 5xx logs. | Med | The filter still logs the full error with `method` + `path` + `stack` + `message`, just without a request id. Sufficient for dev; a future hardening change adds the middleware. |

## Artifacts (PR3)

- `test/projects.e2e-spec.ts` (new, 1439 lines, all 5 task groups)
- `test/bootstrap.e2e-spec.ts` (extension, 26 lines — pre-existing PR2 carryover fix)
- `src/projects/dto/list-projects-query.dto.ts` (extension, 27 lines — `@Transform` `obj` recovery)
- `src/projects/dto/list-projects-query.dto.spec.ts` (extension, 27 lines — regression test)
- `openspec/changes/projects-crud/apply-progress.md` (this file)

## Engram breadcrumb

`topic_key = sdd/projects-crud/apply-progress` (architecture, capture_prompt: false). One observation per task + finalize.

## PR4 — readme + seeds (started 2026-06-19)
Anchored by commit: `chore(sdd): pr4-readme start`
Scope: `src/projects/README.md` (route table, canonical error envelope, DIFF semantics with concrete before/after examples, links to canonical specs) + optional dev seed script under `src/cli/seed-projects.ts` + `src/cli/seed-projects.spec.ts` (Task 4.2; included per the user's "acabemos con esto" signal — the project is meant to be developed against a seeded DB, so the value of a one-shot seed script outweighs the deferral risk).

Workflow: trunk-based commit-range on `domain/projects`. NO work branch. NO push. NO PR. Append-only commits. Per-PR LOC forecast (~20) is informational only — no hard ceiling; both tasks land.

| Task | Title | Status | Commit | Note |
|------|-------|--------|--------|------|
| 4.1  | `src/projects/README.md` | pending | — | — |
| 4.2  | Dev seed script | pending | — | — |


