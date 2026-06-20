# reviews-throttling

This is a NEW cross-cutting capability. It owns the
`@nestjs/throttler` integration for the public Reviews surface
(`POST /api/v1/reviews`, `GET /api/v1/reviews`,
`POST /api/v1/reviews/:id/comments`,
`GET /api/v1/reviews/:id/comments`) and the three new Joi-validated
env vars that tune the throttler at boot time. The throttler is
registered ONCE in `src/app.module.ts` as a Nest module (NOT as a
global guard) and is applied per-route via `@Throttle()`
decorators on the public endpoints only. The three admin endpoints
(`GET /api/v1/admin/reviews`,
`PATCH /api/v1/admin/reviews/:id/approve`,
`DELETE /api/v1/admin/reviews/:id`) are unthrottled — the JWT is
the gate; per-IP throttling on a single admin IP would be a
self-denial-of-service vector.

The full semantics of the canonical 4xx/5xx envelope (which
governs the body of a 429 response) live in the
`global-exception-filter` capability spec
(`openspec/specs/global-exception-filter/spec.md`); the
`reviews-throttling` capability adds the throttler integration on
top and references the envelope rather than redefining it.

## ADDED Requirements

### Requirement: Throttler Module Registration

The system MUST register `@nestjs/throttler`'s `ThrottlerModule`
exactly once in `src/app.module.ts`, using
`ThrottlerModule.forRootAsync({ inject: [ConfigService],
useFactory: ... })`. The factory MUST read three env vars via the
typed `ConfigService<EnvConfig>` (per `api-bootstrap` Requirement:
Typed Environment Access via ConfigService) — `REVIEWS_THROTTLE_TTL_MS`
(default `60_000`, integer ≥ `1_000`, in milliseconds),
`REVIEWS_THROTTLE_WRITE_LIMIT` (default `5`, integer ≥ `1`), and
`REVIEWS_THROTTLE_READ_LIMIT` (default `60`, integer ≥ `1`) — and
MUST return an array with a single named tracker
`{ name: "default", ttl, limit: <write-limit> }`. The
`ThrottlerGuard` MUST NOT be registered as a global guard (i.e.
NOT registered as `APP_GUARD`); the throttler is per-route via
`@Throttle()` decorators only. Storage is in-memory per-IP
(`@nestjs/throttler` default).

#### Scenario: ThrottlerModule is registered in AppModule

- GIVEN the application is running
- WHEN `src/app.module.ts` is inspected
- THEN the `imports` array includes
  `ThrottlerModule.forRootAsync({ inject: [ConfigService], useFactory: ... })`
- AND the `useFactory` reads `REVIEWS_THROTTLE_TTL_MS`,
  `REVIEWS_THROTTLE_WRITE_LIMIT`, and `REVIEWS_THROTTLE_READ_LIMIT`
  via `ConfigService.get(...)`
- AND the factory returns a single tracker
  `{ name: "default", ttl, limit: <write-limit> }`

#### Scenario: ThrottlerGuard is NOT registered as APP_GUARD

- GIVEN the application is running
- WHEN `src/app.module.ts` is inspected
- THEN no `APP_GUARD` provider references `ThrottlerGuard`
- AND the throttler is applied per-route via `@Throttle()`
  decorators only

#### Scenario: Default tracker is per-IP

- GIVEN the throttler is registered
- WHEN two distinct client IPs send a request to the same
  throttled route inside the same TTL window
- THEN the throttler counts them independently
- AND either client reaching the limit does not affect the other
  client's remaining quota

### Requirement: Per-Route Throttle Limits

The system MUST apply per-route `@Throttle({ default: { limit, ttl }})`
decorators on the four public Reviews endpoints. The per-route
overrides MUST be:

| Route | Limit | TTL |
| --- | --- | --- |
| `POST /api/v1/reviews` | `REVIEWS_THROTTLE_WRITE_LIMIT` (default `5`) | `REVIEWS_THROTTLE_TTL_MS` (default `60_000`) |
| `POST /api/v1/reviews/:id/comments` | `REVIEWS_THROTTLE_WRITE_LIMIT` (default `5`) | `REVIEWS_THROTTLE_TTL_MS` (default `60_000`) |
| `GET /api/v1/reviews` | `REVIEWS_THROTTLE_READ_LIMIT` (default `60`) | `REVIEWS_THROTTLE_TTL_MS` (default `60_000`) |
| `GET /api/v1/reviews/:id/comments` | `REVIEWS_THROTTLE_READ_LIMIT` (default `60`) | `REVIEWS_THROTTLE_TTL_MS` (default `60_000`) |

