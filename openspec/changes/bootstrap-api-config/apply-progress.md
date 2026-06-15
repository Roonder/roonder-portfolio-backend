# Apply Progress: bootstrap-api-config

**Change**: bootstrap-api-config
**Mode**: Strict TDD
**Started**: 2026-06-15
**Branch**: domain/auth

## Phase 0: Spec alignment

- [x] 0.1 Read proposal, specs (api-bootstrap.md, server_specs.md), design, tasks end-to-end. File-level scope confirmed:
  - Modified: `src/main.ts`, `src/app.module.ts`
  - New: `test/bootstrap.e2e-spec.ts`
  - Modified at archive time: `openspec/specs/server_specs.md`
  - Modified: `README.md`
  - Read-only: `src/config/env.config.ts`
- [x] 0.2 npm install verified — `@nestjs/swagger`, `cors`, `@nestjs/config`, `joi` all present in node_modules.

**Baseline test status**:
- `npm test`: 8 passed, 8 total (PASS)
- `npm run test:e2e`: 1 failed (pre-existing — `test/app.e2e-spec.ts` references a removed `GET /` `Hello World!` controller; out of scope for this change; the broken E2E will be left in place per the "no domain changes" rule and not regenerated)

## Phases

- [x] Phase 1: app.module.ts — ConfigModule
- [x] Phase 2: main.ts refactor (6 RED/GREEN pairs)
- [x] Phase 3: E2E test in test/
- [x] Phase 4: README updates
- [x] Phase 5: Spec deltas — deferred to archive
- [x] Phase 6: Quality gates and PR readiness
- [x] Phase 7: Summary + handoff

## TDD Evidence Table

| Substep | RED | GREEN | REFACTOR | Tests Run | Pass/Fail |
|---------|-----|-------|----------|-----------|-----------|
| 1.1 / 1.2 | wrote `src/app.module.spec.ts` asserting `ConfigService` is injectable globally and returns Joi-validated values; failed initially because `ConfigModule` was not wired | added `ConfigModule.forRoot({ isGlobal, validationSchema, cache, envFilePath })` to `imports` in `src/app.module.ts` | n/a | `npx jest --testPathPatterns=app.module` | 2 passed |
| 2.1 / 2.2 | wrote `src/main.spec.ts` asserting `bootstrap()` returns `NestApplication`; failed because no exported function existed and file-level call blocked | refactored `src/main.ts` to `export async function bootstrap(): Promise<INestApplication>` with `if (require.main === module) void bootstrap();` entry guard | n/a | `npx jest --testPathPatterns=main.spec` | 1 passed |
| 2.3 / 2.4 | added assertion: `mainSource` must NOT contain `process.env.PORT`; failed | replaced `process.env.PORT ?? 3000` with `configService.get('PORT', { infer: true }) as number` (cast needed for TS strictNullChecks since Joi.required() is not type-narrowed) | added 2.4b assertion: `mainSource` must NOT contain any `process.env.*` | `npx jest --testPathPatterns=main.spec` | 2 passed |
| 2.5 / 2.6 | asserted: `POST /api/v1/auth` returns 201 and `POST /auth` returns 404 (verifying prefix is applied to all routes via supertest) | added `app.setGlobalPrefix('api/v1')` | n/a | `npx jest --testPathPatterns=main.spec` | 1 passed |
| 2.7 / 2.8 | asserted source-level: `useGlobalPipes(new ValidationPipe({...}))` with all 4 options; failed | added ValidationPipe with whitelist, transform, forbidNonWhitelisted, enableImplicitConversion | n/a | `npx jest --testPathPatterns=main.spec` | 1 passed |
| 2.9 / 2.10 | asserted: OPTIONS preflight from `https://app.example.com` to `/api/v1/auth` echoes `access-control-allow-origin` and `access-control-allow-credentials: true`; failed (no CORS) | added `app.enableCors({ origin: frontendUrl, credentials: true })` | n/a | `npx jest --testPathPatterns=main.spec` | 1 passed |
| 2.11 / 2.12 | asserted: `GET /api/v1/docs` → 200 HTML; `GET /api/v1/docs-json` → 200 with `openapi` field, `info.title === 'Roonder Portfolio API'`, `info.version === '1.0'`, and `components.securitySchemes.bearer` present; failed (404) | added `DocumentBuilder` (title, version, addBearerAuth), `SwaggerModule.createDocument`, and `SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true })` | n/a | `npx jest --testPathPatterns=main.spec` | 2 passed |
| 3.1 / 3.2 | wrote `test/bootstrap.e2e-spec.ts` with 6 describe blocks: prefix reachability, forbidNonWhitelisted (synthetic FixtureDto + __bootstrap_fixture controller per ADR-1), CORS preflight echo, CORS preflight non-echo (per ADR-5), Swagger UI + JSON (per ADR-4), missing-env-var rejection (per ADR-3); first run failed | iterated: process.env stub at top of file before imports, switched bootstrapTestApp to Test.createTestingModule + init() (no listen()) to avoid Nest's exception-zone process.exit, mirrored CORS function in the e2e setup, kept `if (require.main === module)` entry guard | n/a | `npm run test:e2e` | 9/10 passed (1 pre-existing app.e2e-spec.ts failure for non-existent Hello World! controller — out of scope) |

