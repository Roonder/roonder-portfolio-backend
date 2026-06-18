# Delta for `auth-domain`

This is a NEW cross-cutting capability. It owns the `User` entity, the
`refresh_tokens` table, the `POST /api/v1/auth/{login,refresh,logout}` and
`GET /api/v1/auth/profile` endpoints, the `JwtAuthGuard`, and the
`npm run seed:superuser` CLI. Full semantics — including the
`/api/v1` global prefix, CORS with `credentials: true`, and Swagger bearer
auth — live in the `api-bootstrap` capability
(`openspec/specs/api-bootstrap/spec.md`); the schema for the `users` table
is in `openspec/specs/database-schema.dbml`, and the `refresh_tokens` table
added by this change is documented in `openspec/changes/auth-domain/specs/database-schema/spec.md`.

## ADDED Requirements

### Requirement: User Entity

The system MUST persist users in the `users` table defined in
`openspec/specs/database-schema.dbml`. The TypeORM `UserEntity` MUST expose
`id` (uuid), `email` (unique, varchar), `password` (varchar, bcrypt 12-round
hash), `createdAt` (timestamp), and `updatedAt` (timestamp), and MUST hash
the `password` via `bcrypt.hash(plain, 12)` BEFORE inserting or updating
the row. Plaintext passwords MUST NEVER be persisted.

#### Scenario: Entity columns match the database schema

- GIVEN the `UserEntity` is loaded
- WHEN the TypeORM metadata is inspected
- THEN the entity declares `id`, `email`, `password`, `createdAt`, `updatedAt`
- AND `email` is marked `unique: true`
- AND `password` is marked `select: false` so it never leaks in default selects

#### Scenario: Password is hashed before insert

- GIVEN a `UserEntity` instance with `password = 'plain-text'`
- WHEN the row is inserted via the repository
- THEN the row stored in the database has `password` starting with the bcrypt prefix `$2`
- AND `bcrypt.compare('plain-text', row.password)` returns `true`
- AND `row.password !== 'plain-text'`

#### Scenario: Password is re-hashed on update

- GIVEN an existing user with `email = 'admin@x.io'` already stored
- WHEN the user is updated through the repository with a new plaintext password
- THEN the stored `password` column reflects the new bcrypt hash
- AND the previous hash is no longer present in the row

### Requirement: Login Endpoint

The system MUST expose `POST /api/v1/auth/login` (public). The body MUST be
validated by the global `ValidationPipe` (see `api-bootstrap` §Global
Validation Pipe) against a DTO that declares `email` (`@IsEmail`) and
`password` (`@IsString` `@MinLength(8)`). On success the response MUST be
`200 OK` with body `{ accessToken, expiresIn }` (seconds) and a
`Set-Cookie: rt=<token>; HttpOnly; Secure; SameSite=Lax; Path=/;
Max-Age=<seconds>` header. The access token MUST be signed with
`JWT_SECRET` and expire after `JWT_EXPIRES_IN`. The refresh token MUST be
signed with `JWT_REFRESH_SECRET` and stored as the sha-256 hash of the
plaintext in a new `refresh_tokens` row with a fresh `family_id` (uuid)
and `expires_at = now() + JWT_REFRESH_EXPIRES_IN`.

#### Scenario: Valid credentials return access token and refresh cookie

- GIVEN a user exists with `email = 'admin@x.io'` and a bcrypt-hashed password
- WHEN a client sends `POST /api/v1/auth/login` with
  `{ "email": "admin@x.io", "password": "correct-password" }`
- THEN the response is `200 OK`
- AND the body contains `accessToken` (JWT) and `expiresIn` (positive integer seconds)
- AND the response carries `Set-Cookie: rt=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<n>`
- AND a new row exists in `refresh_tokens` with the matching `family_id`,
  `hashed_token = sha256(rt)`, `revoked_at IS NULL`, `replaced_by IS NULL`

#### Scenario: Unknown email returns 401

- GIVEN no user exists with the submitted email
- WHEN a client sends `POST /api/v1/auth/login` with that email and any password
- THEN the response is `401 Unauthorized`
- AND no `Set-Cookie` header is sent
- AND no row is inserted in `refresh_tokens`

#### Scenario: Wrong password returns 401

- GIVEN a user exists with `email = 'admin@x.io'` and password `'correct'`
- WHEN a client sends `POST /api/v1/auth/login` with
  `{ "email": "admin@x.io", "password": "wrong" }`
- THEN the response is `401 Unauthorized`
- AND `bcrypt.compare('wrong', stored.hash)` is the only password check performed (no timing oracle)

#### Scenario: Malformed body returns 400

- GIVEN the global `ValidationPipe` is configured with `whitelist: true`
  and `forbidNonWhitelisted: true`