The three admin endpoints (`GET /api/v1/admin/reviews`,
`PATCH /api/v1/admin/reviews/:id/approve`,
`DELETE /api/v1/admin/reviews/:id`) MUST NOT carry any
`@Throttle()` decorator.

#### Scenario: Write routes use the write limit

- GIVEN `REVIEWS_THROTTLE_WRITE_LIMIT` is `5` and
  `REVIEWS_THROTTLE_TTL_MS` is `60_000`
- WHEN a client sends 5 `POST /api/v1/reviews` requests from the
  same IP inside the window
- THEN the 6th request returns `429 Too Many Requests`

#### Scenario: Comment write route uses the write limit

- GIVEN `REVIEWS_THROTTLE_WRITE_LIMIT` is `5` and
  `REVIEWS_THROTTLE_TTL_MS` is `60_000`
- WHEN a client sends 5 `POST /api/v1/reviews/R/comments`
  requests from the same IP inside the window
- THEN the 6th request returns `429 Too Many Requests`

#### Scenario: Read routes use the read limit

- GIVEN `REVIEWS_THROTTLE_READ_LIMIT` is `60` and
  `REVIEWS_THROTTLE_TTL_MS` is `60_000`
- WHEN a client sends 60 `GET /api/v1/reviews` requests from
  the same IP inside the window
- THEN the 61st request returns `429 Too Many Requests`

#### Scenario: Admin routes are NOT throttled

- GIVEN a valid bearer is presented
- WHEN a client sends 100 `GET /api/v1/admin/reviews` requests
  from the same IP inside a 60-second window
- THEN all 100 requests return `200 OK` (or `401` if the bearer
  expires; never `429`)

### Requirement: Throttle Response Shape

When a public endpoint exceeds its per-route throttle limit, the
throttler MUST throw `ThrottlerException`, which the global
`AllExceptionsFilter` (per the `global-exception-filter` capability
spec at `openspec/specs/global-exception-filter/spec.md`
Requirement: HttpException Renders the Canonical 4xx Envelope)
MUST render as `429 Too Many Requests` with the canonical envelope
`{ statusCode: 429, error: "Too Many Requests", message: <...>,
timestamp, path }`. The response MUST also carry a `Retry-After`
header (in seconds) so clients can back off correctly.

#### Scenario: 429 renders through the global filter

- GIVEN a client has exhausted the write limit on
  `POST /api/v1/reviews`
- WHEN the client sends the (limit+1)-th request
- THEN the response status is `429`
- AND the body shape is the canonical envelope
  (`{ statusCode, error, message, timestamp, path }`)
- AND the response Content-Type is `application/json`
- AND the body contains no stack trace and no extra fields

#### Scenario: 429 carries a Retry-After header

- GIVEN a client has exhausted the write limit on
  `POST /api/v1/reviews`
- WHEN the throttled response is rendered
- THEN the response carries a `Retry-After` header
- AND the value is a positive integer of seconds (≤ the configured
  TTL)

#### Scenario: Non-throttled routes never return 429

- GIVEN the throttler is registered
- WHEN a client sends many requests to a non-throttled route
  (e.g. `GET /api/v1/auth/profile` or any admin route)
- THEN the response is NEVER `429`
- AND the throttler is bypassed

### Requirement: Trust Proxy For req.ip

The application MUST set `app.set('trust proxy', 1)` (or an
equivalent trust-proxy configuration) in `src/main.ts` at boot
so that `req.ip` (consumed by `@nestjs/throttler` to bucket the
per-IP tracker) reflects the real client IP behind a reverse
proxy. Without this, every visitor behind the same proxy shares
one IP and a single visitor's 6th request 429s the entire fleet.
The value `1` means "trust the nearest hop" — the documented
Nest/Express choice for a single reverse-proxy deployment.

#### Scenario: Trust proxy is set in main.ts

