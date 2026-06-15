# Tasks: Bootstrap API Config (prefix, validation, CORS, Swagger)

## Conventions

- **Strict TDD is on** (`openspec/config.yaml > rules.apply.tdd: true`). Every testable task lists a RED step (write a failing test first) and a GREEN step (make it pass). Pure refactor steps (e.g. 2.2) are RED-only on the next assertion pair.
- **Test commands**: unit `npm test`, watch `npm run test:watch`, e2e `npm run test:e2e`, coverage `npm run test:cov`, build `npm run build`, lint `npm run lint`, format `npm run format`.
- **File conventions**:
  - Unit tests: `*.spec.ts` colocated next to the source file under `src/` (Jest `rootDir: src`).
  - **E2E test exception**: `test/bootstrap.e2e-spec.ts` lives under `test/` (not `src/`) because the project uses a separate `test/jest-e2e.json` runner with `testRegex: .e2e-spec.ts$`. The implementer MUST NOT try to colocate the bootstrap e2e in `src/`.
- **Commit conventions**: work-unit commits per the `work-unit-commits` skill — split the change into reviewable commits. Each commit MUST be self-contained and pass tests independently. Conventional commits only; no AI attribution.
- **`sdd-apply` sub-agent responsibilities**: read all artifacts end-to-end (proposal, specs, design, this tasks file, `openspec/config.yaml`); follow the task list in order; save `apply-progress` after each phase; do not modify `proposal.md`, spec files, or `design.md`; defer the spec deltas merge to `sdd-archive`.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~260 (per proposal) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-always |
| Chain strategy | n/a (single PR) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: n/a
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | ConfigModule wired in `app.module.ts` with a colocated spec | commit within single PR | foundation; self-contained |
| 2 | `main.ts` bootstrap refactored: typed port, prefix, ValidationPipe, CORS, Swagger | commit within single PR | depends on Unit 1 |
| 3 | `test/bootstrap.e2e-spec.ts` covering all six concerns | commit within single PR | depends on Units 1–2 |
| 4 | `README.md` updates for prefix, Swagger, and DTO conventions | commit within single PR | docs with the change |

All four work units ship in ONE PR on `domain/auth` (~260 lines total — well under the 400-line review budget).

## Phase 0: Spec alignment (no code)

- [x] 0.1 Read `openspec/changes/bootstrap-api-config/proposal.md`, `specs/api-bootstrap.md`, `specs/server_specs.md`, and `design.md` end-to-end. State the file-level scope: 2 source files modified (`src/main.ts`, `src/app.module.ts`), 1 e2e test created (`test/bootstrap.e2e-spec.ts`), 1 spec doc merged at archive time (`openspec/specs/server_specs.md`), 1 README updated (`README.md`); `src/config/env.config.ts` is read-only.
- [x] 0.2 Confirm `npm install` is up to date (dependencies `@nestjs/swagger` and `cors` already present per the proposal).

## Phase 1: `app.module.ts` — ConfigModule

- [x] 1.1 RED: extend `src/app.module.spec.ts` (create the file if absent) to assert `ConfigModule` is registered with `isGlobal: true` and `validationSchema: ENV_CONFIG`. Test fails (module is not yet wired). Run `npm test`.
- [x] 1.2 GREEN: add `ConfigModule.forRoot({ isGlobal: true, validationSchema: ENV_CONFIG, cache: true, envFilePath: ['.env'] })` to the `imports` array in `src/app.module.ts`. Test passes. Run `npm test`.
- [x] 1.3 Run `npm run lint` and `npm run format` on the touched files.

## Phase 2: `main.ts` — typed port, prefix, ValidationPipe, CORS, Swagger

