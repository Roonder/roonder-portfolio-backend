# Delta for Cross-Cutting Concerns

## Purpose

This delta encodes the cross-cutting requirements that the
`domain-contact` change introduces or modifies: the canonical response
envelope contract (which every `POST /api/v1/contacts` response MUST
conform to, including success and 429 throttling cases), the
Joi-validated env-var additions, the new `@nestjs/event-emitter`
runtime dependency, the `RESEND_FROM_ADDRESS` / `RESEND_TO_ADDRESS`
addressing strategy, the `.env.example` (to be CREATED) carry-over,
and the new throttler knobs. These requirements cut across the
contact domain and are enforced at the application boot or HTTP-edge
layer, not inside the contact module.

## Source sections

Quoted from `openspec/specs/server_specs.md` §4 (lines 84–87, the
canonical env-var contract):

> ## 4. Environment Variable Management (Joi Validation)
>
> Joi will be used in ConfigModule.forRoot() to guarantee that the server does not boot if critical credentials are missing.
> Required variables: `PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN, SUPERUSER_EMAIL, SUPERUSER_PASSWORD, RESEND_API_KEY, FRONTEND_URL`.

The canonical response envelope is encoded by
`src/common/filters/all-exceptions.filter.ts` (top of file, lines
34–47):

> ```
> { statusCode, error, message, timestamp, path }
> ```
>
> - HttpException → 4xx envelope using the exception's status +
>   `getResponse()` payload (or a `STATUS_LABELS` fallback).
> - Raw `Error` (e.g. a thrown `TypeError` in a service) → 5xx
>   envelope sanitized in production, full message in dev (Task 1.7).

## Purpose of the change

The `domain-contact` change introduces five new env vars
(`RESEND_FROM_ADDRESS`, `RESEND_TO_ADDRESS`, `CONTACT_THROTTLE_TTL_MS`,
`CONTACT_THROTTLE_WRITE_LIMIT`, `CONTACT_THROTTLE_READ_LIMIT`), one new
runtime dependency (`@nestjs/event-emitter`), and one new file at
the repo root (`.env.example`, which does not exist today and is
explicitly CREATED by this change per the user-approved deviation
recorded 2026-06-23). The contact endpoints MUST conform to the
canonical response envelope — both the 5-key error envelope and the
2xx success shape — and the per-IP throttler MUST integrate with
the existing `@nestjs/throttler` infrastructure (registered in
`AppModule` per ADR-2 of the reviews change; not a global
`APP_GUARD`).

## ADDED Requirements

### Requirement: Response envelope on every contact response

Every HTTP response from a contact-domain route
(`POST /api/v1/contacts`, `GET /api/v1/admin/contacts`,
`PATCH /api/v1/admin/contacts/:id`) MUST go through the canonical
envelope. Specifically:

- 4xx / 5xx responses MUST conform to the 5-key error envelope
  defined in `src/common/filters/all-exceptions.filter.ts`:
  `{ statusCode, error, message, timestamp, path }`. The 429 from
  the throttler is NOT a special case — the global filter already
  renders it via `STATUS_LABELS[429] = "Too Many Requests"`, and
  the `Retry-After` header (set by the throttler before the filter
  receives the exception) is preserved.
- 2xx responses MUST use a consistent success shape. For
  `POST /api/v1/contacts` the success body MUST be the canonical
  single-object envelope (the persisted contact row, mapped
  through the contact response DTO). For `GET /api/v1/admin/contacts`
  the success body MUST be the canonical paginated envelope
  `{ data, total, page, pageSize }` (mirror reviews). For
  `PATCH /api/v1/admin/contacts/:id` the success body MUST be the
  canonical single-object envelope (the updated contact row).

A controller MUST NOT return a raw `Promise<Entity>` from TypeORM.
The service layer MUST map every persisted row through the
response DTO before returning.

