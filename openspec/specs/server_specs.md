# Software Design Document (SDD) - Backend (Nest.js)

## 1. Architectural Overview

The backend will serve as a monolithic RESTful API built with Nest.js, focusing on dynamic content management for the portfolio.

- **Language:** TypeScript (Strict Mode).
- **Framework:** Nest.js.
- **ORM:** TypeORM (Driver: PostgreSQL).
- **Database:** PostgreSQL (Hosted on Supabase).
- **Environment Validation**: Joi.
- **Data Validation:** class-validator and class-transformer (Data Transfer Objects - DTOs).

## 2. Authentication & Security (In-House)

Since the system is designed for a single administrator (the owner), a proprietary in-house authentication system will be implemented to avoid third-party dependencies.

- **Strategy:** JSON Web Tokens (JWT) via @nestjs/jwt and passport-jwt.
- **Password Hashing:** bcrypt using 12 rounds (salts) in TypeORM hooks (BeforeInsert/BeforeUpdate).
- **Route Protection:** Implementation of a global or controller-level JwtAuthGuard to protect sensitive (Admin) endpoints.
- **CORS:** Strictly configured to only allow requests from the frontend domain (Vite), with `credentials: true` and the `Access-Control-Allow-Origin` header reflecting `FRONTEND_URL`. All routes are served under the `/api/v1` global prefix (see Global API Prefix in §3 and the `api-bootstrap` capability).

## 3. Domain Specifications (Nest.js Modules)

### 3.1. Auth Domain

- `POST /api/v1/auth/login`: Authenticates the admin user and returns an access_token. Public.
- `POST /api/v1/auth/refresh`: Rotates the refresh cookie and returns a new access token. Public. Performs family-level reuse detection (any reuse of an already-revoked refresh token revokes the entire family).
- `POST /api/v1/auth/logout`: Revokes the presented refresh token and clears the `rt` cookie. Public.
- `GET /api/v1/auth/profile`: Returns the authenticated admin profile data `{ id, email }`. Protected by `JwtAuthGuard`.

Full request/response semantics, cookie attributes, storage, and reuse behavior are defined in the `auth-domain` capability spec at `openspec/specs/auth-domain/spec.md`.

### 3.2. Projects Domain

Portfolio management.

- `GET /api/v1/projects`: Retrieves the list of projects (public, paginated, filtered by is_published).
- `GET /api/v1/projects/slug`: Retrieves detail for a single project (public).
- `POST /api/v1/projects`: Creates a new project (Protected).
- `PATCH /api/v1/projects/:id`: Updates an existing project (Protected).
- `DELETE /api/v1/projects/:id`: Deletes a project (Protected).

`Note: Image handling (cover_image) will store the URL. File uploads can be managed via pre-signed URLs targeting a Supabase Storage bucket.`

### 3.3. Reviews Domain

Testimonial system.

- `POST /api/v1/reviews`: Allows a visitor to submit a review (Public). By default, created with is_approved: false.
- `GET /api/v1/reviews`: Lists approved reviews (Public).
- `GET /api/v1/admin/reviews`: Lists all reviews for management (Protected).
- `PATCH /api/v1/admin/reviews/:id/approve`: Toggles approval status (Protected).
- `POST /api/v1/reviews/:id/comments`: Adds a comment to a specific review (Public).
- `GET /api/v1/reviews/:id/comments`: Lista los comentarios aprobados de una reseña (Public).
- `DELETE /api/v1/admin/reviews/:id`: Deletes a review (Protected).

> `GET /api/v1/reviews/:id/comments` (7ª ruta) fue añadida en el change `reviews-domain` (ver `openspec/changes/archive/reviews-domain/` y la capability spec `openspec/specs/reviews-domain/spec.md`). El throttler, el envelope canónico, y el contrato `is_approved`/`ON DELETE CASCADE` viven en la capability spec.

### 3.4. Contact Domain

Public contact form, two transactional emails via Resend, and a dedicated
`sent_emails` audit trail. Last domain shipped (`domain-contact`, branch
`domain/contact`).

#### Routes

- `POST /api/v1/contacts`: Public, throttled per-IP. Receives a contact form
  and dispatches two emails asynchronously (operator notification + visitor
  auto-reply). Returns HTTP 201 with the canonical success envelope on any
  successful persist — Resend failures are caught and translated to
  `sent_emails` rows, never to a 5xx.
