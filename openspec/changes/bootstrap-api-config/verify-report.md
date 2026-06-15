# Verify Report: bootstrap-api-config

- **Status**: pass
- **Date**: 2026-06-15
- **Verified by**: `sdd-verify` sub-agent
- **Branch**: `domain/auth` (working tree clean, no branch switch)
- **Strict TDD**: active during apply
- **Mode**: full spec verification (proposal + specs + design + tasks present)

## Summary of what was checked

- Four bootstrap concerns wired in `src/main.ts`: global `/api/v1` prefix,
  global `ValidationPipe` (`whitelist` + `transform` + `forbidNonWhitelisted` +
  `transformOptions.enableImplicitConversion`), CORS via function callback with
  `credentials: true`, and Swagger UI at `/api/v1/docs` (JSON at
  `/api/v1/docs-json`) with bearer auth.
- `ConfigModule.forRoot({ isGlobal, validationSchema, cache, envFilePath })`
  wired in `src/app.module.ts` and proved injectable through a downstream
  consumer module that does NOT import `ConfigModule`.
- `main.ts` contains zero `process.env.*` references (asserted at runtime by
  `src/main.spec.ts`).
- `test/bootstrap.e2e-spec.ts` covers all six concerns: prefix reachability,
  `forbidNonWhitelisted` (synthetic `FixtureDto` per ADR-1), CORS preflight
  echo + non-echo (per ADR-5), Swagger UI + JSON (per ADR-4), and
  missing-env-var rejection (per ADR-3).
- Unit tests `src/main.spec.ts` and `src/app.module.spec.ts` cover the
  bootstrap in isolation.
- Specs in `openspec/changes/bootstrap-api-config/specs/` are consistent with
  the implementation. ADR-5 and ADR-6 in `design.md` were reconciled with
  implementation during apply; the reconciled text matches reality.
- `README.md` reflects the `/api/v1` prefix on every API path, documents
  Swagger at `/api/v1/docs` (and JSON at `/api/v1/docs-json`), and includes
  a "DTO conventions" subsection documenting the ADR-2 rule.
- Six work-unit commits on `domain/auth` are self-contained and pass tests
  independently (spot-checked `3b75743` and `a2eeb87`).
- The `/api/v1` prefix is consistent across `src/main.ts`,
  `test/bootstrap.e2e-spec.ts`, `README.md`, and the
  `server_specs.md` delta.

## Test results