- WHEN a client sends `POST /api/v1/auth/login` with body
  `{ "email": "not-an-email", "password": "short" }`
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked

### Requirement: Refresh Token Rotation

The system MUST expose `POST /api/v1/auth/refresh` (public, reads the `rt`
cookie). On success the system MUST issue a new access token AND a new
refresh token, set `Set-Cookie: rt=<new>; ...` overwriting the old cookie,
mark the presented refresh row with `revoked_at = now()`, and insert a new
row in the SAME `family_id` with `replaced_by` pointing to the new row's id.
The new cookie MUST travel with the same `HttpOnly`, `Secure`,
`SameSite=Lax`, `Path=/` attributes and the same `Max-Age` derived from
`JWT_REFRESH_EXPIRES_IN`.

#### Scenario: Valid refresh cookie rotates the family

- GIVEN a user has a `refresh_tokens` row with `family_id = F`, `revoked_at IS NULL`
- WHEN a client sends `POST /api/v1/auth/refresh` with `Cookie: rt=<matching token>`
- THEN the response is `200 OK`
- AND the body contains a new `accessToken` and `expiresIn`
- AND `Set-Cookie: rt=<new token>; ...` replaces the old cookie
- AND the old row has `revoked_at = now()` and `replaced_by = <new row id>`
- AND a new row exists with the SAME `family_id = F` and `replaced_by IS NULL`

#### Scenario: Missing refresh cookie returns 401

- GIVEN the client sends no `Cookie` header
- WHEN a client sends `POST /api/v1/auth/refresh`
- THEN the response is `401 Unauthorized`
- AND no row in `refresh_tokens` is mutated

#### Scenario: Expired refresh cookie returns 401

- GIVEN a `refresh_tokens` row has `expires_at < now()`
- WHEN a client sends `POST /api/v1/auth/refresh` with the matching `rt` cookie
- THEN the response is `401 Unauthorized`
- AND `Set-Cookie: rt=; Max-Age=0` clears the cookie
- AND the row is left unchanged

### Requirement: Refresh Token Reuse Detection

The system MUST treat the presentation of an already-revoked refresh token
as a theft signal. On detecting a revoked row being replayed, the system
MUST set `revoked_at = now()` on EVERY row that shares the same
`family_id` (full-family revocation), respond `401 Unauthorized`, and clear
the `rt` cookie with `Max-Age=0`.

#### Scenario: Replaying a revoked cookie revokes the whole family

- GIVEN family `F` has rows `r1` (revoked, replaced by `r2`), `r2` (revoked, replaced by `r3`), `r3` (active)
- WHEN a client sends `POST /api/v1/auth/refresh` with the `rt` corresponding to `r1`
- THEN the response is `401 Unauthorized`
- AND `Set-Cookie: rt=; Max-Age=0` clears the cookie
- AND `r3.revoked_at IS NOT NULL` (full family revoked)
- AND no new row is inserted

#### Scenario: Stale-cookie retry is treated as re-login

- GIVEN the user's refresh cookie has been rotated server-side (e.g., by another tab)
- WHEN a legitimate client retries `POST /api/v1/auth/refresh` with the now-stale cookie
- THEN the response is `401 Unauthorized`
- AND the family is revoked as a side-effect
- AND the client MUST treat the 401 as "log in again" (this requirement makes the client-side UX explicit so the test is unambiguous)

### Requirement: Refresh Token Storage

The `refresh_tokens` table MUST be defined as documented in
`openspec/changes/auth-domain/specs/database-schema/spec.md` (ADDED
Requirement: Refresh Tokens Storage). It MUST persist `id` (uuid), `user_id`
(FK → `users.id`), `family_id` (uuid, indexed), `hashed_token`
(sha-256 hex, unique), `expires_at` (timestamp), `revoked_at` (timestamp,
nullable), `replaced_by` (FK → `refresh_tokens.id`, nullable), and
`created_at` (timestamp).

#### Scenario: Login inserts a fresh refresh row

- GIVEN the user has no `refresh_tokens` row
- WHEN `POST /api/v1/auth/login` succeeds
- THEN exactly one row is inserted with `revoked_at IS NULL`, `replaced_by IS NULL`, and a fresh `family_id`

#### Scenario: Rotation chains the row through `replaced_by`

- GIVEN a successful refresh from row `r_old`
- WHEN the refresh handler completes
- THEN `r_old.revoked_at IS NOT NULL` AND `r_old.replaced_by = r_new.id`
- AND `r_new.family_id = r_old.family_id`

### Requirement: Refresh Cookie Transport

The refresh token MUST travel in a cookie named `rt` with attributes
`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and `Max-Age=<seconds>`
where `<seconds>` is derived from `JWT_REFRESH_EXPIRES_IN`. The access
token MUST travel in the `Authorization: Bearer <token>` header.

#### Scenario: Cookie attributes are set on every login/refresh response

- GIVEN login or refresh succeeds
- WHEN the `Set-Cookie` header is inspected
- THEN its name is `rt`
- AND it includes `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
- AND `Max-Age` is a positive integer of seconds

