# Proposal: Bootstrap API Config (prefix, validation, CORS, Swagger)

## Intent

`main.ts` boots a bare Nest app: no global prefix, no CORS, no global `ValidationPipe`, no Swagger, and `process.env.PORT` is read directly instead of the Joi-validated `ConfigModule`. `@nestjs/swagger` and `cors` are installed but unwired. One PR wires the four bootstrap concerns so domain work lands on a documented HTTP surface.

## Scope

### In Scope

- `main.ts`: prefix `api/v1`; `ConfigService<EnvConfig>.get('PORT')`; global `ValidationPipe` (`whitelist, transform, forbidNonWhitelisted, enableImplicitConversion`); CORS from `FRONTEND_URL` + `credentials: true`; Swagger `DocumentBuilder` ("Roonder Portfolio API", v1.0) + `addBearerAuth()` at `docs`. Paths: `/api/v1/auth/login`, `/api/v1/projects`, `/api/v1/docs`, `/api/v1/docs-json`.
- `app.module.ts`: `ConfigModule.forRoot({ isGlobal, validationSchema: ENV_CONFIG, cache: true, envFilePath: ['.env'] })`.
- Spec: add "Global API Prefix" section; prefix every path with `/api/v1`.
- README: API tables gain `/api/v1`; add Swagger URL.
- New `test/bootstrap.e2e-spec.ts`: prefix, `forbidNonWhitelisted`, CORS preflight, Swagger UI, Swagger JSON.

### Out of Scope

Domain implementations; coverage threshold raise; `tsconfig` strict tightening; custom exception filter; custom `ConfigService` augmentation.

## Capabilities

> Contract with sdd-spec. Source: `openspec/specs/server_specs.md`.

### New Capabilities

- `api-bootstrap`: HTTP cross-cutting — prefix, env validation, request validation, CORS, Swagger.

### Modified Capabilities

- `server_specs.md`: §§3.1–3.4 paths and §2 CORS line gain `/api/v1`; new "Global API Prefix" section.

## Approach

Single PR on `domain/auth`. Reuse `ENV_CONFIG` + `EnvConfig`. `cache: true` skips Joi per `get()`. Swagger at `'docs'` resolves under the prefix automatically.

## Affected Areas

- `src/main.ts` (modified), `src/app.module.ts` (modified), `src/config/env.config.ts` (read-only).
- `openspec/specs/server_specs.md` (modified), `README.md` (modified), `test/bootstrap.e2e-spec.ts` (new).

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `forbidNonWhitelisted` rejects a DTO with extra fields. | Med | DTOs out of scope; pipe is bootstrap-only. DTO fix lands in its domain change if E2E catches a regression. |
| `enableImplicitConversion` silently coerces bad input. | Low | Project-wide default; design notes that future DTOs need explicit `@Type()` where coercion is unsafe. |
| Missing-env-var test is fragile (cached global `ConfigModule`). | Med | `design.md`: `Test.createTestingModule` with `{ ignore: ['.env*'] }` + stubbed `process.env`; fall back to a `node -e` exit-code script. |
| `/api/v1/docs-json` suffix is a Nest convention. | Low | Assert on response body (`openapi` field), not the URL. |

## Rollback Plan

Single PR, no domain/schema changes → `git revert <sha>` on `domain/auth` (or revert the merge on `main`). No migration, no env churn, no DB rollback.

## Dependencies

`@nestjs/swagger` + `cors` (installed); `ENV_CONFIG` + `EnvConfig` (reused); `test/jest-e2e.json` (reused).

## Success Criteria

- [ ] `npm run build`, `npm test`, `npm run test:e2e` all pass.
- [ ] `GET /api/v1/projects` → 200; `GET /projects` → 404.
- [ ] `/api/v1/docs` → 200; `/api/v1/docs-json` → 200 with `openapi`.
- [ ] `OPTIONS` from `FRONTEND_URL` echoes `Access-Control-Allow-Origin`.
- [ ] Unknown body field on validated endpoint → 400.
- [ ] Spec + README reflect `/api/v1` + Swagger URL.