## Commits so far

- `3b75743` chore(app): wire ConfigModule globally with ENV_CONFIG Joi schema
- `a2eeb87` feat(main): apply api/v1 prefix, global ValidationPipe, CORS, and Swagger
- `8984b76` test(e2e): cover bootstrap behavior
- `82a5d16` feat(main): use CORS origin function to skip mismatched origins
- `34e3254` docs(readme): document prefix, Swagger, and DTO conventions
- `32f944b` style(main): prettier reformat of ConfigService.get call

## Phase 6 verification (quality gates)

- 6.1 Lint: 0 errors on touched files (`src/app.module.ts`, `src/app.module.spec.ts`, `src/main.ts`, `src/main.spec.ts`, `test/bootstrap.e2e-spec.ts`, `test/app.e2e-spec.ts`). 8 pre-existing errors remain in `src/{auth,contact,projects,reviews}/*.service.ts` (unused DTO params) — out of scope.
- 6.2 Build: clean.
- 6.3 Unit tests: 18/18 pass.
- 6.4 E2E tests: 9/10 pass. The 1 failure is in `test/app.e2e-spec.ts` — pre-existing (the test asserts `GET /` returns "Hello World!" but the AppController was removed in the initial scaffolding). This is not introduced by this change.
- 6.5 Coverage: report generated; no threshold enforced.
- 6.6 Git status: working tree clean of unintended changes (only `openspec/changes/` is untracked, which is the SDD artifact and expected to stay that way).
- 6.7 Work-unit commits: 6 commits, each self-contained and tests passing.
- 6.8 Re-read design file-by-file plan: each file matches design intent. `src/config/env.config.ts` untouched. No `process.env.*` in `main.ts` (asserted by `main.spec.ts`). No domain changes.

## Next phase to run

Phase 7: Summary + handoff

## Design clarifications discovered (non-blocking)

1. **`SwaggerModule.setup` and global prefix**: ADR-6 in `design.md` claimed that `SwaggerModule.setup('docs', ...)` "registers under the prefix automatically" without `exclude`. This is incorrect for `@nestjs/swagger@11.4.x`: the setup method requires the `useGlobalPrefix: true` option to honor the prefix. Without it, the routes are mounted at `/docs` and `/docs-json` (404 with prefix). The fix is one extra option flag and does not violate the "no `exclude`" rule. Spec requirements (`/api/v1/docs` 200, `/api/v1/docs-json` 200) are satisfied. This is a small clarification, not a blocker — implementation continues and the design note is preserved.

2. **CORS `origin` as function, not string**: ADR-5 in `design.md` says CORS should be configured with `origin: FRONTEND_URL`, which the `cors` npm package treats as a static value and reflects on EVERY response (regardless of the request's `Origin`). The spec mandates that a mismatched origin MUST NOT receive a matching `Access-Control-Allow-Origin` header. Switched to a function callback that returns `frontendUrl` for matching/non-browser requests and `false` for everything else. This is the proper implementation of the spec intent and is consistent with ADR-5's "assert on the response header, not the status code" guidance.

3. **`process.env` in test file must precede imports**: ES module imports are hoisted, so any `process.env.X = ...` placed AFTER the import statements in a test file does NOT run before the imported module is evaluated. This matters because `ConfigModule.forRoot()` runs at decoration time (when the `@Module` decorator is evaluated), so it reads `process.env` synchronously during the import. The fix is to place the env stubs at the very top of the test file, before any `import` statement. This is a TDD/import-hoisting gotcha worth recording.

4. **Pre-existing `app.e2e-spec.ts` failure**: The original NestJS scaffold's `GET /` `Hello World!` test was already broken before this change (the controller no longer exists). After wiring ConfigModule, the failure mode changed from a 404 assertion failure to a Config validation error on import (which crashed the test process). The fix is a minimal `process.env` stub at the top of the file so the AppModule import doesn't throw. The pre-existing 404 assertion failure remains, but is not introduced by this change.

## Next phase to run

Phase 4: README updates

## Blockers

(none)

## Next phase to run

Phase 1: app.module.ts — ConfigModule