#### Scenario: `SameSite=Lax` is the documented choice (spec question #2)

- GIVEN the refresh cookie attributes are documented in code comments and README
- WHEN a reader inspects them
- THEN `SameSite=Lax` (NOT `Strict`) is the chosen value
- AND the rationale is recorded: `Lax` permits top-level navigation from external links into the admin UI while still blocking CSRF on cross-site POSTs; `Strict` would break that UX flow.

#### Scenario: `Max-Age` format is seconds-notation (spec question #1)

- GIVEN `JWT_REFRESH_EXPIRES_IN` is read from the environment
- WHEN the cookie is set
- THEN `JWT_REFRESH_EXPIRES_IN` is validated by Joi as a positive integer string (e.g. `"2592000"` for 30 days)
- AND the cookie `Max-Age` is exactly that integer (RFC 7231 delta-seconds, NOT an RFC 1123 date)
- AND `@nestjs/jwt`'s duration parsing is NOT used for the cookie value

### Requirement: Logout Endpoint

The system MUST expose `POST /api/v1/auth/logout` (public, reads the `rt`
cookie). On success the system MUST set `revoked_at = now()` on the row
whose `hashed_token` matches the presented cookie, clear the cookie with
`Set-Cookie: rt=; Max-Age=0`, and respond `200 OK` with an empty body. The
system MUST revoke ONLY the presented row, NOT the entire `family_id`
(spec question #3 — logout semantics = presented token only).

#### Scenario: Valid cookie revokes the presented row only

- GIVEN family `F` has rows `r1` (revoked) and `r2` (active)
- WHEN a client sends `POST /api/v1/auth/logout` with `Cookie: rt=<r2 plaintext>`
- THEN the response is `200 OK`
- AND `Set-Cookie: rt=; Max-Age=0` clears the cookie
- AND `r2.revoked_at IS NOT NULL`
- AND `r1.revoked_at` is unchanged (other-family rows untouched)

#### Scenario: Logout semantics = presented token only (spec question #3)

- GIVEN family `F` has rows `r1`, `r2`, `r3` (all currently active)
- WHEN a client logs out using the cookie bound to `r2`
- THEN `r2.revoked_at IS NOT NULL`
- AND `r1.revoked_at` and `r3.revoked_at` remain `NULL`
- AND the rationale is recorded: keeps logout cheap and predictable; future device-management (login-everywhere) will switch this to family-level revocation and is documented as a follow-up change.

#### Scenario: Missing cookie returns 401

- GIVEN the client sends no `Cookie` header
- WHEN a client sends `POST /api/v1/auth/logout`
- THEN the response is `401 Unauthorized`
- AND no row in `refresh_tokens` is mutated

### Requirement: Profile Endpoint

The system MUST expose `GET /api/v1/auth/profile` (Protected, requires a
valid access token in `Authorization: Bearer ...`). On success the
response MUST be `200 OK` with body `{ id, email }`. The endpoint MUST be
marked with `@ApiBearerAuth()` so Swagger shows the bearer padlock.

#### Scenario: Valid bearer returns the user payload

- GIVEN an access token signed with `JWT_SECRET` whose `sub` matches the user's `id`
- WHEN a client sends `GET /api/v1/auth/profile` with `Authorization: Bearer <access>`
- THEN the response is `200 OK`
- AND the body contains `id` (uuid) and `email` (string)

#### Scenario: Missing bearer returns 401

- GIVEN no `Authorization` header is sent
- WHEN a client sends `GET /api/v1/auth/profile`
- THEN the response is `401 Unauthorized`
- AND the controller method is not invoked

#### Scenario: Expired bearer returns 401

- GIVEN an access token whose `exp` is in the past
- WHEN a client sends `GET /api/v1/auth/profile` with `Authorization: Bearer <expired>`
- THEN the response is `401 Unauthorized`

#### Scenario: Invalid signature returns 401

- GIVEN an access token whose signature does not verify against `JWT_SECRET`
- WHEN a client sends `GET /api/v1/auth/profile` with `Authorization: Bearer <bad>`
- THEN the response is `401 Unauthorized`

### Requirement: JwtAuthGuard

The system MUST provide a `JwtAuthGuard` (`@nestjs/passport`
`AuthGuard('jwt')`) backed by a `JwtStrategy` (`passport-jwt`) that reads
the `Authorization: Bearer <token>` header, validates the signature with
`JWT_SECRET`, checks `exp`, and hydrates `req.user = { id, email }`. The
guard MUST be applied method-level with `@UseGuards(JwtAuthGuard)` on
`/auth/profile` (the only protected endpoint in this change) and MUST
NOT be registered as a global guard (future public endpoints like
`GET /projects` must not opt out).

> **Implementation note**: "method-level" (not class-level) is the
> only working placement given this design. The `login`, `refresh`,
> and `logout` methods stay public by NOT carrying `@UseGuards`; a
> class-level guard would reject all of them with 401. A
> `@Public()` opt-out decorator was explicitly rejected in design
> ADR-6 (c) as feature creep for a single protected endpoint.

#### Scenario: Guard rejects requests without a bearer

- GIVEN the `JwtAuthGuard` is applied to `/auth/profile`
- WHEN a client sends `GET /api/v1/auth/profile` with no `Authorization` header
- THEN the response is `401 Unauthorized`
- AND the controller method is not invoked

#### Scenario: Guard hydrates `req.user` from the JWT payload

- GIVEN a valid access token with `sub = <user-id>` and `email = <user-email>`
- WHEN the guard authenticates the request
- THEN `req.user` equals `{ id: <user-id>, email: <user-email> }`

#### Scenario: Guard is method-level, not global

- GIVEN `JwtAuthGuard` is registered
- WHEN `AppModule` is inspected
- THEN no `APP_GUARD` provider references `JwtAuthGuard`
- AND only `AuthController.profile` carries `@UseGuards(JwtAuthGuard)`
- AND `AuthController.login`, `AuthController.refresh`, and
  `AuthController.logout` do NOT carry `@UseGuards`

### Requirement: Seed Superuser CLI

The system MUST ship a standalone CLI reachable as
`npm run seed:superuser` that upserts a single user from the
`SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` environment variables using
`bcrypt.hash(password, 12)`. The CLI MUST be idempotent: a second run
with the same `SUPERUSER_EMAIL` MUST update the existing row (and
re-hash the password), not duplicate it. Missing `SUPERUSER_EMAIL` or
`SUPERUSER_PASSWORD` MUST cause the CLI to exit non-zero with a clear
message before any DB write.

#### Scenario: Missing SUPERUSER_EMAIL exits non-zero before any DB write

- GIVEN `SUPERUSER_EMAIL` is not set
- WHEN `npm run seed:superuser` is invoked
- THEN the process exits with a non-zero status
- AND the error message names `SUPERUSER_EMAIL`
- AND no row is inserted into `users`

#### Scenario: Missing SUPERUSER_PASSWORD exits non-zero before any DB write

- GIVEN `SUPERUSER_EMAIL` is set but `SUPERUSER_PASSWORD` is not
- WHEN `npm run seed:superuser` is invoked
- THEN the process exits with a non-zero status
- AND the error message names `SUPERUSER_PASSWORD`
- AND no row is inserted or updated

#### Scenario: First run creates the user

- GIVEN no row exists in `users` for `SUPERUSER_EMAIL`
- WHEN `npm run seed:superuser` is invoked with valid env values
- THEN a row is inserted with `email = SUPERUSER_EMAIL`
- AND `password` starts with the bcrypt prefix `$2`
- AND `bcrypt.compare(SUPERUSER_PASSWORD, row.password) === true`

#### Scenario: Re-run updates the existing user (idempotent upsert)

- GIVEN a row already exists in `users` for `SUPERUSER_EMAIL`
- WHEN `npm run seed:superuser` is invoked again with the same env values
- THEN the existing row's `password` is replaced with a new bcrypt hash of `SUPERUSER_PASSWORD`
- AND no second row is inserted
- AND the row count for `SUPERUSER_EMAIL` remains exactly 1

## Open Questions Resolved by This Spec

The four spec-phase non-blocking questions are answered here so design and
apply do not need to re-litigate them:

| # | Question | Chosen answer | Rationale |
|---|----------|---------------|-----------|
| 1 | `Max-Age` format in env | Seconds-notation integer string (e.g. `"2592000"`) | Direct mapping to RFC 7231 delta-seconds; Joi validates as integer; no extra parser for the cookie; `@nestjs/jwt`'s duration parser is reserved for `JWT_EXPIRES_IN` on the token itself. |
| 2 | Refresh cookie `SameSite` | `Lax` | Allows top-level navigation from external links into the admin UI (e.g. "Manage your portfolio" in an email) while still blocking CSRF on cross-site POSTs. `Strict` would break that UX. |
| 3 | Logout semantics | Revoke the presented token only | Matches the proposal; keeps logout cheap and predictable; future device-management will switch to family-level revocation and is explicitly documented as a follow-up change. |
| 4 | Reuse-detection false-positive UX | 401 + clear cookie + client treats as re-login | Spec scenario "Stale-cookie retry is treated as re-login" pins this down so the test in Commit 3 is unambiguous and the client-side expectation is explicit. |