- `GET /api/v1/admin/contacts`: JWT-protected. Paginated list of submitted
  contacts, ordered by `created_at DESC`. Returns the canonical paginated
  envelope `{ data, total, page, pageSize }` (mirror the reviews list).
- `PATCH /api/v1/admin/contacts/:id`: JWT-protected. Transitions a contact's
  `status` (`pending` → `read` → `replied`). `:id` MUST be a uuid (parsed via
  `ParseUUIDPipe`); returns 400 on a non-uuid id, 404 on an unknown id, 200
  on success.

Admin routes carry no `@Throttle()` decorator and rely on the global
`ThrottlerGuard` (registered as `APP_GUARD` in `AppModule`) with the
`default` tracker set to `Math.min(reviewsWriteLimit, contactWriteLimit)`.

#### Public POST contract (`POST /api/v1/contacts`)

- The route is public: no `JwtAuthGuard`, no `ApiBearerAuth`. Visitors can
  submit without any authentication.
- The route is throttled per-IP via `@ThrottledContactWrite()` — a
  per-route `@Throttle({ default: { limit, ttl } })` driven by
  `CONTACT_THROTTLE_WRITE_LIMIT` + `CONTACT_THROTTLE_TTL_MS` (defaults:
  `5` requests / `60_000` ms). The throttler's `Retry-After` header is
  preserved through the global exception filter.
- The body is validated by the global `ValidationPipe` (`whitelist`,
  `transform`, `forbidNonWhitelisted`, `enableImplicitConversion`).
- **Exactly four fields** are accepted (the `forbidNonWhitelisted` flag
  rejects everything else with 400):
  - `name`: string, length 1–100, required.
  - `email`: string, valid email format (`@IsEmail()`), required.
  - `subject`: string, length 1–150, required.
  - `message`: string, length 1–5000, required. Whitespace-only is rejected
    (`@Matches(/\S/)`).
  No `phone`, no `company`, no `attachments`. The DTO is locked at the wire
  level — the contact form contract.
- The persisted row's `status` is locked to `'pending'` regardless of DTO
  contents; the public submission never sets `status` directly.

#### Email dispatch contract

After persistence, the service emits a `ContactCreatedEvent` (via
`EventEmitter2` from `@nestjs/event-emitter`); the
`ContactEmailListener` (`@OnEvent('contact.created', { async: true })`)
handles the dispatch asynchronously. The listener calls the
`EmailService` wrapper exactly **twice** per submission, with two
distinct `kind` discriminators:

1. **Owner notification** — `kind: contact_notification`, addressed to
   `RESEND_TO_ADDRESS` with the bilingual subject
   `"Nuevo contacto / New contact: {subject}"` (locked), the visitor's
   `email` set as `replyTo` (so the operator can reply from their own
   client), and an `X-Contact-Id` header carrying the contact row's id.
   The body includes the visitor's `name`, `email`, `subject`, and
   `message`.
2. **Visitor auto-reply** — `kind: contact_auto_reply`, addressed to the
   submitter's `email` with the bilingual subject
   `"Recibimos tu mensaje / We received your message"` (locked). The
   body contains the locked Spanish phrase
   `"Recibimos tu mensaje, te contactaremos por email en breve."`.

The two sends are independent: a failure of one MUST NOT prevent the other
from being attempted, and both MUST be recorded in `sent_emails` with the
appropriate `kind` and `status` (`accepted` or `failed`).

#### Dual-language email body (ES + EN sections, post-verify refinement)

Every email sent by the `EmailService` MUST render its body as **two
clearly-separated sections**: a Spanish section first and an English
section second, divided by a thin visual separator (a `<hr>` with
inline `border-top` styling in HTML, a `----------` line in plain text).
Each section is a self-contained rendering of the same data in the
corresponding language:

- Owner notification: ES heading `"Nuevo mensaje de contacto"` with
  labels `"De:"` / `"Asunto:"`; EN heading `"New contact form
  submission"` with labels `"From:"` / `"Subject:"`. Both sections
  render the visitor's `name`, `email`, `subject`, and `message`.
- Visitor auto-reply: ES heading `"Recibimos tu mensaje"` with
  greeting `"Hola {name},"` and the locked Spanish copy; EN heading
  `"We received your message"` with greeting `"Hi {name},"` and the
  equivalent English copy `"We received your message and will get back
  to you by email shortly."`.

