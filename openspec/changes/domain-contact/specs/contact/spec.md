# Delta for Contact Domain

## Purpose

This delta converts the informal `server_specs.md` §3.4 Contact prose into a
formal, testable contract, and ADDs the requirements that the user-locked
decisions (proposal §6) introduce: per-IP throttling, two emails per submission
(owner notification + auto-reply), a vanilla HTML email format, and a
never-5xx error-handling contract on Resend failure. The `email_sent_log`
boolean on the `contacts` row is REMOVED; the audit trail moves to a new
`sent_emails` table (encoded in the database delta).

## Source sections

Quoted from `openspec/specs/server_specs.md` §3.4 (lines 60–76) so reviewers
can diff against the canonical text:

> ### 3.4. Contact Domain
>
> Mail delivery and logging.
>
> - `POST /api/v1/contacts`: Receives a contact form.
>
> **Business Logic:**
>
> - Validates the DTO via the global `ValidationPipe` (whitelist, transform, forbidNonWhitelisted, enableImplicitConversion).
> - Saves the record in the database (PostgreSQL) with an initial status.
> - Emits an asynchronous event (NestJS EventEmitter2) to trigger the email service.
> - The Email service connects to Resend via its SDK.
> - Updates the contact record (email_sent_log) confirming the dispatch.
>
> - `GET /api/v1/admin/contacts`: Lists the log of received emails (Protected)
>   .
> - `PATCH /api/v1/admin/contacts/:id`: Marks a contact as read/replied (Protected).

Quoted from `openspec/specs/database-schema.dbml` lines 58–67 (the current
`contacts` table, which this delta modifies):

```
Table contacts {
  id uuid [pk, default: `uuid_generate_v4()`]
  name varchar [not null]
  email varchar [not null]
  subject varchar
  message text [not null]
  status varchar [default: 'pending', note: 'pending, read, replied']
  email_sent_log boolean [default: true, note: 'Verifica si Resend procesó el correo']
  created_at timestamp [default: `now()`]
}
```

## Purpose of the change

The Contact domain is the last remaining domain to ship the portfolio
backend. The user wants a public contact form whose submissions are
persisted, audited, and trigger **two** transactional emails via Resend:
an operator notification (so the portfolio owner is alerted) and a
visitor auto-reply (so the submitter gets an acknowledgment in their
own language). Both sends MUST be recorded individually in a dedicated
`sent_emails` table so the operator can audit failures without depending
on the Resend dashboard. The public POST MUST NOT leak a 5xx when Resend
fails — the user-facing contract is "we received your message"; operator
visibility lives in the DB log. The `email_sent_log boolean` on the
`contacts` row is being dropped because it is structurally incapable of
recording two distinct sends, two `kind`s, an error message, or a
Resend id, all of which the new `sent_emails` table captures
(destructive DBML delta — see `database/spec.md`).

## ADDED Requirements

### Requirement: Public POST contact endpoint