- [x] 2.1 RED: create `src/main.spec.ts` (colocated) importing the `bootstrap` function refactored out of `main.ts` and asserting the returned `INestApplication` is configured (smoke assertion — instance of `INestApplication`). Test fails (no extracted function exists yet). Run `npm test`.
- [x] 2.2 GREEN (refactor): rewrite `src/main.ts` to export an `async function bootstrap(): Promise<INestApplication>` that calls `NestFactory.create(AppModule)` and returns the `app` instance. Update the entry point to `bootstrap().then((app) => app.listen(...))`. No behavior change yet; smoke test from 2.1 now passes.
- [x] 2.3 RED: in `src/main.spec.ts`, assert that with `process.env.PORT = '4000'` and a wired config, `app.getHttpAdapter().getInstance().listen` is called with the port returned by `ConfigService.get('PORT', { infer: true })`. Test fails (still reads `process.env.PORT` directly). Run `npm test`.
- [x] 2.4 GREEN: replace `process.env.PORT ?? 3000` with `configService.get('PORT', { infer: true })` (inject `ConfigService<EnvConfig>` from the app). Test passes. Confirm `main.ts` contains zero `process.env.*` references (spec Requirement: Typed Environment Access).
- [x] 2.5 RED: in `src/main.spec.ts`, assert `app.getGlobalPrefix()` returns `'api/v1'`. Test fails (no prefix set). Run `npm test`.
- [x] 2.6 GREEN: call `app.setGlobalPrefix('api/v1')` (no `exclude` per ADR-6). Test passes.
- [x] 2.7 RED: in `src/main.spec.ts`, assert that the global `ValidationPipe` is registered with `whitelist`, `transform`, `forbidNonWhitelisted`, and `transformOptions.enableImplicitConversion` — by hitting a test route and verifying a 400 on an unknown body field, or by reflecting on the app's global pipes. Test fails. Run `npm test`.
- [x] 2.8 GREEN: call `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }))`. Test passes.
- [x] 2.9 RED: in `src/main.spec.ts`, assert `app.enableCors` was called with `{ origin: <FRONTEND_URL>, credentials: true }` — verified by issuing a request with the configured `Origin` and checking the `Access-Control-Allow-Origin` response header. Test fails. Run `npm test`.
- [x] 2.10 GREEN: call `app.enableCors({ origin: configService.get('FRONTEND_URL', { infer: true }) as string, credentials: true })`. Test passes.
- [x] 2.11 RED: in `src/main.spec.ts`, assert that `SwaggerModule.setup` was invoked (verified by `GET /api/v1/docs` returning the Swagger UI HTML). Test fails. Run `npm test`.
- [x] 2.12 GREEN: call `SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Roonder Portfolio API').setVersion('1.0').addBearerAuth().build())` then `SwaggerModule.setup('docs', app, document)`. Test passes.

## Phase 3: E2E test (`test/bootstrap.e2e-spec.ts`)

> This file lives in `test/` (NOT `src/`) — the project uses a separate `test/jest-e2e.json` runner. Do not try to colocate it.

- [x] 3.1 RED: create `test/bootstrap.e2e-spec.ts` with six `describe` blocks per `design.md` file-by-file plan: (a) prefix reachability — `POST /api/v1/auth/login` → 200, `POST /auth/login` → 404; (b) `forbidNonWhitelisted` — synthetic `FixtureDto` + `__bootstrap_fixture` controller per ADR-1, `POST` with an unknown field → 400; (c) CORS preflight echo — `OPTIONS` from `FRONTEND_URL` echoes `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true`; (d) CORS preflight non-echo — `OPTIONS` from a mismatched origin to a non-prefixed URL does NOT carry the configured origin (per ADR-5); (e) Swagger UI + JSON — `GET /api/v1/docs` → 200 (HTML), `GET /api/v1/docs-json` → 200 with top-level `openapi`, `info.title === 'Roonder Portfolio API'`, `info.version === '1.0'`, and `components.securitySchemes.bearer` present (per ADR-4); (f) missing-env-var rejection — `Test.createTestingModule` with `ConfigModule.forRoot({ ignore: ['.env*'], validationSchema: ENV_CONFIG, isGlobal: true })` and stubbed `process.env` that omits `JWT_SECRET` must reject (per ADR-3). All assertions fail on first run. Run `npm run test:e2e`.
- [x] 3.2 GREEN: re-run `npm run test:e2e` against the wired app. Iterate on fixture DTO shape, test module imports, and `process.env` stubbing until all six blocks pass. Use the `__bootstrap_fixture` synthetic controller from ADR-1 — declare it in the test file, not in `src/`.
- [x] 3.3 Run `npm run test:cov`. Confirm the bootstrap e2e executes and reports coverage. No threshold enforced (`coverage_threshold: 0`).