The design is **minimalist**: a single inline `border-top` line between
the two sections, no background colors, no icons, no extra borders. The
vanilla-HTML invariants (no `<style>` block, no flex/grid, no
`position: absolute/fixed`, no `@font-face`) are preserved. The
`sent_emails` audit table records the same two rows per submission
(cardinality unchanged); the dual-language layout is a presentation
concern. See the **Dual-language email body (ES + EN sections)**
requirement in
`openspec/changes/domain-contact/specs/contact/spec.md` for the full
Given/When/Then scenarios.

#### `EmailService` wrapper

A single NestJS-injectable `EmailService` (under `src/contact/email/`)
wraps the Resend SDK. The Resend client is constructor-injectable via the
`RESEND_CLIENT` Symbol token (unit tests inject a fake and never call the
real API). Every invocation writes a `sent_emails` row:

- Successful Resend send (`{ data: { id } }`) → row with
  `status = 'accepted'`, `resend_id = <id>`, `error_message = null`.
- Failed Resend send (`{ data: null, error }` or thrown) → row with
  `status = 'failed'`, `resend_id = null`, `error_message = <message>`.

The `EmailService` is non-throwing: Resend failures are caught and
translated to `sent_emails` rows, never to thrown exceptions that would
reach the global exception filter. As a consequence, the public POST
MUST always return 201 once the row is persisted, even when both emails
fail to send — the user-facing contract is "we received your message";
operator visibility lives in the DB log.

#### Vanilla HTML email format

Every email is rendered as "vanilla" HTML, safe across Gmail, Outlook for
Windows, and Apple Mail:

- XHTML 1.0 Transitional doctype; `<table role="presentation">`-based
  layout (no `<div>` layout).
- All styling is inline `style="..."` attributes; no `<style>` block in
  `<head>`.
- Only the safe-CSS subset is allowed (`color`, `background-color`,
  `font-size`, `font-family`, `font-weight`, `line-height`, `text-align`,
  `text-decoration`, `margin`, `padding`, `border`, `width`, `height`,
  `max-width`, `vertical-align`, `display: none` for the preheader).
- MUST NOT contain `display: flex`, `display: grid`, `position: absolute`,
  `position: fixed`, `transform`, `transition`, `animation`, `vh`, `vw`,
  `@font-face`, or any `<style>` block.
- A hand-written 4–8 line `text` plain-text fallback is ALWAYS provided
  alongside the HTML (not the Resend auto-generated fallback).

#### Schema (destructive change in `domain-contact`)

The `contacts` table:

- `email_sent_log boolean` column is **dropped** (destructive — the
  boolean could not represent two distinct sends, a `resend_id`, or an
  `error_message` per send; the audit trail moved to the new
  `sent_emails` table).
- `updated_at timestamp [default: now()]` column is **added** so the
  admin PATCH mutates a last-modified timestamp (mirror the `projects`
  precedent).

A new `sent_emails` table is added (10 columns + 2 Postgres-native enums
+ 4 indexes; full DDL in `openspec/specs/database-schema.dbml`):
`id`, `subject`, `from`, `to`, `resend_id` (nullable), `status` enum
(`accepted`, `failed`), `kind` enum (`contact_notification`,
`contact_auto_reply`), `error_message` (nullable), `created_at`,
`updated_at`. The `status` enum leaves room for future `delivered`,
`bounced`, `complained` values once a Resend webhook receiver lands
(out of scope for `domain-contact`). Indexes: `kind`, `status`,
`created_at DESC`, and a partial unique index on `resend_id` where
`resend_id IS NOT NULL` (idempotency + future webhook correlation).

The destructive change is reversible: the migration's `down` step
recreates `email_sent_log boolean NOT NULL DEFAULT true` and drops
`updated_at` + the `sent_emails` table + its 2 enums + its 4 indexes.

#### Response envelope

Every HTTP response from a contact-domain route goes through the
canonical envelope:

- 4xx / 5xx responses use the 5-key error envelope
  `{ statusCode, error, message, timestamp, path }` (rendered by
  `AllExceptionsFilter`). The 429 from the throttler falls under this
  filter with `error: "Too Many Requests"`, and the throttler's
  `Retry-After` header is preserved.
- 2xx responses use the canonical success envelope. `POST /api/v1/contacts`
  and `PATCH /api/v1/admin/contacts/:id` return the single-object
  envelope (the persisted / updated contact row, mapped through
  `ContactResponseDto`). `GET /api/v1/admin/contacts` returns the
  paginated envelope `{ data, total, page, pageSize }` (mirror reviews).