**When:** `server_specs.md` §3.4 (the canonical spec is silent on the
envelope; the project's response-envelope convention is project-wide
and was locked by the reviews-domain change).

#### Scenario: 201 success is wrapped in the canonical envelope

- GIVEN a valid `POST /api/v1/contacts` body
- WHEN the route returns 201
- THEN the response body is the canonical single-object envelope containing the persisted contact row
- AND the response headers include `Content-Type: application/json`

#### Scenario: 400 from class-validator is wrapped in the canonical envelope

- GIVEN an invalid `POST /api/v1/contacts` body (e.g. missing `email`)
- WHEN the global `ValidationPipe` rejects the request
- THEN the response status is 400
- AND the response body has exactly 5 keys: `statusCode`, `error`, `message`, `timestamp`, `path`
- AND `error` is a non-empty human-readable label (e.g. `"Bad Request"`)

#### Scenario: 429 from the throttler is wrapped in the canonical envelope

- GIVEN an IP that has exceeded `CONTACT_THROTTLE_WRITE_LIMIT`
- WHEN `POST /api/v1/contacts` is called again
- THEN the response status is 429
- AND the response body has exactly 5 keys: `statusCode`, `error`, `message`, `timestamp`, `path`
- AND `error` equals `"Too Many Requests"` (via `STATUS_LABELS`)
- AND the response includes a `Retry-After` header

#### Scenario: 401 from the admin guard is wrapped in the canonical envelope

- GIVEN a request to `GET /api/v1/admin/contacts` with no `Authorization` header
- WHEN the request is sent
- THEN the response status is 401
- AND the response body has exactly 5 keys: `statusCode`, `error`, `message`, `timestamp`, `path`
- AND `error` equals `"Unauthorized"`

#### Scenario: 404 from PATCH on an unknown id is wrapped in the canonical envelope

- GIVEN a non-existent contact id
- WHEN `PATCH /api/v1/admin/contacts/:id` is called with a valid bearer
- THEN the response status is 404
- AND the response body has exactly 5 keys: `statusCode`, `error`, `message`, `timestamp`, `path`
- AND `error` equals `"Not Found"`

### Requirement: Joi env schema — add `RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS`

The Joi env schema (currently in `src/config/env.config.ts`) MUST be
extended to require two new env vars:

- `RESEND_FROM_ADDRESS` — string, required. The address used as the
  `from` field on every email sent by the `EmailService`. The
  friendly-name form `Name <email@domain>` MUST be accepted.
- `RESEND_TO_ADDRESS` — string, required, MUST be a valid email
  format (use `Joi.string().email()`). The destination address for
  the `contact_notification` email.

The `EnvConfig` TypeScript interface MUST be extended to declare
both fields. The schema MUST reject startup when either field is
missing or when `RESEND_TO_ADDRESS` is not a valid email.

