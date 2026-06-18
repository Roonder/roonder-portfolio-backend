# Proposal: Auth Domain (login, JWT, guard, superuser seed, refresh rotation)

## Intent

`src/auth/` is the NestJS scaffold stub: an empty `AuthController` returning `"This action adds a new auth"` from `POST /auth`, no DTOs, no `User` entity, no TypeORM wiring anywhere in the repo, no `bcrypt`, no `@nestjs/passport`. `server_specs.md` §3.1 mandates `POST /api/v1/auth/login` + `GET /api/v1/auth/profile` (Protected), and `database-schema.dbml` defines the `users` table. This change lands the entire auth domain: bcrypt-hashed User entity on a wired TypeORM data source, the login/refresh/logout endpoints, a JWT access + refresh-token rotation flow, the `JwtAuthGuard` that protects `/auth/profile`, and a `npm run seed:superuser` CLI seeded from `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` env vars.

## Scope

### In Scope

- `src/data-source.ts` + `TypeOrmModule.forRootAsync` in `AppModule` (wired once, used by every future domain).
- `src/auth/entities/user.entity.ts` matching dbml `users` (uuid id, unique email, bcrypt-hashed password, timestamps).
- `AuthService`: `login()`, `refresh()`, `logout()`, `getProfile()` against the `User` repository.
- `AuthController`: `POST /api/v1/auth/login` (public), `POST /api/v1/auth/refresh` (public, reads refresh cookie), `POST /api/v1/auth/logout` (public, revokes family), `GET /api/v1/auth/profile` (protected).
- `JwtStrategy` + `JwtAuthGuard` (`@nestjs/passport` `AuthGuard('jwt')`); `AuthModule` registers them.
- Refresh-token storage table (dbml delta) with reuse-detection family revocation.
- `seed-superuser` CLI + `npm run seed:superuser` script.
- Extend `EnvConfig` + `ENV_CONFIG` Joi with `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD`.
- Spec deltas (auth-domain capability, §3.1, dbml refresh-tokens table, env additions).
- Update the two bootstrap tests that probe `POST /api/v1/auth` (see Affected Areas).

### Out of Scope

- Roles / RBAC beyond "is authenticated" (single-admin system).
- Password reset, email verification, account lockout.
- Refresh-token sliding expiration (rotation is fixed-window).
- First `typeorm migration:generate` run; deferred to the next DB-touching change.
- CORS, ValidationPipe, Swagger, global prefix — owned by `bootstrap-api-config`.

## Capabilities

> Contract with sdd-spec. Source: `openspec/specs/server_specs.md` §3.1, `openspec/specs/database-schema.dbml` `users` table.

### New Capabilities

- `auth-domain`: login, refresh-token rotation with reuse detection, logout, profile, seed-superuser CLI, JwtAuthGuard. Owns the `User` entity and the `refresh_tokens` table.

### Modified Capabilities

- `server_specs.md` §3.1: add `/auth/refresh` and `/auth/logout` endpoints; cross-reference `auth-domain` capability.
- `database-schema.dbml`: add `refresh_tokens` table (uuid, user_id FK, family_id, hashed_token, expires_at, revoked_at, created_at, replaced_by FK).
- `env.config.ts`: 5 new required Joi keys listed above.

## Approach

Seven work-unit commits on `domain/auth`, ordered RED-first per the strict-TDD rule. Each commit ships its own tests.