A controller MUST NOT return a raw `Promise<Entity>` from TypeORM. The
service layer maps every persisted row through the response DTO before
returning.

#### Formal spec cross-references

Full Given/When/Then scenarios for the contact surface live in:

- `openspec/changes/domain-contact/specs/contact/spec.md` —
  public POST, DTO validation, per-IP throttler, `EmailService` wrapper,
  two-email dispatch, vanilla HTML format, no-5xx-on-Resend-failure
  contract, admin list, admin status transition, async event emission,
  and the REMOVED `email_sent_log` requirement.
- `openspec/changes/domain-contact/specs/database/spec.md` —
  the `sent_emails` table, the `updated_at` additive change, and the
  `email_sent_log` REMOVED requirement with migration semantics.
- `openspec/changes/domain-contact/specs/cross-cutting/spec.md` —
  the response-envelope contract, the `RESEND_FROM_ADDRESS` /
  `RESEND_TO_ADDRESS` / `CONTACT_THROTTLE_*` env-var additions, the
  `.env.example` creation, the `@nestjs/event-emitter` runtime
  dependency, and the `trust proxy` invariant for the throttler.

### 3.5. Global API Prefix

All HTTP routes defined by the Auth, Projects, Reviews, and Contact domains MUST be reachable only under the global `/api/v1` prefix. The full semantics of the prefix, including scenarios, are defined in the `api-bootstrap` capability spec (see `openspec/specs/api-bootstrap/spec.md`, Requirement: Global API Prefix).

## 4. Environment Variable Management (Joi Validation)

Joi will be used in ConfigModule.forRoot() to guarantee that the server does not boot if critical credentials are missing.
Required variables: `PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN, SUPERUSER_EMAIL, SUPERUSER_PASSWORD, RESEND_API_KEY, RESEND_FROM_ADDRESS, RESEND_TO_ADDRESS, FRONTEND_URL`.

The JWT and superuser variables are validated per the requirements in the `auth-domain` capability spec at `openspec/specs/auth-domain/spec.md` (Requirements: Access Token Expiration, Refresh Token Secret, Refresh Token Expiration, Bootstrap Superuser Email, Bootstrap Superuser Password). In particular, `JWT_REFRESH_SECRET` MUST be at least 32 characters and MUST differ from `JWT_SECRET`; `JWT_REFRESH_EXPIRES_IN` MUST be a positive integer string of seconds; `SUPERUSER_PASSWORD` MUST be at least 8 characters.

The Resend addressing variables (`RESEND_FROM_ADDRESS`, `RESEND_TO_ADDRESS`) are validated per the requirements in the `domain-contact` cross-cutting spec at `openspec/changes/domain-contact/specs/cross-cutting/spec.md` (Requirement: Joi env schema — add `RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS`). `RESEND_FROM_ADDRESS` is a `.string()` and accepts the friendly-name form `"Name <email@domain>"` (Resend's `from` allows it; `.email()` would reject the angle brackets). `RESEND_TO_ADDRESS` is `.string().email().required()` — Resend rejects the friendly-name form on `to`, so a bare email is enforced.

The throttler knobs (`REVIEWS_THROTTLE_TTL_MS`, `REVIEWS_THROTTLE_WRITE_LIMIT`, `REVIEWS_THROTTLE_READ_LIMIT`, `CONTACT_THROTTLE_TTL_MS`, `CONTACT_THROTTLE_WRITE_LIMIT`, `CONTACT_THROTTLE_READ_LIMIT`) are Joi-validated with integer floors (TTL `>= 1_000` ms, limits `>= 1`) and sensible defaults (60_000 / 5 / 60 per domain). Setting the write limit to `1_000_000` is the documented "disable" knob for tests; it falls out of the same `>= 1` validation, no separate Joi field. The `domain-contact` cross-cutting spec at `openspec/changes/domain-contact/specs/cross-cutting/spec.md` (Requirement: Joi env schema — add `CONTACT_THROTTLE_*` knobs) is the source of truth for the contact knobs.

A `.env.example` file at the repo root documents every env var declared in `EnvConfig`, including placeholders for `RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS` with the literal Spanish comment `# REEMPLAZAR CUANDO SE COMPRE EL DOMINIO` next to each (the sending domain is not yet verified in Resend; the file is created in `domain-contact` because it did not exist before).