**When:** `server_specs.md` §4 (the canonical env-var list is being
extended; proposal §6 decision #4).

#### Scenario: Missing `RESEND_FROM_ADDRESS` blocks boot

- GIVEN the env has no `RESEND_FROM_ADDRESS` set
- WHEN the application boots
- THEN Joi MUST fail validation and the application MUST NOT start

#### Scenario: Malformed `RESEND_TO_ADDRESS` blocks boot

- GIVEN the env has `RESEND_TO_ADDRESS=not-an-email`
- WHEN the application boots
- THEN Joi MUST fail validation and the application MUST NOT start

#### Scenario: Both env vars are accepted in the friendly-name form

- GIVEN the env has `RESEND_FROM_ADDRESS="Roonder Portfolio <hello@roonder.dev>"` and `RESEND_TO_ADDRESS=admin@roonder.dev`
- WHEN the application boots
- THEN Joi MUST pass validation
- AND `ConfigService.get("RESEND_FROM_ADDRESS")` returns the full string
- AND `ConfigService.get("RESEND_TO_ADDRESS")` returns the address

### Requirement: Joi env schema — add `CONTACT_THROTTLE_*` knobs

The Joi env schema MUST be extended to declare three new env vars
that mirror the reviews pattern (`REVIEWS_THROTTLE_*`):

- `CONTACT_THROTTLE_TTL_MS` — integer, `>= 1_000`, default
  `60_000`. The shared TTL window in milliseconds.
- `CONTACT_THROTTLE_WRITE_LIMIT` — integer, `>= 1`, default `5`
  (conservative; user-locked decision #1: "3–5 submissions/min per
  IP, env-tunable"). The per-IP submission cap.
- `CONTACT_THROTTLE_READ_LIMIT` — integer, `>= 1`, default `60`.
  Reserved for any future paginated read throttling; the public
  list is on the admin surface (which is not throttled), so the
  knob MAY default to `60` to match the reviews precedent and
  remain consistent for any future public contact read.

The "disable" knob for tests is documented (set
`CONTACT_THROTTLE_WRITE_LIMIT=1_000_000`) and MUST NOT be a separate
Joi field — it falls out of the same `>= 1` validation as the
normal value.

**When:** `server_specs.md` §4 (proposal §6 decision #1).

#### Scenario: TTL below 1 000 ms is rejected

- GIVEN the env has `CONTACT_THROTTLE_TTL_MS=500`
- WHEN the application boots
- THEN Joi MUST fail validation (min floor) and the application MUST NOT start

#### Scenario: Zero write limit is rejected

- GIVEN the env has `CONTACT_THROTTLE_WRITE_LIMIT=0`
- WHEN the application boots
- THEN Joi MUST fail validation (min floor) and the application MUST NOT start

#### Scenario: Default values match the proposal

- GIVEN no `CONTACT_THROTTLE_*` env vars are set
- WHEN the application boots
- THEN Joi MUST pass validation
- AND `ConfigService.get("CONTACT_THROTTLE_TTL_MS")` returns `60_000`
- AND `ConfigService.get("CONTACT_THROTTLE_WRITE_LIMIT")` returns `5`
- AND `ConfigService.get("CONTACT_THROTTLE_READ_LIMIT")` returns `60`

### Requirement: `.env.example` (CREATED)

The change MUST CREATE a `.env.example` file at the repo root
(documenting all env vars declared in `env.config.ts`, including
the new ones). The file MUST contain placeholders for every required
env var with a one-line comment, and MUST contain a `# REEMPLAZAR
CUANDO SE COMPRE EL DOMINIO` comment next to
`RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS` to flag that the
sending domain is not yet verified in Resend.

The file MUST be committed to the repo. The gitignored `.env` is
NOT touched.

(Reason: the user's instruction says "Update `.env.example`" but no
such file exists in the repo today — only the gitignored `.env`. A
user-approved deviation recorded 2026-06-23 authorizes CREATING the
file as part of this change.)

**When:** repo root (no canonical section to modify; this is a
new file under the project's "strict TDD" mode).

#### Scenario: `.env.example` is committed

- GIVEN the `domain-contact` change is applied
- WHEN the repo root is listed
- THEN `.env.example` exists
- AND the file is not in `.gitignore`

#### Scenario: `.env.example` documents the new env vars

- GIVEN `.env.example` exists
- WHEN the file is read
- THEN it contains placeholders for `RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS`
- AND it contains the comment `# REEMPLAZAR CUANDO SE COMPRE EL DOMINIO` next to those placeholders
- AND it contains placeholders for `CONTACT_THROTTLE_TTL_MS`, `CONTACT_THROTTLE_WRITE_LIMIT`, and `CONTACT_THROTTLE_READ_LIMIT`
- AND it contains placeholders for every other env var declared in `env.config.ts`

### Requirement: `@nestjs/event-emitter` runtime dependency

The `package.json` MUST declare `@nestjs/event-emitter` as a runtime
dependency (matching the version range used by the rest of the
NestJS 11 ecosystem; pin a specific minor). The
`EventEmitterModule.forRoot()` MUST be registered in `AppModule`
imports (or in `ContactModule` imports if the design phase decides
to scope it). The `package-lock.json` MUST be regenerated to
include the new dependency.

**When:** `server_specs.md` §3.4 ("NestJS EventEmitter2"); this
delta adds the dependency that was missing.

#### Scenario: Dependency is declared and installed

- GIVEN the `domain-contact` change is applied
- WHEN `package.json` is read
- THEN the `dependencies` section MUST include `@nestjs/event-emitter`
- AND `node_modules/@nestjs/event-emitter/package.json` MUST exist after `npm install`

#### Scenario: EventEmitterModule is registered

- GIVEN the application boots
- WHEN the NestJS DI container is built
- THEN `EventEmitterModule` MUST be reachable from the contact
  domain's event listener (i.e. either `AppModule.imports` or
  `ContactModule.imports` includes `EventEmitterModule.forRoot()`)

### Requirement: Trust proxy resolution for the throttler

The application sets `app.set("trust proxy", 1)` globally
(`src/main.ts`), which means the per-IP throttler MUST resolve
`req.ip` correctly behind the single edge proxy. The throttler
reads the source IP from `req.ip`, NOT from `req.headers['x-forwarded-for']`
directly. This is a project-wide invariant already in effect;
the contact throttler MUST inherit it without any new code in
this change.

(Reason: a misconfigured throttler behind a proxy throttles every
visitor at the proxy's IP, which would silently break the public
POST. The project's existing `trust proxy = 1` setting prevents
this; the contact throttler must not regress it.)

**When:** `src/main.ts` (project-wide invariant).

#### Scenario: Throttler reads `req.ip`, not the raw header

- GIVEN a request originating from a public IP, behind the configured edge proxy
- WHEN the contact throttler evaluates the request
- THEN the throttler MUST bucket by `req.ip` (which `trust proxy = 1` resolves correctly)
- AND the throttler MUST NOT bucket by the raw `x-forwarded-for` header (which would collapse all visitors to the proxy's IP)

## MODIFIED Requirements

### Requirement: Canonical env-var list

The canonical env-var list in `server_specs.md` §4 is extended as
follows:

> Required variables: `PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN, SUPERUSER_EMAIL, SUPERUSER_PASSWORD, RESEND_API_KEY, RESEND_FROM_ADDRESS, RESEND_TO_ADDRESS, FRONTEND_URL`.

(Previously: the list was
`PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN, SUPERUSER_EMAIL, SUPERUSER_PASSWORD, RESEND_API_KEY, FRONTEND_URL`.
Now: `RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS` are added as
required. The three `CONTACT_THROTTLE_*` vars are NOT required at
boot — they have Joi defaults.)

**When:** `server_specs.md` §4 (the canonical env-var list).

#### Scenario: Both new env vars are present in the canonical list

- GIVEN the change is archived
- WHEN `server_specs.md` §4 is read
- THEN the required-variables sentence MUST include `RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS`

## Out of scope

- Changing the canonical success-envelope shape. The reviews change
  locked `{ data, total, page, pageSize }` for paginated lists and
  the single-object envelope for single-row responses; the contact
  domain inherits both without modification.
- Modifying `src/main.ts` `trust proxy` settings. The project-wide
  invariant is unchanged.
- Adding a CAPTCHA or honeypot to the public POST. The throttler is
  the only anti-spam gate in this change.
- A `RESEND_WEBHOOK_SECRET` env var. Webhook delivery events are out
  of scope.
- A `RESEND_REPLY_TO_FALLBACK` env var. The `replyTo` defaults to
  the submitter's email; no fallback is needed.
- Renaming the existing `REVIEWS_THROTTLE_*` env vars. The reviews
  precedent is stable; the contact knobs follow the same
  `CONTACT_THROTTLE_*` naming without conflict.
