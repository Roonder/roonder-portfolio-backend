# Delta for `server_specs`

Source spec: `openspec/specs/server_specs.md`. The Auth domain routes in
§3.1 gain `/auth/refresh` and `/auth/logout`; the CORS line in §2 keeps
its current text but gets a forward-pointer to the `auth-domain`
capability spec. Five new requirements are added under §2 covering the
JWT and superuser environment variables. The `users` table is unchanged
(its full schema lives in `openspec/specs/database-schema.dbml`); the
`refresh_tokens` table is added as an ADDED requirement documented in
`openspec/changes/auth-domain/specs/database-schema/spec.md`.

## MODIFIED Requirements

### Requirement: Auth Domain Routes (§3.1)

The Auth domain exposes the following routes, all under the global
`/api/v1` prefix:

- `POST /api/v1/auth/login`: Authenticates the admin user and returns an
  access_token. Public.
- `POST /api/v1/auth/refresh`: Rotates the refresh cookie and returns a
  new access token. Public. Performs family-level reuse detection (any
  reuse of an already-revoked refresh token revokes the entire family).
- `POST /api/v1/auth/logout`: Revokes the presented refresh token and
  clears the `rt` cookie. Public.
- `GET /api/v1/auth/profile`: Returns the authenticated admin profile
  data `{ id, email }`. Protected by `JwtAuthGuard`.

Full request/response semantics, cookie attributes, storage, and reuse
behavior are defined in the `auth-domain` capability spec at
`openspec/changes/auth-domain/specs/auth-domain/spec.md` (and, after
archive, `openspec/specs/auth-domain/spec.md`).

(Previously: `POST /api/v1/auth/login` (public) and
`GET /api/v1/auth/profile` (Protected). No `/refresh` or `/logout`.)

#### Scenario: Login route is reachable under the prefix

- GIVEN the application is running with valid credentials configured
- WHEN a client sends `POST /api/v1/auth/login` with valid credentials
- THEN the response is `200 OK` and the body contains an `access_token`

#### Scenario: Refresh route is reachable under the prefix

- GIVEN the application is running and a valid `rt` cookie is set
- WHEN a client sends `POST /api/v1/auth/refresh` with that cookie
- THEN the response is `200 OK` and the body contains a new
  `access_token`

#### Scenario: Logout route is reachable under the prefix

- GIVEN the application is running and a valid `rt` cookie is set
- WHEN a client sends `POST /api/v1/auth/logout` with that cookie
- THEN the response is `200 OK` and the `rt` cookie is cleared

#### Scenario: Profile route is protected

- GIVEN the application is running
- WHEN a client sends `GET /api/v1/auth/profile` without an
  `Authorization: Bearer ...` header
- THEN the response is `401 Unauthorized`

## ADDED Requirements

### Requirement: Access Token Expiration (`JWT_EXPIRES_IN`)

The `EnvConfig` interface and `ENV_CONFIG` Joi schema MUST require
`JWT_EXPIRES_IN` as a non-empty string accepted by `@nestjs/jwt`
duration parsing (e.g. `"15m"`, `"1h"`). This value MUST be passed to
`JwtModule.registerAsync` as `signOptions.expiresIn` for the access
token.

#### Scenario: Server refuses to boot without `JWT_EXPIRES_IN`

- GIVEN `JWT_EXPIRES_IN` is not present in the process environment
- WHEN the application bootstraps
- THEN the application throws a configuration error referencing
  `ENV_CONFIG.JWT_EXPIRES_IN`
- AND the HTTP listener is never started

#### Scenario: Issued access tokens honor `JWT_EXPIRES_IN`

- GIVEN `JWT_EXPIRES_IN="15m"`
- WHEN a client receives an access token from `/auth/login`
- THEN the token's `exp` claim is `now + 15 minutes` (within ±1s)

### Requirement: Refresh Token Secret (`JWT_REFRESH_SECRET`)

The `EnvConfig` interface and `ENV_CONFIG` Joi schema MUST require
`JWT_REFRESH_SECRET` as a non-empty string of at least 32 characters.
This value MUST be used as the signing secret for refresh tokens and MUST
be distinct from `JWT_SECRET` (cross-use is forbidden — compromise of one
must not compromise the other).

#### Scenario: Server refuses to boot without `JWT_REFRESH_SECRET`

- GIVEN `JWT_REFRESH_SECRET` is not present in the process environment
- WHEN the application bootstraps
- THEN the application throws a configuration error referencing
  `ENV_CONFIG.JWT_REFRESH_SECRET`