1. **deps + env schema** (≤20 LOC). Add `@nestjs/typeorm`, `@nestjs/passport`, `bcrypt`, `pg`, `@types/bcrypt` to `package.json`. Extend `EnvConfig` + `ENV_CONFIG`. Test: missing-env-var rejects on the new keys too.
2. **TypeORM wiring + User entity** (≤50 LOC). **This is the standalone TypeORM work-unit commit the user requested.** `src/data-source.ts` (`synchronize: false`, `entities: [UserEntity]`); `TypeOrmModule.forRootAsync` in `AppModule`; `TypeOrmModule.forFeature([UserEntity])` in `AuthModule`. Tests: entity column-shape + `User` constructor defaults.
3. **AuthService + bcrypt + JWT sign/verify** (≤80 LOC, RED-first). Tests: `login` happy path, wrong password, unknown email, refresh happy path, refresh-reuse-detected revokes family, logout revokes family. Implementation: `JwtService.signAsync` (HS256, separate secrets for access vs refresh), `bcrypt.compare` against the stored hash.
4. **AuthController + DTOs + Swagger** (≤70 LOC, RED-first). `LoginDto` (`@IsEmail` email, `@IsString` `@MinLength(8)` password), `RefreshDto` (token from cookie), `@ApiTags('auth')`, `@ApiBearerAuth` on `/profile`. Tests: 200 on valid login, 401 on bad creds, 401 on missing token, 200 on profile with valid bearer, 401 with missing/expired/invalid bearer.
5. **JwtStrategy + JwtAuthGuard** (≤50 LOC, RED-first). `PassportStrategy(Strategy, 'jwt')` reads `Authorization: Bearer …`, validates signature with `JWT_SECRET` + `JWT_EXPIRES_IN`, hydrates the request user. `JwtAuthGuard extends AuthGuard('jwt')`. Applied per-controller with `@UseGuards(JwtAuthGuard)` on `/profile` (NOT globally — future public endpoints like `GET /projects` must not opt out).
6. **seed-superuser CLI** (≤30 LOC). `src/cli/seed-superuser.ts` standalone; `package.json` adds `"seed:superuser": "ts-node src/cli/seed-superuser.ts"`. `upsert` by `email`; bcrypt 12 rounds; idempotent. Unit tests for the inner `seedSuperuser(em, pw, repo)` function (create-missing, update-existing, error-if-env-missing).
7. **Spec deltas + bootstrap test fixup** (≤50 LOC). Apply the three Modified Capabilities. Update `main.spec.ts` and `bootstrap.e2e-spec.ts` to assert the `/api/v1` prefix against a test-only controller (mirror the `__bootstrap_fixture` pattern from `bootstrap-api-config` ADR-1), NOT against `/api/v1/auth` — so the auth change can swap the controller without breaking bootstrap assertions. README gains the auth endpoints table + the seed command.

**Refresh-token rotation** (per user "simple but secure"): a `refresh_tokens` row stores `family_id` (uuid per login session), `hashed_token` (sha-256 of the random 256-bit refresh token), `expires_at`, `revoked_at`, `replaced_by`. Login issues a refresh token; every successful refresh revokes the presented row (`revoked_at = now`) and inserts a new row in the same `family_id` with a new `hashed_token`. **Reuse of an already-revoked row revokes every row sharing that `family_id`** (reuse-detection = theft signal). Tokens travel in an httpOnly Secure SameSite=Lax cookie named `rt`; CORS is already `credentials: true` from `bootstrap-api-config`. The access token is a short-lived bearer in `Authorization`.