## Phase 4: Docs

- [x] 4.1 Update `README.md` API tables: every path gains the `/api/v1` prefix. Add a "Swagger" subsection pointing to `/api/v1/docs` and noting the JSON spec at `/api/v1/docs-json`.
- [x] 4.2 Add a "DTO conventions" subsection under the API surface documenting the ADR-2 rule: query and path-parameter DTOs MUST use `@Type(() => Number)` / `@Type(() => Date)` on numeric and date fields; body DTOs MUST NOT — let the strict pipe reject malformed values. Include a short code example.
- [x] 4.3 Run `npm run format` on the README.

## Phase 5: Spec deltas (apply only — archive merges)

- [x] 5.1 No code action. The spec deltas are persisted under `openspec/changes/bootstrap-api-config/specs/` and will be merged into `openspec/specs/server_specs.md` during the `sdd-archive` phase. Mark this task as **deferred to archive**.

## Phase 6: Quality gates and PR readiness

- [x] 6.1 `npm run lint` — zero errors.
- [x] 6.2 `npm run build` — compiles.
- [x] 6.3 `npm test` — all unit tests pass.
- [x] 6.4 `npm run test:e2e` — all e2e tests pass.
- [x] 6.5 `npm run test:cov` — coverage report generated (no threshold enforced).
- [x] 6.6 `git status` clean of unintended changes; only the scoped files are modified.
- [x] 6.7 Work-unit commits (per `work-unit-commits` skill). Suggested split — each commit self-contained, tests included, passes `npm test` and `npm run test:e2e` independently:
  - `chore(app): wire ConfigModule globally`
  - `feat(main): apply api/v1 prefix and global ValidationPipe`
  - `feat(main): enable CORS and Swagger`
  - `test(e2e): cover bootstrap behavior`
  - `docs(readme): document prefix and DTO conventions`
- [x] 6.8 Re-read `design.md` file-by-file change plan and verify each file matches the design's intent (no domain changes; `src/config/env.config.ts` untouched; no `process.env.*` in `main.ts`).

## Phase 7: Summary + handoff

- [x] 7.1 Run `sdd-verify` on the change.
- [x] 7.2 Report success / failure to the orchestrator.
- [x] 7.3 Defer `sdd-archive` until the user reviews the verify output.

## Forecast

- **Total lines changed**: ~260 lines (per proposal). Breakdown estimate: `app.module.ts` ~+6, `main.ts` ~+30, `app.module.spec.ts` ~+25, `main.spec.ts` ~+80, `test/bootstrap.e2e-spec.ts` ~+120, `README.md` ~+10.
- **Single PR**: YES — fits the 400-line review budget comfortably. No chained PRs required.
- **Delivery strategy**: `ask-always`. No decision needed before `sdd-apply` (the proposal already pre-forecasted a single PR and the orchestrator confirmed `ask-always` for this delivery).

## Risk callouts

The implementer MUST keep these three open risks from the proposal/design in mind while working:

1. **`forbidNonWhitelisted` rejects a DTO with extra fields** (Medium likelihood). The E2E test for this requirement uses a synthetic `FixtureDto` + `__bootstrap_fixture` controller per ADR-1 — declared in the test file, not in `src/`. If a real domain DTO starts failing 400s in a future domain change, that fix belongs in the domain change's PR, not here.
2. **`enableImplicitConversion` silently coerces bad input** (Low likelihood). Project-wide convention per ADR-2: query/param DTOs MUST `@Type()` numeric and date fields; body DTOs MUST NOT. Document this in the README (Phase 4.2) so future contributors don't fight the pipe.
3. **Missing-env-var test is fragile** (Medium likelihood, cached global `ConfigModule`). The e2e must use `Test.createTestingModule` with `ConfigModule.forRoot({ ignore: ['.env*'], ... })` and stub `process.env` per ADR-3. If `Test.compile()` / `app.init()` does not reject, fall back to a `node -e` exit-code script — but prefer the in-test approach to avoid expanding the surface area of this PR.