#### Scenario: Short or identical refresh secret is rejected

- GIVEN `JWT_REFRESH_SECRET` is shorter than 32 characters OR equal to `JWT_SECRET`
- WHEN the application bootstraps
- THEN the application throws a configuration error

#### Scenario: Refresh tokens verify against `JWT_REFRESH_SECRET`

- GIVEN a refresh token issued at login
- WHEN the token is verified during `/auth/refresh`
- THEN verification uses `JWT_REFRESH_SECRET` (NOT `JWT_SECRET`)

### Requirement: Refresh Token Expiration (`JWT_REFRESH_EXPIRES_IN`)

The `EnvConfig` interface and `ENV_CONFIG` Joi schema MUST require
`JWT_REFRESH_EXPIRES_IN` as a positive integer string of seconds (e.g.
`"2592000"` for 30 days). This value MUST drive BOTH the refresh token
`exp` claim AND the `Set-Cookie: rt=...; Max-Age=<seconds>` attribute
(direct mapping, no parsing).

#### Scenario: Server refuses to boot without `JWT_REFRESH_EXPIRES_IN`

- GIVEN `JWT_REFRESH_EXPIRES_IN` is not present in the process environment
- WHEN the application bootstraps
- THEN the application throws a configuration error referencing
  `ENV_CONFIG.JWT_REFRESH_EXPIRES_IN`

#### Scenario: Non-integer or non-positive value is rejected

- GIVEN `JWT_REFRESH_EXPIRES_IN` is `"7d"`, `"-1"`, or `"0"`
- WHEN the application bootstraps
- THEN the application throws a configuration error

#### Scenario: Cookie `Max-Age` equals `JWT_REFRESH_EXPIRES_IN` in seconds

- GIVEN `JWT_REFRESH_EXPIRES_IN="2592000"`
- WHEN the response from `/auth/login` or `/auth/refresh` is inspected
- THEN the `Set-Cookie: rt=...` header carries `Max-Age=2592000`

### Requirement: Bootstrap Superuser Email (`SUPERUSER_EMAIL`)

The `EnvConfig` interface and `ENV_CONFIG` Joi schema MUST require
`SUPERUSER_EMAIL` as a valid email address. The `npm run seed:superuser`
CLI MUST read this value and use it as the upsert key for the seeded
user.

#### Scenario: Server refuses to boot without `SUPERUSER_EMAIL`

- GIVEN `SUPERUSER_EMAIL` is not present in the process environment
- WHEN the application bootstraps
- THEN the application throws a configuration error referencing
  `ENV_CONFIG.SUPERUSER_EMAIL`

#### Scenario: Malformed `SUPERUSER_EMAIL` is rejected

- GIVEN `SUPERUSER_EMAIL="not-an-email"`
- WHEN the application bootstraps
- THEN the application throws a configuration error

#### Scenario: Seed CLI uses `SUPERUSER_EMAIL` as the upsert key

- GIVEN the CLI is invoked with valid env values
- WHEN the seeded user is inserted or updated
- THEN the row's `email` column equals `SUPERUSER_EMAIL`

### Requirement: Bootstrap Superuser Password (`SUPERUSER_PASSWORD`)

The `EnvConfig` interface and `ENV_CONFIG` Joi schema MUST require
`SUPERUSER_PASSWORD` as a non-empty string of at least 8 characters.
The `npm run seed:superuser` CLI MUST bcrypt-hash this value (12 rounds)
before persisting; the plaintext MUST NEVER be logged or persisted.

#### Scenario: Server refuses to boot without `SUPERUSER_PASSWORD`

- GIVEN `SUPERUSER_PASSWORD` is not present in the process environment
- WHEN the application bootstraps
- THEN the application throws a configuration error referencing
  `ENV_CONFIG.SUPERUSER_PASSWORD`

#### Scenario: Short `SUPERUSER_PASSWORD` is rejected

- GIVEN `SUPERUSER_PASSWORD="short"` (less than 8 characters)
- WHEN the application bootstraps
- THEN the application throws a configuration error

#### Scenario: Plaintext password is never persisted

- GIVEN the seed CLI completes successfully
- WHEN the seeded row in `users` is inspected
- THEN `password` starts with the bcrypt prefix `$2`
- AND `bcrypt.compare(SUPERUSER_PASSWORD, row.password) === true`
- AND `row.password !== SUPERUSER_PASSWORD`

## REMOVED Requirements

_None. No existing requirements in `server_specs.md` are removed by this
change._

## RENAMED Requirements

_None._