- GIVEN the application is running behind a reverse proxy
- WHEN `src/main.ts` is inspected
- THEN `app.set('trust proxy', 1)` is called BEFORE the
  application listens
- AND the value is exactly `1` (single hop)

#### Scenario: Throttler sees the real client IP behind a proxy

- GIVEN `app.set('trust proxy', 1)` is configured
- AND a request carries `X-Forwarded-For: 203.0.113.42`
- WHEN the throttler reads `req.ip`
- THEN `req.ip` equals `203.0.113.42` (the real client IP, not
  the proxy IP)
- AND the throttler buckets the request under the real client IP

### Requirement: Configurable Limits via Joi

The system MUST add three new keys to the `ENV_CONFIG` Joi schema
in `src/config/env.config.ts`:
`REVIEWS_THROTTLE_TTL_MS` (default `60_000`, integer ≥ `1_000`,
in milliseconds — the lower bound prevents accidentally setting
a zero-millisecond window),
`REVIEWS_THROTTLE_WRITE_LIMIT` (default `5`, integer ≥ `1`), and
`REVIEWS_THROTTLE_READ_LIMIT` (default `60`, integer ≥ `1`). The
defaults MUST be applied by Joi when the env var is absent, so
the application boots in dev with sensible throttler values
without requiring the operator to set them. The three env vars
MUST be read via the typed `ConfigService` (per `api-bootstrap`
Requirement: Typed Environment Access via ConfigService) — NEVER
via `process.env.*` directly.

#### Scenario: Defaults are applied when env vars are absent

- GIVEN the process environment does not set any
  `REVIEWS_THROTTLE_*` variable
- WHEN the application bootstraps
- THEN `ConfigService.get('REVIEWS_THROTTLE_TTL_MS', { infer: true })`
  returns `60_000`
- AND `ConfigService.get('REVIEWS_THROTTLE_WRITE_LIMIT', { infer: true })`
  returns `5`
- AND `ConfigService.get('REVIEWS_THROTTLE_READ_LIMIT', { infer: true })`
  returns `60`

#### Scenario: Missing required env var prevents boot

- GIVEN the `ENV_CONFIG` Joi schema requires the three
  `REVIEWS_THROTTLE_*` keys (with defaults)
- WHEN an env var is set to a non-integer (e.g.
  `REVIEWS_THROTTLE_TTL_MS=fast`)
- THEN the application throws a configuration error referencing
  the `ENV_CONFIG` Joi schema
- AND the HTTP listener is never started

#### Scenario: Limit below the Joi floor is rejected

- GIVEN the `ENV_CONFIG` Joi schema enforces
  `REVIEWS_THROTTLE_WRITE_LIMIT` ≥ `1`
- WHEN `REVIEWS_THROTTLE_WRITE_LIMIT=0` is set
- THEN the application throws a configuration error referencing
  the `REVIEWS_THROTTLE_WRITE_LIMIT` Joi rule
- AND the HTTP listener is never started

#### Scenario: TTL below the Joi floor is rejected

- GIVEN the `ENV_CONFIG` Joi schema enforces
  `REVIEWS_THROTTLE_TTL_MS` ≥ `1_000`
- WHEN `REVIEWS_THROTTLE_TTL_MS=500` is set
- THEN the application throws a configuration error referencing
  the `REVIEWS_THROTTLE_TTL_MS` Joi rule
- AND the HTTP listener is never started

#### Scenario: Operator can disable throttling by raising the limit

- GIVEN the operator sets
  `REVIEWS_THROTTLE_WRITE_LIMIT=1000000` and
  `REVIEWS_THROTTLE_READ_LIMIT=1000000` in the environment
- WHEN the application bootstraps
- THEN the throttler's per-route limit is `1_000_000`
- AND the application does not return `429` for any realistic
  traffic volume (the documented "disable" knob)

## MODIFIED Requirements

_None. No existing requirements in `openspec/specs/api-bootstrap/spec.md`
or `openspec/specs/auth-domain/spec.md` are modified by this
change. The throttler is additive — the global prefix, the
`ValidationPipe`, CORS, and the method-level `JwtAuthGuard`
contract are unaffected. The three new env vars are added to the
existing `ENV_CONFIG` Joi schema, which is the only required
wiring._

## REMOVED Requirements

_None._