The system MUST expose `POST /api/v1/contacts` under the global `/api/v1`
prefix. The route MUST be public (no `JwtAuthGuard`, no `ApiBearerAuth`),
MUST be throttled per-IP via `@Throttle()` (see throttler requirement
below), and MUST accept a JSON body validated by the global
`ValidationPipe` with `whitelist`, `transform`, `forbidNonWhitelisted`,
and `enableImplicitConversion` enabled. On success, the system MUST
return HTTP 201 with the canonical success envelope, regardless of whether
the downstream Resend send ultimately succeeds (see "Resend failure does
not 5xx" requirement).

**When:** `server_specs.md` §3.4 ("POST /api/v1/contacts").

#### Scenario: Valid body persists a contact and returns 201

- GIVEN a public client with a valid `Content-Type: application/json` body `{ name, email, subject, message }`
- WHEN `POST /api/v1/contacts` is called
- THEN the system persists a new `contacts` row with `status = 'pending'`
- AND the system returns HTTP 201 with the canonical success envelope containing the persisted row
- AND no bearer token is required

#### Scenario: Public route carries no JwtAuthGuard

- GIVEN the public `POST /api/v1/contacts` route
- WHEN the route metadata is inspected
- THEN the route MUST NOT declare `@UseGuards(JwtAuthGuard)` (or any equivalent auth guard)

### Requirement: Contact form DTO validation

The system MUST validate the public `POST /api/v1/contacts` body against
a `CreateContactDto` with exactly four fields, no more and no less:
`name` (string, required, length 1–100), `email` (string, required,
must match the `class-validator` `@IsEmail()` contract), `subject`
(string, required, length 1–150), and `message` (string, required,
length 1–5000). The DTO MUST NOT accept a `phone` field, a `company`
field, an `attachments` field, or any other field. The global
`ValidationPipe`'s `forbidNonWhitelisted: true` MUST reject any extra
field with HTTP 400 and the canonical error envelope.

**When:** `server_specs.md` §3.4 (the existing DTO-validation bullet
becomes formal; the field list is locked per user decision #6).

#### Scenario: Required fields are enforced

- GIVEN a `POST /api/v1/contacts` body missing the `message` field
- WHEN the request is sent
- THEN the system returns HTTP 400 with the canonical error envelope
- AND the error `message` identifies `message` as a required field

#### Scenario: Email must be a valid format

- GIVEN a body with `email: "not-an-email"`
- WHEN `POST /api/v1/contacts` is called
- THEN the system returns HTTP 400 with the canonical error envelope
- AND the error `message` identifies `email` as invalid

#### Scenario: Length bounds are enforced

- GIVEN a body with `name` longer than 100 characters
- WHEN `POST /api/v1/contacts` is called
- THEN the system returns HTTP 400 with the canonical error envelope
- AND the error `message` identifies `name` as exceeding the maximum length

#### Scenario: Extra fields are rejected

- GIVEN a body with the locked fields plus an extra `phone: "555-1234"` field
- WHEN `POST /api/v1/contacts` is called
- THEN the system returns HTTP 400 with the canonical error envelope
- AND the error `message` identifies `phone` as a non-whitelisted property

### Requirement: Per-IP throttler on the public POST

The system MUST apply a per-IP `@Throttle()` decorator to
`POST /api/v1/contacts`. The throttle's `limit` and `ttl` MUST be driven
by environment variables, mirroring the reviews-domain pattern (proposal
§4.1, `src/reviews/throttle.decorator.ts`). The contact throttle MUST
expose exactly three env vars — `CONTACT_THROTTLE_TTL_MS`,
`CONTACT_THROTTLE_WRITE_LIMIT`, and `CONTACT_THROTTLE_READ_LIMIT` — plus
a documented "disable" knob: setting the limit to `1_000_000` effectively
disables throttling (same convention as reviews). The Joi schema MUST
reject `CONTACT_THROTTLE_TTL_MS < 1_000` (mirror reviews) and MUST
require the limit values to be integers `>= 1`. Default values MUST be
conservative: 3–5 submissions per minute per IP. Admin routes
(`/api/v1/admin/contacts/*`) MUST NOT carry any `@Throttle()` decorator.

**When:** `server_specs.md` §3.4 (anti-spam was silent; user-locked
decision #1).

#### Scenario: Excessive submissions are throttled

- GIVEN an IP has already submitted `CONTACT_THROTTLE_WRITE_LIMIT` requests within `CONTACT_THROTTLE_TTL_MS` ms
- WHEN the same IP calls `POST /api/v1/contacts` again
- THEN the system returns HTTP 429 with the canonical error envelope
- AND the response carries a `Retry-After` header (set by the throttler before the global filter runs)

#### Scenario: Throttler uses CONTACT_THROTTLE_* env vars

- GIVEN the env vars `CONTACT_THROTTLE_TTL_MS=60000` and `CONTACT_THROTTLE_WRITE_LIMIT=5`
- WHEN the route metadata is inspected at boot
- THEN the bound `@Throttle()` value MUST equal `{ default: { limit: 5, ttl: 60_000 } }`

#### Scenario: Joi rejects zero-millisecond TTL

- GIVEN the env `CONTACT_THROTTLE_TTL_MS=0`
- WHEN the application boots
- THEN Joi MUST fail validation and the application MUST NOT start

#### Scenario: Admin routes are not throttled

- GIVEN the admin `GET /api/v1/admin/contacts` and `PATCH /api/v1/admin/contacts/:id` routes
- WHEN the route metadata is inspected
- THEN neither route MUST declare any `@Throttle()` decorator

### Requirement: EmailService wrapper around Resend

The system MUST provide a single NestJS-injectable `EmailService` (under
`src/contact/email/`, per proposal §4 and explore §5.7) that wraps the
Resend SDK. The wrapper MUST expose a single transactional send method
that accepts a `to`, a `from`, a `subject`, an `html` body, a `text`
body, an optional `replyTo`, an optional `headers` bag, and a `kind`
discriminator (`contact_notification` or `contact_auto_reply`). Every
invocation MUST write a row to the `sent_emails` table recording
`subject`, `from`, `to`, `resend_id` (nullable; populated only when
Resend returns `{ data: { id } }`), `status` (`accepted` or `failed`),
`kind`, and `error_message` (nullable; populated on `failed`). The
wrapper MUST accept a constructor-injectable Resend client (or an
options token) so unit tests can pass a fake and never call the real
Resend API.

**When:** `server_specs.md` §3.4 ("The Email service connects to Resend
via its SDK."). The wrapper makes the "connects to Resend" prose
testable and adds the audit-trail contract that was previously implicit.

#### Scenario: Successful send writes an `accepted` row

- GIVEN the `EmailService` is called with a valid payload for `kind = contact_notification`
- WHEN the Resend client resolves with `{ data: { id: "abc123" } }`
- THEN the system writes a `sent_emails` row with `status = accepted`, `kind = contact_notification`, `resend_id = "abc123"`, and `error_message = null`

#### Scenario: Failed send writes a `failed` row

- GIVEN the `EmailService` is called with a valid payload
- WHEN the Resend client resolves with `{ data: null, error: { name, message, statusCode } }` (or rejects)
- THEN the system writes a `sent_emails` row with `status = failed`, `kind = <the kind passed>`, `resend_id = null`, and `error_message = <non-null message>`

#### Scenario: Resend client is constructor-injectable

- GIVEN a unit test instantiates `EmailService` with a fake Resend client
- WHEN the test resolves a send
- THEN no network call leaves the test process
- AND the `sent_emails` insert is verifiable via a repository fake

### Requirement: Two emails per submission

The system MUST send exactly two emails per successful public
`POST /api/v1/contacts` call, both via the `EmailService` wrapper, both
with independent `sent_emails` log rows:

1. An **owner notification** addressed to `RESEND_TO_ADDRESS` with
   subject `"Nuevo contacto / New contact: {subject}"`, the visitor's
   email set as `replyTo` so the operator can reply from their own
   client, and the body containing the visitor's `name`, `email`,
   `subject`, and `message`.
2. A **visitor auto-reply** addressed to the submitter's `email` field
   with subject `"Recibimos tu mensaje / We received your message"`
   and a body containing the fixed Spanish copy "Recibimos tu
   mensaje, te contactaremos por email en breve."

The two sends MUST be independent: a failure of one MUST NOT prevent
the other from being attempted, and both MUST be recorded in
`sent_emails` with the appropriate `kind` (`contact_notification` or
`contact_auto_reply`).

**When:** `server_specs.md` §3.4 (the auto-reply was silent; the owner
notification was implicit; user-locked decision #3).

#### Scenario: Successful POST triggers two independent sends

- GIVEN a valid `POST /api/v1/contacts` submission
- WHEN the service processes the request
- THEN exactly two `EmailService.send` calls are invoked
- AND one has `kind = contact_notification` addressed to `RESEND_TO_ADDRESS`
- AND the other has `kind = contact_auto_reply` addressed to the submitter's email
- AND both `sent_emails` rows are persisted with `status = accepted` and a non-null `resend_id`

#### Scenario: Auto-reply copy is locked

- GIVEN a successful send of `kind = contact_auto_reply`
- WHEN the email body is rendered
- THEN the plain-text body MUST contain the literal Spanish phrase "Recibimos tu mensaje, te contactaremos por email en breve."

#### Scenario: Owner notification subject is locked

- GIVEN a successful send of `kind = contact_notification` for a submission with `subject = "Question"`
- WHEN the email payload is built
- THEN the `subject` field MUST equal the literal string `"Nuevo contacto / New contact: Question"`

#### Scenario: Auto-reply subject is locked

- GIVEN a successful send of `kind = contact_auto_reply`
- WHEN the email payload is built
- THEN the `subject` field MUST equal the literal string `"Recibimos tu mensaje / We received your message"`

#### Scenario: Failures are independent

- GIVEN the `contact_notification` send fails (Resend returns an error) but the `contact_auto_reply` send succeeds
- WHEN the service processes the request
- THEN the `sent_emails` row for `contact_notification` has `status = failed` and a non-null `error_message`
- AND the `sent_emails` row for `contact_auto_reply` has `status = accepted` and a non-null `resend_id`

### Requirement: Dual-language email body (ES + EN sections)

Every email sent by the `EmailService` MUST render its body as two
clearly-separated sections: a Spanish section first and an English
section second, with a thin visual divider between them (a `<hr>` with
inline `border-top` styling in HTML, a `----------` line in plain
text). Each section MUST be a self-contained, self-explanatory
rendering of the same data in the corresponding language:

- The **Spanish section** of the owner notification MUST contain
  the heading "Nuevo mensaje de contacto", the labels "De:" and
  "Asunto:", and the rendered `name`, `email`, `subject`, and
  `message` values from the contact row.
- The **English section** of the owner notification MUST contain
  the heading "New contact form submission", the labels "From:"
  and "Subject:", and the same `name`, `email`, `subject`, and
  `message` values.
- The **Spanish section** of the visitor auto-reply MUST contain
  the heading "Recibimos tu mensaje", the greeting "Hola
  {name},", and the locked Spanish copy "Recibimos tu mensaje,
  te contactaremos por email en breve."
- The **English section** of the visitor auto-reply MUST contain
  the heading "We received your message", the greeting "Hi
  {name},", and the equivalent English copy "We received your
  message and will get back to you by email shortly."

The design MUST be minimalist: a single inline `border-top` line
between the two sections, no background colors, no icons, no extra
borders. The goal is that the recipient can identify the language
section that fits them in under a second. The vanilla-HTML
invariants from the "Vanilla HTML email format" requirement
(no `<style>` block, no flex/grid, no position: absolute/fixed,
no `@font-face`) MUST be preserved.

The `sent_emails` audit table records the same two rows per
submission as before (one per `kind`); the dual-language layout
is a presentation concern and does NOT change the cardinality of
the audit trail.

**When:** post-verify refinement (2026-06-24). The user wanted
both the owner and the visitor to receive emails in both
languages within the same body, with a minimalist design that
makes each version easy to identify. This requirement is in
addition to, not a replacement of, the "Two emails per
submission" and "Vanilla HTML email format" requirements.

#### Scenario: Owner notification HTML contains both language sections

- GIVEN the `EmailService` renders the `contact_notification` body for a sample submission
- WHEN the rendered HTML string is asserted on
- THEN the string MUST contain the heading "Nuevo mensaje de contacto"
- AND the string MUST contain the heading "New contact form submission"
- AND the Spanish section MUST appear before the English section in document order
- AND the labels "De:" and "Asunto:" MUST both be present
- AND the labels "From:" and "Subject:" MUST both be present

#### Scenario: Auto-reply HTML contains both language sections

- GIVEN the `EmailService` renders the `contact_auto_reply` body for a sample submission
- WHEN the rendered HTML string is asserted on
- THEN the string MUST contain the heading "Recibimos tu mensaje"
- AND the string MUST contain the heading "We received your message"
- AND the Spanish section MUST appear before the English section in document order
- AND the string MUST contain "Hola {name}," (Spanish greeting)
- AND the string MUST contain "Hi {name}," (English greeting)

#### Scenario: Plain-text fallback mirrors the dual-language structure

- GIVEN any `EmailService.send` call
- WHEN the plain-text body is rendered
- THEN the Spanish section MUST appear first
- AND the English section MUST appear second
- AND a "----------" line MUST separate the two sections
- AND every `{{placeholder}}` token MUST be substituted in BOTH sections

#### Scenario: Email subjects are bilingual

- GIVEN a send of `kind = contact_notification` with a row whose `subject = "Pricing question"`
- WHEN the email payload is built
- THEN the `subject` field MUST equal the literal string `"Nuevo contacto / New contact: Pricing question"`

- GIVEN a send of `kind = contact_auto_reply`
- WHEN the email payload is built
- THEN the `subject` field MUST equal the literal string `"Recibimos tu mensaje / We received your message"`

### Requirement: Vanilla HTML email format

Every email sent by the `EmailService` MUST be "vanilla" — i.e., safe
across the major email clients (Gmail, Outlook for Windows, Apple Mail).
Concretely, the rendered HTML payload MUST:

- Declare the XHTML 1.0 Transitional doctype.
- Use `<table role="presentation">` for layout (no `<div>`-based layout).
- Carry all styling as inline `style="..."` attributes on each element
  (no `<style>` block in `<head>`).
- Use only the safe-CSS subset enumerated in the explore report
  (`color`, `background-color`, `font-size`, `font-family`,
  `font-weight`, `line-height`, `text-align`, `text-decoration`,
  `margin`, `padding`, `border`, `width`, `height`, `max-width`,
  `display: none` for preheader, `vertical-align`).
- MUST NOT contain `display: flex`, `display: grid`, `position: absolute`,
  `position: fixed`, `transform`, `transition`, `animation`, `vh`, `vw`,
  `@font-face`, or any `<style>` block.
- ALWAYS include a `text` plain-text fallback field (a hand-written
  4–8 line version, not the Resend auto-generated one).

The contact email body MAY include a hidden preheader `<span
style="display:none;...">` as the first child of `<body>` (the
"safe-CSS" exception for `display: none`). The spec does NOT mandate
this preheader; if present, it MUST still conform to the "no other
disallowed CSS" rule above.

**When:** `server_specs.md` §3.4 (silent on email format; user-locked
on "lo más vanilla posible").

#### Scenario: Email HTML does not contain a `<style>` block

- GIVEN the `EmailService` renders the `contact_notification` body for a sample submission
- WHEN the rendered HTML string is asserted on
- THEN the string MUST NOT match the regex `/<style\b/i`

#### Scenario: Email HTML does not use flex/grid/float/positioning

- GIVEN the `EmailService` renders the `contact_auto_reply` body for a sample submission
- WHEN the rendered HTML string is asserted on
- THEN the string MUST NOT contain the substrings `display: flex`, `display: grid`, `position: absolute`, `position: fixed`, or `@font-face`

#### Scenario: Plain-text fallback is always provided

- GIVEN any `EmailService.send` call
- WHEN the Resend payload is built
- THEN the `text` field MUST be a non-empty string (not the auto-generated fallback)

### Requirement: Resend failure does not 5xx the public POST

When one or both `EmailService.send` calls fail (Resend returns an
error, rejects, or the call throws), the public `POST /api/v1/contacts`
MUST still return HTTP 201 with the canonical success envelope. The
failure(s) MUST be recorded in `sent_emails.error_message` so the
operator can audit via the DB. The global exception filter MUST NOT be
reached on a Resend failure (the failure is caught inside the
contact-domain event handler / service and translated to a
`sent_emails` row, not to an exception).

**When:** `server_specs.md` §3.4 (silent on error handling; user-locked
decision #7).

#### Scenario: Both Resend sends fail, public POST still returns 201

- GIVEN a valid `POST /api/v1/contacts` submission
- WHEN both `EmailService.send` calls fail (e.g. Resend returns `invalid_from_address`)
- THEN the system returns HTTP 201 with the canonical success envelope
- AND two `sent_emails` rows are persisted: both with `status = failed` and non-null `error_message`
- AND the global exception filter is NOT invoked

#### Scenario: One Resend send fails, public POST still returns 201

- GIVEN a valid `POST /api/v1/contacts` submission
- WHEN the `contact_notification` send fails and the `contact_auto_reply` send succeeds
- THEN the system returns HTTP 201 with the canonical success envelope
- AND the `sent_emails` row for `contact_notification` has `status = failed` and a non-null `error_message`
- AND the `sent_emails` row for `contact_auto_reply` has `status = accepted` and a non-null `resend_id`

### Requirement: Admin list contact endpoint (protected)

The system MUST expose `GET /api/v1/admin/contacts` as a paginated
list of submitted contacts, protected by class-level `JwtAuthGuard`
(mirror reviews, `src/reviews/reviews-admin.controller.ts`) and
documented with `@ApiBearerAuth()`. The response MUST use the canonical
paginated envelope `{ data, total, page, pageSize }` (mirror reviews).

**When:** `server_specs.md` §3.4 ("GET /api/v1/admin/contacts: Lists
the log of received emails (Protected)").

#### Scenario: Missing JWT returns 401

- GIVEN a request to `GET /api/v1/admin/contacts` with no `Authorization` header
- WHEN the request is sent
- THEN the system returns HTTP 401 with the canonical error envelope

#### Scenario: Valid JWT returns paginated contacts

- GIVEN a valid bearer token
- WHEN `GET /api/v1/admin/contacts?page=1&pageSize=20` is called
- THEN the system returns HTTP 200 with the canonical paginated envelope
- AND `data` is an array of contact rows ordered by `created_at DESC`

### Requirement: Admin status transition (protected)

The system MUST expose `PATCH /api/v1/admin/contacts/:id` to transition
a contact's `status` (the canonical enum values: `pending`, `read`,
`replied`). The route MUST be protected by class-level `JwtAuthGuard`
and `:id` MUST be parsed via `ParseUUIDPipe` (the DBML `id` is a
`uuid`). The route MUST return 404 on an unknown id, 400 on a non-uuid
id, and 200 with the updated row on success. The `status` enum is the
canonical set — `status = email_sent_log` (a boolean) is NOT a valid
PATCH body (that field is being dropped, see `database/spec.md`).

**When:** `server_specs.md` §3.4 ("PATCH /api/v1/admin/contacts/:id:
Marks a contact as read/replied (Protected)").

#### Scenario: Valid PATCH transitions the status

- GIVEN a contact with `status = 'pending'`
- WHEN `PATCH /api/v1/admin/contacts/:id` is called with body `{ "status": "read" }` and a valid bearer
- THEN the system returns HTTP 200 with the canonical success envelope containing the updated row
- AND the `sent_emails` rows for that contact are unchanged

#### Scenario: PATCH on unknown id returns 404

- GIVEN a non-existent contact id
- WHEN `PATCH /api/v1/admin/contacts/:id` is called with a valid bearer
- THEN the system returns HTTP 404 with the canonical error envelope

#### Scenario: PATCH on non-uuid id returns 400

- GIVEN a path parameter that is not a uuid
- WHEN `PATCH /api/v1/admin/contacts/:id` is called
- THEN the system returns HTTP 400 with the canonical error envelope

## MODIFIED Requirements

### Requirement: Asynchronous event emission for email dispatch

The system MUST emit a NestJS `EventEmitter2` event after a contact row
is persisted, in order to trigger the two email sends asynchronously.
The event handler MUST be a class-level `@OnEvent(...)` listener
(co-located under `src/contact/`, since the contact domain is the only
domain that consumes it). The handler MUST call the `EmailService`
twice — once for `contact_notification`, once for `contact_auto_reply` —
and MUST translate Resend failures into `sent_emails` rows with
`status = failed` (not into thrown exceptions). The
`@nestjs/event-emitter` package MUST be installed and
`EventEmitterModule.forRoot()` MUST be registered in `AppModule`.

(Previously: the original §3.4 bullet was "Emits an asynchronous event
(NestJS EventEmitter2) to trigger the email service." This requirement
locks the event-emitter package, the registration point, and the
"two sends per event" contract.)

**When:** `server_specs.md` §3.4 (the original "Emits an asynchronous
event" bullet).

#### Scenario: Event is emitted after persistence

- GIVEN a valid `POST /api/v1/contacts` submission
- WHEN the service persists the row
- THEN the service emits a `ContactCreatedEvent` (or equivalent) before returning 201
- AND an `@OnEvent` listener handles it asynchronously

#### Scenario: Event handler triggers both sends

- GIVEN a `ContactCreatedEvent` is emitted
- WHEN the event listener handles it
- THEN it invokes `EmailService.send` twice — once for `contact_notification`, once for `contact_auto_reply`

## REMOVED Requirements

### Requirement: `email_sent_log` boolean on the `contacts` row

(Reason: the boolean is structurally incapable of recording the
audit-trail the user requires — two distinct sends, two `kind`s, a
nullable `resend_id`, and a nullable `error_message` per send. The
new `sent_emails` table (see `database/spec.md`) captures all of
this. The destructive migration drops the column.)

(Migration: the `down` migration recreates the `email_sent_log boolean
[default: true]` column on the `contacts` table. Application code MUST
NOT reference `email_sent_log` after the change is applied.)

**When:** `server_specs.md` §3.4 (the original "Updates the contact
record (email_sent_log) confirming the dispatch" bullet is removed);
`database-schema.dbml` line 65 (the column is removed).

#### Scenario: Application code no longer references `email_sent_log`

- GIVEN the `domain-contact` change is applied
- WHEN the contact-domain source tree is grepped
- THEN no source file under `src/contact/` references the string `email_sent_log`

#### Scenario: The column does not exist after migration

- GIVEN the `down` migration for the change has NOT been run (i.e. the up migration is in effect)
- WHEN the `contacts` table is inspected via `\d contacts` in psql
- THEN the `email_sent_log` column is NOT present

## Out of scope

- Resend webhook receiver for delivery events (`email.delivered`,
  `email.bounced`, `email.complained`). Future work; the `status`
  enum on `sent_emails` leaves room for these values but no listener
  is wired in this change.
- hCaptcha / honeypot / advanced anti-spam. The per-IP throttler is
  the only anti-spam gate in this change.
- File attachments on the contact form.
- `DELETE /api/v1/admin/contacts/:id` (not in canonical spec).
- Auto-replying to a contact from the admin PATCH (the spec only
  marks status; the operator replies via their own email client
  thanks to `replyTo` on the owner notification).
- A separate `src/common/email/` — the wrapper lives under
  `src/contact/email/` since only this domain uses it today.
- Seed CLI for the contact domain.
- Admin endpoint to read `sent_emails` as a paginated list (the
  admin currently sees only `contacts`; `sent_emails` is operator-
  audited via DB or psql).
- PII retention job (auto-purge after N days).
- Verified sending domain — Resend will refuse to send from an
  unverified `from` address; this is a deployment gate, not a code
  change. The `.env.example` carries a `# REEMPLAZAR CUANDO SE
  COMPRE EL DOMINIO` comment (see `cross-cutting/spec.md`).