**Pre-decided open questions** (rationale in §Open Questions):
- `bcrypt` (native) over `bcryptjs` — Node 22 LTS prebuilts; ~6× faster at 12 rounds; drop-in compatible.
- `synchronize: false` from day one; first migration is a follow-up change.
- Refresh transport = httpOnly Secure cookie; access = `Authorization: Bearer` (per spec's `addBearerAuth`).
- Reuse detection revokes the entire family, not just the current row.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/auth/auth.controller.ts` | Replaced | New endpoints; old stub deleted. |
| `src/auth/auth.service.ts` | Replaced | bcrypt + JWT + refresh rotation. |
| `src/auth/auth.module.ts` | Modified | `JwtModule.registerAsync`, `PassportModule`, `TypeOrmModule.forFeature([UserEntity])`. |
| `src/auth/entities/user.entity.ts` | Replaced | TypeORM `@Entity` matching dbml `users`. |
| `src/auth/entities/refresh-token.entity.ts` | New | TypeORM entity for the `refresh_tokens` table. |
| `src/auth/dto/login.dto.ts` | New | `LoginDto` (email, password). |
| `src/auth/dto/refresh.dto.ts` | New | `RefreshDto` (token from cookie). |
| `src/auth/dto/auth-response.dto.ts` | New | `@ApiProperty` response shape (`accessToken`, `expiresIn`). |
| `src/auth/strategies/jwt.strategy.ts` | New | `PassportStrategy(Strategy, 'jwt')`. |
| `src/auth/guards/jwt-auth.guard.ts` | New | `AuthGuard('jwt')`. |
| `src/cli/seed-superuser.ts` | New | Standalone CLI; bcrypt 12 rounds; idempotent upsert. |
| `src/data-source.ts` | New | TypeORM data source (no migrations yet). |
| `src/app.module.ts` | Modified | `TypeOrmModule.forRootAsync` import. |
| `src/config/env.config.ts` | Modified | 5 new required Joi keys. |
| `src/main.spec.ts` | Modified | Prefix assertion switches to a test-only controller; loses the `/api/v1/auth` 201 probe. |
| `test/bootstrap.e2e-spec.ts` | Modified | Same fixup as `main.spec.ts`. |
| `openspec/specs/server_specs.md` | Modified | §3.1 gains `/auth/refresh` and `/auth/logout`; cross-references the new capability. |
| `openspec/specs/database-schema.dbml` | Modified | New `refresh_tokens` table. |
| `package.json` | Modified | New deps + `seed:superuser` script. |
| `README.md` | Modified | New endpoints + seed command. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `bcrypt` native binding fails to install in CI / deploy image. | Low | Pin Node version (`.nvmrc` already present); add a CI step that runs `node -e "require('bcrypt')"` after `npm ci`; `bcryptjs` is a documented drop-in. |
| Refresh-token reuse-detection false-positive revokes a legitimate user mid-session. | Low | Client must treat 401 on `/auth/refresh` as "log in again" (handled in the same cookie-rotation response). Spec scenario covers this. |
| `synchronize: false` leaves the schema out of sync with the entity on first run. | Med | `seed-superuser` includes a `dataSource.initialize()` call that throws on missing tables; first migration is explicitly called out in §Out of Scope. |
| `main.spec.ts` + `bootstrap.e2e-spec.ts` need to swap their probe from `/api/v1/auth` to a test-only controller; reviewer may flag the diff as "test weakened". | Med | The bootstrap tests assert the PREFIX works, not the auth controller — the swap is correct per ADR-1 of `bootstrap-api-config`. Mention this in the PR description. |
| Hardcoded seed email/password sitting in `.env` for a long-lived superuser. | Med | README warns that `SUPERUSER_PASSWORD` is a bootstrap secret; production deployments must rotate after first login (login + change-password is a follow-up change). |

## Rollback Plan

Single PR, no schema-on-prod yet (`synchronize: false` means the new `refresh_tokens` table is not created in prod on deploy). Revert the merge on `main`; no DB migration to undo. If the PR is mid-deploy, `git revert <sha>` on `domain/auth` and redeploy — the new endpoints disappear and the stub controller is restored (post-revert the bootstrap tests must be restored too; do not leave them in the test-only-controller state without the auth PR). Dev DB can be reset by dropping and recreating (no data is meaningful yet — bootstrap is the only environment that has touched it).

## Dependencies

- **Add** to `dependencies`: `@nestjs/typeorm@^11`, `@nestjs/passport@^11`, `bcrypt@^5`, `pg@^8`.
- **Add** to `devDependencies`: `@types/bcrypt@^5`, `@types/pg@^8`.
- **Reuse**: `@nestjs/jwt@^11`, `passport@^0.7`, `passport-jwt@^4`, `typeorm@^1`, `@nestjs/config@^4`, `joi@^18` — already installed.

## Success Criteria

- [ ] `npm run build` passes.
- [ ] `npm test` and `npm run test:e2e` pass (including the bootstrap-prefix assertions after the test-only-controller fixup).
- [ ] `POST /api/v1/auth/login` with seeded creds → 200 + `{ accessToken, expiresIn }` + `Set-Cookie: rt=…; HttpOnly; Secure; SameSite=Lax`.
- [ ] `POST /api/v1/auth/login` with bad creds → 401.
- [ ] `POST /api/v1/auth/refresh` with a valid cookie → 200 + new access + new cookie, old `rt` row `revoked_at` set.
- [ ] `POST /api/v1/auth/refresh` with an already-revoked cookie → 401 + every row in the family has `revoked_at` set.
- [ ] `GET /api/v1/auth/profile` with `Authorization: Bearer <access>` → 200 + user payload.
- [ ] `GET /api/v1/auth/profile` without bearer → 401.
- [ ] `npm run seed:superuser` creates the user from `SUPERUSER_EMAIL`/`SUPERUSER_PASSWORD`; running it twice does not duplicate.
- [ ] Swagger UI at `/api/v1/docs` lists `Auth` tag with the four endpoints; `/auth/profile` shows the bearer padlock.
- [ ] `server_specs.md` §3.1 + `database-schema.dbml` `refresh_tokens` + `env.config.ts` updated.

## Open Questions for Spec/Design

None blocking — the four pre-flagged questions are decided in §Approach with rationale. The spec phase should still confirm:

1. **Refresh cookie name** (`rt`) and exact `Max-Age` (`JWT_REFRESH_EXPIRES_IN`) — must be RFC 1123 or seconds-notation in env. Spec to fix the format string.
2. **Refresh cookie `SameSite`** — `Lax` (recommended) vs `Strict`. `Strict` breaks any cross-site link into the admin UI; `Lax` is the conventional choice.
3. **Logout semantics** — revoke just the presented token (simpler) vs revoke the whole family (logout-everywhere). Proposal picks "presented token only"; spec may want "family" if the user later adds device-management.
4. **Reuse-detection false-positive UX** — when a legitimate client retries with a stale cookie, the spec must spell out that the response is 401 and the user must log in again. Without this in the spec, the test in Commit 3 is ambiguous.

The spec/design phases do NOT need to re-litigate bcrypt vs bcryptjs, TypeORM migration tooling, refresh transport (cookie vs header), or family-vs-token-only revocation — those are decided.