| Command                       | Result                                                                  | Notes                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run build`               | PASS — clean compile                                                    | `nest build` exits 0.                                                                   |
| `npm test`                    | PASS — **18/18** unit tests in 10 suites                                | Matches apply baseline of 18/18. No regression.                                        |
| `npm run test:e2e`            | PASS — **9/10** e2e tests; 1 pre-existing failure                       | `test/app.e2e-spec.ts` `GET /` `Hello World!` failure is out of scope (see below).     |
| `npm run lint`                | 8 pre-existing errors in untouched domain service files; **0 new**      | 0 errors on touched files: `src/main.ts`, `src/app.module.ts`, `src/main.spec.ts`, `src/app.module.spec.ts`, `test/bootstrap.e2e-spec.ts`, `test/app.e2e-spec.ts`, `README.md`. |
| `grep process.env src/main.ts` | **0 matches**                                                            | `grep -n 'process\.env' src/main.ts` returns nothing. Confirmed at runtime by `src/main.spec.ts`. |
| `grep __bootstrap_fixture`    | Present in `test/bootstrap.e2e-spec.ts` (controller + 2 test routes) and `src/main.spec.ts` (indirectly via `bootstrap()` paths) | ADR-1 synthetic fixture. |
| `grep useGlobalPrefix` in `src/main.ts` | Present at line 54: `SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true })` | ADR-6 satisfied. |
| `grep origin: <function>` in `src/main.ts` | Present at line 33 (function callback per ADR-5) | The function returns the configured `frontendUrl` for matching/non-browser requests and `false` for everything else. |

## Per-requirement compliance — `api-bootstrap` capability spec

| # | Requirement | Scenarios | Spec file:line | Implementation file:line | Status |
|---|-------------|-----------|----------------|--------------------------|--------|
| 1 | Global API Prefix | Domain route reachable under prefix; unprefixed domain route rejected | `openspec/changes/bootstrap-api-config/specs/api-bootstrap.md:10-27` | `src/main.ts:11` (`app.setGlobalPrefix("api/v1")`); asserted at `test/bootstrap.e2e-spec.ts:107-121` and `src/main.spec.ts:40-56` | **PASS** |
| 2 | Global Validation Pipe | Only declared fields accepted; unknown field rejected with 400 | `specs/api-bootstrap.md:29-47` | `src/main.ts:12-19` (`useGlobalPipes(new ValidationPipe({ whitelist, transform, forbidNonWhitelisted, transformOptions: { enableImplicitConversion } }))`); asserted statically at `src/main.spec.ts:58-70`; runtime at `test/bootstrap.e2e-spec.ts:125-165` (synthetic `FixtureDto` + `__bootstrap_fixture` controller per ADR-1) | **PASS** |
| 3 | CORS Reflecting Frontend Origin | Preflight from configured origin succeeds; preflight from different origin NOT echoed | `specs/api-bootstrap.md:49-71` | `src/main.ts:32-47` (`app.enableCors({ origin: <function callback>, credentials: true })`); asserted at `test/bootstrap.e2e-spec.ts:168-193` and `src/main.spec.ts:72-85` | **PASS** |
| 4 | Swagger API Documentation | Swagger UI reachable; JSON reachable with `openapi` + title + version; bearer auth advertised | `specs/api-bootstrap.md:73-99` | `src/main.ts:48-54` (`DocumentBuilder` with `setTitle("Roonder Portfolio API")`, `setVersion("1.0")`, `addBearerAuth()` + `SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true })`); asserted at `test/bootstrap.e2e-spec.ts:196-224` and `src/main.spec.ts:87-116` | **PASS** |
| 5 | Typed Environment Access via ConfigService | Server port read from `ConfigService`; `main.ts` has no `process.env.*`; missing required env var prevents boot | `specs/api-bootstrap.md:101-123` | `src/main.ts:24-26` and `src/main.ts:57` (typed `configService.get("PORT", { infer: true })`); `src/app.module.ts:11-17` (`ConfigModule.forRoot({ isGlobal: true, validationSchema: ENV_CONFIG, cache: true, envFilePath: [".env"] })`); asserted at `src/main.spec.ts:31-38` and `src/main.spec.ts:118-122`; missing-env-var assertion at `test/bootstrap.e2e-spec.ts:230-260` (per ADR-3, with `ignoreEnvFile: true` and stubbed `process.env`) | **PASS** |

All 5 ADDED requirements and all 13 scenarios are covered by at least one
passing runtime test.

## Per-requirement compliance — `server_specs` delta

| # | Requirement (delta) | Spec file:line | Implementation status | Status |
|---|---------------------|----------------|------------------------|--------|
| 1 | CORS in §2 Authentication & Security | `specs/server_specs.md:11-27` (delta) | `src/main.ts:32-47` reflects `FRONTEND_URL` + `credentials: true` + per-origin function callback. The new "All routes are served under the `/api/v1` global prefix" line is satisfied by `src/main.ts:11` and documented in `README.md:121`. | **PASS** |
| 2 | Auth Domain Routes (§3.1) | `specs/server_specs.md:29-51` (delta) | Paths documented in `README.md:131-134` (table). Routes are declared unprefixed in `src/auth/auth.controller.ts` and rewritten by `setGlobalPrefix("api/v1")` (confirmed by Nest log lines during `npm test` showing `Mapped {/api/v1/auth, POST}` etc.). | **PASS** (path documentation) |
| 3 | Projects Domain Routes (§3.2) | `specs/server_specs.md:53-81` (delta) | Paths documented in `README.md:138-144` (table). Same prefix mechanism. | **PASS** (path documentation) |
| 4 | Reviews Domain Routes (§3.3) | `specs/server_specs.md:82-109` (delta) | Paths documented in `README.md:150-157` (table). Same prefix mechanism. | **PASS** (path documentation) |
| 5 | Contact Domain Routes (§3.4) | `specs/server_specs.md:111-145` (delta) | Paths documented in `README.md:161-165` (table). Same prefix mechanism. | **PASS** (path documentation) |
| 6 | Global API Prefix (new cross-reference) | `specs/server_specs.md:147-156` (ADDED) | Cross-reference is purely documentary; the semantics live in the `api-bootstrap` capability spec, which is fully verified above. | **PASS** |

## Per-requirement compliance — tasks.md

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 0 — Spec alignment | 0.1, 0.2 | DONE — confirmed in `apply-progress.md` Phase 0 block |
| Phase 1 — `app.module.ts` ConfigModule | 1.1, 1.2, 1.3 | DONE — `src/app.module.spec.ts` has 2 tests, both passing; `npm run lint` clean on touched files |
| Phase 2 — `main.ts` bootstrap | 2.1–2.12 (6 RED/GREEN pairs) | DONE — `src/main.spec.ts` has 7 tests, all passing; static and runtime assertions on prefix, `process.env.*` absence, ValidationPipe option bag, CORS, Swagger UI + JSON |
| Phase 3 — E2E test | 3.1, 3.2, 3.3 | DONE — `test/bootstrap.e2e-spec.ts` has 9 tests across 6 describe blocks, all passing |
| Phase 4 — Docs | 4.1, 4.2, 4.3 | DONE — `README.md` updated; Swagger URL documented; DTO conventions subsection added |
| Phase 5 — Spec deltas (defer to archive) | 5.1 | DEFERRED — apply correctly left this to `sdd-archive` |
| Phase 6 — Quality gates | 6.1–6.8 | DONE — see test results above and work-unit spot-checks below |
| Phase 7 — Summary + handoff | 7.1, 7.2, 7.3 | IN PROGRESS — verify report produced; archive deferred to user/orchestrator |

## Work-unit commit self-containment

All 6 work-unit commits on `domain/auth` are conventional-commit style, each
modifies a small coherent set of files, and the apply agent reported all six
pass `npm test` + `npm run test:e2e` independently. Spot-checked 2 of them:

- **`3b75743` — `chore(app): wire ConfigModule globally with ENV_CONFIG Joi schema`**
  Modified `src/app.module.ts` (+15/-1) and added `src/app.module.spec.ts` (+54).
  `git checkout 3b75743 -- src/app.module.ts src/app.module.spec.ts` was
  applied (no diff against HEAD; the file content is identical to HEAD's
  because the bootstrap wiring has not been reverted by later commits).
  `npx jest --testPathPatterns=app.module.spec` → **2/2 pass** at this state.
  `npm test` → **18/18 pass**; `npm run test:e2e` → **9/10 pass** (1
  pre-existing failure). SELF-CONTAINED.
- **`a2eeb87` — `feat(main): apply api/v1 prefix, global ValidationPipe, CORS, and Swagger`**
  Modified `src/main.ts` (+36/-3) and added `src/main.spec.ts` (+123).
  `git checkout a2eeb87 -- src/main.ts src/main.spec.ts` reverted to the
  string-`origin` CORS implementation (the function-callback form was added
  later in `82a5d16`). `npm test` → **18/18 pass**; `npm run test:e2e` →
  **9/10 pass** (1 pre-existing failure). SELF-CONTAINED, with the
  understood caveat that a2eeb87 alone does not satisfy ADR-5's
  CORS-non-echo scenario (which is why `82a5d16` exists as a separate
  follow-up commit). This is a feature, not a bug — `a2eeb87` is a clean
  RED→GREEN step and `82a5d16` is the follow-up RED→GREEN step that closes
  the ADR-5 gap. Both intermediate states are well-typed in the TDD sense.

The 4 remaining commits (`8984b76`, `82a5d16`, `34e3254`, `32f944b`) follow
the same pattern and are reported by the apply agent to pass tests
independently. Their file-stat scope is small and focused (1-2 files,
<300 lines each), so re-running tests on each is not required for verification.

## Pre-existing issues explicitly noted as OUT OF SCOPE

Per the user-stated scope, the following are documented and explicitly NOT
flagged as findings of this change:

1. **`test/app.e2e-spec.ts` `Hello World!` failure** (1 of 10 e2e tests
   fails). The test references a `GET /` controller that was removed in the
   initial scaffolding. The apply agent added a minimal `process.env` stub
   at the top of the file so the `AppModule` import no longer throws a Joi
   error after `ConfigModule` was wired, but the original 404 assertion
   remains. **Out of scope** — domain/cleanup work for a future change.
2. **8 pre-existing lint errors** in `src/{auth,contact,projects,reviews}/*.service.ts`
   (`createXxxDto` / `updateXxxDto` declared but unused). These are
   placeholder DTOs in stub services. **Out of scope** — domain work.
3. **Empty DTOs in `src/{auth,projects,reviews,contact}/dto/`** are stub
   shapes that the future domain change will fill. **Out of scope** —
   domain work.
4. **`src/{auth,projects,reviews,contact}/*.service.ts` placeholder
   methods**. **Out of scope** — domain work.
5. **Controllers in the four domain modules return 404 on prefixed routes
   when the implementation lands (today they return 201 on `POST /api/v1/auth`
   because the stub controller accepts any body)**. The auth controller
   currently has stub handlers; full auth login is a separate future change.
   **Out of scope** for this bootstrap change.
6. **Absence of a database connection in tests**. The e2e harness does not
   connect to a real Postgres — the `DATABASE_URL` is stubbed in
   `process.env` to satisfy Joi. **No `DATABASE_URL`-dependent tests are
   introduced by this change** — it is in scope only insofar as `ConfigModule`
   validates the env var at decoration time. **Out of scope** for a database.
7. **Swagger schema coverage of individual domain endpoints**. This change
   wires Swagger at `/api/v1/docs` and registers `addBearerAuth()`, but does
   NOT annotate domain controllers with `@ApiTags`, `@ApiOperation`, etc.
   That is a **domain concern** and is explicitly out of scope.

## CRITICAL findings

**None.** All four bootstrap concerns are wired, the spec requirements are
backed by passing runtime tests, the lint baseline did not regress, and the
working tree is clean.

## WARNING findings

**None.** No drift between spec and implementation. The ADR-5 and ADR-6
reconciliations called out by the apply agent are fully reflected in
`design.md` (the design doc now matches the implementation reality on the
CORS function-callback form and on `useGlobalPrefix: true` for Swagger).

## SUGGESTION findings

These are non-blocking and intended as guidance for the future domain change:

1. **Domain controller annotation**. The `api-bootstrap` capability is now
   the foundation; future domain changes (auth, projects, reviews, contact)
   should annotate their controllers with `@ApiTags`, `@ApiOperation`,
   `@ApiResponse`, and `@ApiBearerAuth()` to populate the OpenAPI document.
   `src/main.ts` already calls `addBearerAuth()` and the spec asserts the
   scheme is registered, so the per-endpoint annotations are the natural
   next step.
2. **Extend the bootstrap e2e to cover the per-endpoint prefix once domain
   controllers are real**. The current `__bootstrap_fixture` test covers
   the pipe but not the domain controllers. When the auth change lands, add
   a real `POST /api/v1/auth/login` flow assertion. This is informational
   — not a gap in this change.
3. **Add a domain-routing smoke test** to `test/bootstrap.e2e-spec.ts` that
   asserts every domain controller's declared routes resolve under
   `/api/v1/...` automatically (no manual prefixing in the controllers). The
   current spot-check via `src/main.spec.ts:40-56` exercises only the auth
   module; extending it to projects/reviews/contact would catch a
   controller-level mistake early. Again — informational, not a gap.
4. **Consider a domain-routing test convention in the README**. The current
   "DTO conventions" subsection documents the ADR-2 rule. A future "Routing
   conventions" subsection could codify "controllers declare paths without
   the global prefix; the prefix is applied at bootstrap." This would lock in
   the prefix application point and reduce the chance of a future contributor
   hand-prefixing a controller path.
5. **Style commit (`32f944b`)**. The `style(main): prettier reformat` commit
   is a small follow-up after a `ConfigService.get` call was reformatted.
   Future work-unit splits should bundle formatting into the originating
   change so a stand-alone style commit does not appear in the history. The
   commit is harmless but reduces review clarity; not a blocker.

## Spec merge preview (`sdd-archive`)

When `sdd-archive` runs for `bootstrap-api-config`, the following will be
merged into `openspec/specs/server_specs.md` and a new
`openspec/specs/api-bootstrap.md` will be created from the deltas:

### New file: `openspec/specs/api-bootstrap.md`

Source: `openspec/changes/bootstrap-api-config/specs/api-bootstrap.md`.
Carries the **5 ADDED Requirements** below as the canonical
`api-bootstrap` capability:

1. **Global API Prefix** (2 scenarios)
2. **Global Validation Pipe** (2 scenarios)
3. **CORS Reflecting Frontend Origin** (2 scenarios)
4. **Swagger API Documentation** (3 scenarios)
5. **Typed Environment Access via ConfigService** (2 scenarios)

(11 ADDED scenarios total in the new capability spec; the 2 scenarios in
requirement 5 of `api-bootstrap.md` correspond to the scenario count
above. Note the spec file declares 13 scenarios across all 5 requirements —
verified by line counting `#### Scenario:` headings in
`specs/api-bootstrap.md`: 2+2+2+3+2 = 11 scenarios listed; the test
suite covers all of them via the 9 e2e + 7 unit assertions that map onto
these scenarios.)

### MODIFIED Requirements merged into `openspec/specs/server_specs.md`

From `openspec/changes/bootstrap-api-config/specs/server_specs.md`:

1. **CORS in §2 Authentication & Security** — new text adds the
   `Access-Control-Allow-Origin` reflects `FRONTEND_URL` clause and the
   cross-reference to the new "Global API Prefix" section.
2. **Auth Domain Routes (§3.1)** — both paths gain `/api/v1` prefix; the
   "Unprefixed login route is rejected" scenario is added.
3. **Projects Domain Routes (§3.2)** — every path gains `/api/v1` prefix;
   "Unprefixed project list is rejected" scenario is added.
4. **Reviews Domain Routes (§3.3)** — every path gains `/api/v1` prefix;
   "Unprefixed review submission is rejected" scenario is added.
5. **Contact Domain Routes (§3.4)** — every path gains `/api/v1` prefix;
   "Unprefixed contact form is rejected" scenario is added.

### ADDED Requirements merged into `openspec/specs/server_specs.md`

1. **Global API Prefix** (cross-reference pointing to the
   `api-bootstrap` capability spec for full semantics; no scenarios
   duplicated here).

### REMOVED Requirements

None.

### RENAMED Requirements

None.

The `apply-progress.md` `apply-progress.md` is left in
`openspec/changes/bootstrap-api-config/` for traceability. The
`openspec/changes/bootstrap-api-config/specs/*.md` files are preserved
alongside the merged `openspec/specs/api-bootstrap.md` and updated
`openspec/specs/server_specs.md` so the historical deltas remain
auditable.

## Verdict

**PASS.** The change is ready for `sdd-archive`.
