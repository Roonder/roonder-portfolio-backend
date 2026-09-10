# Exploration: domain-contact

## Change

| Field | Value |
| --- | --- |
| Change name | `domain-contact` |
| Branch | `domain/contact` (to be cut from `dev` at apply time; latest merge `396c465` is `domains/reviews`) |
| Intent (verbatim, Spanish) | "Implementar el último dominio restante: domain/contact ... Configurar un email de contacto sencillo. Configurar los servicios para utilizar Resend como motor de envío de emails. Y almacenar los registros de los correos enviados en la DB. ... el email se maneje lo más 'vanilla' posible, al saber que sus estilos son muy malos." |
| Intent (English, paraphrased) | Build the **Contact** domain. Wire the public contact form, configure Resend as the email engine, persist every sent email to the DB. Keep the email HTML as **vanilla** as possible because email-client CSS support is poor. |
| Artifact store | `openspec` (repo-local at `openspec/`) |
| Planning home | `openspec/changes/domain-contact/` (created by this exploration) |
| Strict TDD | Active (locked at `openspec/config.yaml > rules.apply.tdd: true`). This is exploration; flagged pre-existing test state for apply/verify. |
| Delivery strategy | ask-always (no chained PR decision yet; decision will be re-evaluated at sdd-tasks once LOC budget is forecast) |
| Review budget | 400 changed lines per PR (soft cap) |

## 1. Summary

The `domain-contact` change is the **last domain to ship** in this monorepo. The
canonical spec (`openspec/specs/server_specs.md` §3.4) and the DBML
(`database-schema.dbml` lines 58–67) already define a `contacts` table with
`status` + `email_sent_log boolean`, three HTTP routes (1 public POST + 2
protected admin routes), and a Resend-based email flow triggered via NestJS
`EventEmitter2`. The dependency `resend ^6.12.4` is **already installed** and
`RESEND_API_KEY` is **already in the Joi env schema** — but the actual email
client wrapper, the entity columns, the DTOs, the controller routes, the
event-handler, the migration, and any HTML template are **NOT** implemented
yet. `src/contact/` is the untouched NestJS CLI scaffold: empty classes, string
placeholders, smoke-only tests. The two **biggest unknowns** are (a) the
`from`-address strategy (Resend requires a **verified domain** and the project
has no `CONTACT_FROM_ADDRESS` or `CONTACT_TO_ADDRESS` env var yet) and (b) the
shape of the "sent-email log" (spec says "log of received emails" with a
boolean column on the contact row; the user intent is "almacenar los registros
de los correos enviados" — these may diverge, see §Open questions).

## 2. Current state of `src/contact/`

File-by-file audit. Every file lives in `src/contact/` unless noted.

| File | Status | What it has | What it needs |
| --- | --- | --- | --- |
| `contact.controller.ts` | **Stub** (45 LOC) | `@Controller("contact")` with 5 routes: `POST`, `GET`, `GET :id`, `PATCH :id`, `DELETE :id`. Numeric id coercion (`+id`), no admin split, no `@UseGuards`, no Swagger. | Replace with 2 controllers per `server_specs.md` §3.4: public `POST /api/v1/contacts` + admin `GET /api/v1/admin/contacts` + `PATCH /api/v1/admin/contacts/:id`. Use `ParseUUIDPipe` (the DBML `id` is `uuid`). Class-level `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()` on the admin controller. `@ApiTags("contact")`. Drop the `GET :id` / `DELETE :id` (not in spec). |
| `contact.service.ts` | **Stub** (26 LOC) | 5 placeholder methods returning string literals. Zero domain logic. No DI. | Wire `@InjectRepository(ContactEntity)`, `Resend` client (via a thin `EmailService` wrapper), and the `EventEmitter2` listener. `create(dto)` persists + emits; `findAll(query)` paginates; `markRead(id)` updates `status`. |
| `contact.module.ts` | **Stub** (9 LOC) | Empty `@Module({ controllers, providers })`. No `TypeOrmModule.forFeature`, no `EventEmitterModule`, no config wiring. | `imports: [TypeOrmModule.forFeature([ContactEntity])]` + `EventEmitterModule.forRoot()` (or import from `AppModule`). Export `ContactService` if a CLI seed is added. |
| `contact.controller.spec.ts` | **Stub** (20 LOC) | Smoke test "should be defined". | Will need to assert the 3 real routes, the `@UseGuards(JwtAuthGuard)` on admin, and the throttler on public POST. |
| `contact.service.spec.ts` | **Stub** (18 LOC) | Smoke test "should be defined". | Will need a full behavior suite: persist + emit, status transitions, `email_sent_log` flip on Resend ack vs error, admin list filter. |
| `dto/create-contact.dto.ts` | **Empty** (1 LOC) | `export class CreateContactDto {}` | Real DTO with `name` (required, maxLength 100), `email` (required, `@IsEmail`), `subject` (optional, maxLength 200), `message` (required, min 10, max 5000). `@ApiProperty` for Swagger. |
| `dto/update-contact.dto.ts` | **Empty** (4 LOC) | `PartialType(CreateContactDto)` — broken because parent is empty. | Real DTO for `PATCH /admin/contacts/:id`: only `status` (`pending` / `read` / `replied`), `isRead` flag, or `email_sent_log` boolean. Probably a `MarkContactReadDto` with a single `status` field. |
| `entities/contact.entity.ts` | **Empty** (1 LOC) | `export class Contact {}` — not even a TypeORM entity. | `@Entity("contacts")` mirroring DBML lines 58–67: `id` (uuid PK), `name` (varchar), `email` (varchar), `subject` (varchar, nullable), `message` (text), `status` (varchar, default 'pending'), `emailSentLog` (boolean, default true), `createdAt` (timestamp). Snake-case via `@Column({ name })` per the `review.entity.ts` precedent. |

**Pre-existing test state to flag for apply/verify**: both `*.spec.ts` files
are smoke-only and pass trivially today. They do not constitute coverage of any
real behavior. `npm test` will pass for `contact.*.spec` because they have no
assertions beyond `toBeDefined()`. They will need to be REPLACED, not merely
extended, in apply/verify — the proposal should call this out so verify does
not mistake the smoke test for a passing test.

**No `src/common/email/` or `src/common/resend/` exists.** The Resend SDK is in
`node_modules` but no wrapper is in the source tree. The proposal must add the
wrapper.

**No migration for `contacts` exists in `src/database/migrations/`.** Only
`20260618205116-create-projects-and-project-urls.ts` and
`20260620020316-create-reviews-and-review-comments.ts` are present. The
`contacts` table is referenced in the DBML but is NOT in Postgres yet — this
domain owns the first migration that creates the `contacts` table.

## 3. Existing specs (verbatim) and DBML

### 3.1 `openspec/specs/server_specs.md` §3.4 (Contact Domain)

The canonical spec says (lines 60–77):

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

Notes:
- The `GET /api/v1/admin/contacts` line has a stray trailing period before the
  newline — cosmetic only.
- "Status" and "read/replied" are mentioned but the spec does not enumerate the
  exact `status` enum values; the DBML picks `pending` / `read` / `replied`.
- "Updates the contact record (email_sent_log) confirming the dispatch" —
  `email_sent_log` is a **boolean** in the DBML, not a separate audit table.
  This contradicts the user intent "almacenar los registros de los correos
  enviados" (store records of the emails sent). See §Open questions.

### 3.2 `openspec/specs/server_specs.md` §4 (env vars, relevant portion)

> Required variables: `PORT, DATABASE_URL, JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN, SUPERUSER_EMAIL, SUPERUSER_PASSWORD, RESEND_API_KEY, FRONTEND_URL`.

- `RESEND_API_KEY` is **already required** by the Joi schema. The
  `env.config.ts` validates it (`Joi.string().required()`) and the
  `env.config.spec.ts` smoke-tests cover it. No `RESEND_FROM_ADDRESS`,
  `RESEND_TO_ADDRESS`, or `RESEND_WEBHOOK_SECRET` is yet declared.
- `RESEND_API_KEY` is referenced in the canonical Joi schema even though no
  Resend client has been instantiated. This is a **forward-compat** wiring
  already in place.

### 3.3 `openspec/specs/database-schema.dbml` lines 58–67

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

- 8 columns, no FK, no index.
- The `email_sent_log` note is in Spanish and reads "Verifica si Resend
  procesó el correo" — i.e. "Verifies whether Resend processed the email".
  So the boolean tracks "Resend accepted the send" (i.e. Resend returned a
  `data.id`), **not** "Resend delivered the email" (delivered requires a
  webhook event).
- The `status` enum is documented only as a `note`. There is **no DB CHECK
  constraint**; the DTO and the service are the only gates.
- No `updated_at` column. The `PATCH /admin/contacts/:id` route in the spec
  implies a status mutation but the DBML has no `updated_at`. The proposal
  may need to add one (mirroring `reviews` which has only `created_at`).

### 3.4 Spec gaps to flag for proposal

- No anti-spam requirement (no rate limit, no captcha, no honeypot).
- No attachment support in the spec (probably no, but not explicit).
- No DELETE route in the spec (only GET + PATCH on the admin side).
- No "reply" semantics — the PATCH only marks "read/replied" but does not
  send a reply email.
- No webhook for delivery confirmation; the boolean is a "Resend accepted"
  flag, not a "Resend delivered" flag.

## 4. Reference-domain patterns (do not copy blindly)

### 4.1 `src/reviews/` — closest sibling

- **Layout**: `src/reviews/{dto,entities,reviews.controller.ts,reviews-admin.controller.ts,reviews.service.ts,reviews.module.ts,*.spec.ts,throttle.decorator.ts}`. Colocated `*.spec.ts` for entities, DTOs, controller, service.
- **Entity shape**: `@Entity("reviews")` with snake-case columns via `@Column({ name })`, `createdAt` via `@CreateDateColumn`. Registered in `src/data-source.ts` `entities` array AND in `ReviewsModule.imports` via `TypeOrmModule.forFeature([...])`.
- **Two controllers** in the same module (per `reviews-domain` ADR-6): public + admin. Admin is class-level `@UseGuards(JwtAuthGuard)` + `@ApiBearerAuth()`. Public is unprotected.
- **Throttler**: per-route via custom decorator factories in `src/reviews/throttle.decorator.ts` (`ThrottledWrite()` / `ThrottledRead()`) reading env vars via `process.env` (decorators run before DI). `ThrottlerModule` is registered ONCE in `AppModule` via `forRootAsync`; `ThrottlerGuard` is **not** a global `APP_GUARD`. The contact domain should mirror this if a per-IP rate limit is added (see §Open questions).
- **Migration**: hand-written, reversible, with `IF NOT EXISTS` safety nets, registered via the `migrations` glob in `src/data-source.ts`.
- **Response envelope**: `{ data, total, page, pageSize }` for paginated lists. Single-object responses return the entity DTO directly.
- **Service style**: `@InjectRepository(Entity)` per entity. No `DataSource` injection for this domain (no transactions). Hard delete on admin side relies on FK `ON DELETE CASCADE` at the DB layer (the reviews example does not have a child FK, so it does not test the cascade pattern — but `project_urls` does, and that migration sets `ON DELETE CASCADE` on `project_id`).
- **Swagger**: `@ApiTags("reviews")` at the class level, `@ApiBearerAuth()` on each protected method, `@ApiOperation` + `@ApiResponse` on every route.
- **Tests**: `reviews.service.spec.ts` and `reviews.controller.spec.ts` use `Test.createTestingModule` with a `TestFakesModule` `@Global()` block providing `useValue: {}` repository fakes. The `ReviewsAdminController` spec asserts via static metadata inspection that NO `@Throttle()` decorator is applied to any method (per ADR-4: admin is unthrottled).
- **e2e**: `test/reviews.e2e-spec.ts` (mirror precedent for the contact e2e).

### 4.2 `src/auth/` — JWT identity

- `JwtAuthGuard` is a method/class-level guard (`src/auth/guards/jwt-auth.guard.ts`). Never registered as global `APP_GUARD`. The reviews-domain spec locks this as a project-wide rule; the contact domain must inherit it.
- Bearer token from the `Authorization: Bearer <token>` header (verified at `main.ts:80` `addBearerAuth()`). No cookies on the contact admin surface.

### 4.3 `src/projects/` — file upload / external integration

- The projects domain has no external integration today. It does, however, use `DataSource` injection in `projects.service.ts` for the transactional create (the DIFF `urls` write needs to be atomic with the project row). The contact domain does **not** need `DataSource` unless a DBML delta makes the contact + sent-email writes atomic. Currently, both writes are to the same `contacts` row (insert + update of `email_sent_log`), which TypeORM handles via `Repository.save` without an explicit transaction. **Recommendation**: no `DataSource` injection unless the proposal splits into a `contacts` + `sent_emails` table (see §Open questions).

### 4.4 `src/common/with-retry.ts`

- A `withRetry(fn)` wrapper exists for Postgres transactions (per the prior
  `auth-refresh-retry` change, `src/common/with-retry.ts:1-68`). The wrapper
  retries on `40001` (serialization failure) and `40P01` (deadlock). The
  reviews service explicitly does **not** use it (no transaction; the
  withRetry is for the auth refresh-token rotations, which the user
  distinguished in a prior turn). For contact, the only candidate
  transactional write is the `INSERT INTO contacts` + `UPDATE contacts SET
  email_sent_log = ...` pair — and since both target the same row, a single
  `Repository.save` is sufficient. **Recommendation**: do not introduce
  `withRetry` for this domain unless the proposal expands the schema.

## 5. Resend SDK findings (context7)

Sources: `/resend/resend-node` (the Node.js SDK) and `/websites/resend` (the
Resend docs site). Resend Node.js SDK is **already installed** in this
project at `resend ^6.12.4`.

### 5.1 Install + import

```
// Already in package.json. No install step required.
import { Resend } from "resend";
```

### 5.2 Client constructor

```ts
const resend = new Resend(process.env.RESEND_API_KEY);
```

The API key is read once at construction. No other constructor options.

### 5.3 `emails.send` / `emails.create` payload

`send` is an alias for `create`. The payload is a discriminated union on
`text | html | react`. For the contact form (vanilla HTML, no React
Email), the shape is:

```ts
const { data, error } = await resend.emails.send({
  from: "Roonder Portfolio <hello@roonder.dev>", // friendly-name form
  to: ["admin@roonder.dev"],                       // string | string[]
  subject: "New contact form submission",
  html: "<p>...</p>",
  text: "...",          // plain-text fallback (recommended; auto-generated from html if omitted)
  replyTo: "jane@visitor.com", // string | string[] — visitor's email, so "Reply" goes to them
  headers: { "X-Contact-Id": contactId },
  tags: [
    { name: "domain", value: "contact-form" },
    { name: "env", value: "production" },
  ],
  scheduledAt: undefined, // optional ISO-8601
  attachments: undefined, // optional; see §Open questions
});
```

Notes from the docs:
- `to` is `string | string[]` with a hard cap of **50 addresses** per send.
- `from` accepts the friendly-name form `"Name <email@domain.com>"`.
- The `replyTo` field uses **camelCase** in the current SDK; older
  documentation may show `reply_to` (snake_case). The TypeScript types
  enforce camelCase.
- `headers` is an arbitrary key-value bag; Resend forwards them.
- `tags` is a flat `Array<{ name, value }>` and shows up in the Resend
  dashboard for filtering.

### 5.4 Response shape

```ts
type CreateEmailResponse = { data: { id: string } } | { data: null; error: { name: string; message: string; statusCode: number } };
```

The SDK returns a discriminated `{ data, error }` shape (NOT a thrown
exception on API errors). The caller MUST check `error` first. The `id`
in `data.id` is the Resend-assigned email id; the proposal should store
it on the `contacts` row (the current DBML has no such column — see
§Open questions).

### 5.5 Error codes (subset, the ones likely to surface here)

```
missing_api_key        — RESEND_API_KEY env var was empty.
invalid_api_key        — API key is wrong or revoked.
restricted_api_key     — key lacks the emails:send scope.
validation_error       — payload failed server-side validation (e.g. unverified from address).
invalid_from_address   — from domain not verified in Resend dashboard.
missing_required_field — payload missing from / to / subject / body.
rate_limit_exceeded    — Resend per-second quota hit.
monthly_quota_exceeded — out of monthly send quota.
internal_server_error  — 5xx from Resend.
```

For this domain, the most likely to fire are `invalid_from_address` (until
the operator verifies a domain) and `rate_limit_exceeded` (if abused).

### 5.6 Webhooks (delivery confirmation)

Resend supports webhook delivery events: `email.sent`, `email.delivered`,
`email.opened`, `email.clicked`, `email.bounced`, `email.complained`. The
SDK exposes `resend.webhooks.verify({ payload, headers, webhookSecret })`
for signature verification using the standard `webhook-id` /
`webhook-timestamp` / `webhook-signature` headers (svix-style).

**The current DBML `email_sent_log boolean` is a "Resend accepted" flag,
not a "Resend delivered" flag.** A proper delivery log requires the
webhook flow + a separate `sent_emails` (or `email_delivery_events`)
table. See §Open questions for whether the proposal should expand scope.

### 5.7 Recommended client wrapper shape

The proposal should add a thin `EmailService` (or `ResendEmailService`)
under `src/contact/email/` (NOT under `src/common/email/`, since only
contact uses it today). The shape:

```ts
@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly to: string;
  constructor(config: ConfigService<EnvConfig>) {
    this.resend = new Resend(config.get("RESEND_API_KEY", { infer: true }) as string);
    this.from = config.get("RESEND_FROM_ADDRESS", { infer: true }) as string;
    this.to = config.get("RESEND_TO_ADDRESS", { infer: true }) as string;
  }
  async sendContactNotification(input: { contact: ContactEntity }): Promise<{ id: string } | { error: ResendError }> {
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to: [this.to],
      replyTo: input.contact.email,
      subject: `[Contact] ${input.contact.subject ?? "(no subject)"}`,
      html: renderContactEmailHtml(input.contact),
      text: renderContactEmailText(input.contact),
      headers: { "X-Contact-Id": input.contact.id },
      tags: [{ name: "domain", value: "contact-form" }],
    });
    if (error || !data) return { error };
    return { id: data.id };
  }
}
```

The wrapper returns a tagged result so the `ContactService` (or the
event handler) can flip `email_sent_log` without catching exceptions.

### 5.8 `EventEmitter2` — NOT installed

`@nestjs/event-emitter` is **not** in `package.json` and not in
`node_modules`. The spec mandates this for the async dispatch. The
proposal will need to add it (`npm i @nestjs/event-emitter`) and wire
`EventEmitterModule.forRoot()` in `AppModule` (or in `ContactModule`).
Mirrors the `EventEmitter2` mention in `server_specs.md` §3.4.

## 6. HTML email best practices (context7)

Sources: `/resend/react-email` (Resend's own React Email library) +
`/websites/resend` (Resend docs). The "vanilla" instruction from the
user maps cleanly onto the **plain-HTML path** of the React Email
guidance, sans React. The below is the synthesized skeleton.

### 6.1 Doctype

Always XHTML Transitional — most email clients expect it:

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
```

### 6.2 Skeleton (vanilla, table-based, no React)

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"
  "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New contact form submission</title>
  </head>
  <!-- Preheader: hidden in body, shows in inbox preview -->
  <body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#222;">
    <span style="display:none;font-size:1px;color:#f5f5f5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      New contact form submission from {{name}} — {{subject}}
    </span>
    <!-- Outer wrapper: 100% width, sets background -->
    <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <!-- 600px content column -->
          <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e5e5e5;">
            <tr>
              <td style="padding:24px 24px 8px 24px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;line-height:24px;font-weight:bold;color:#111;">
                  New contact form submission
                </h1>
                <p style="margin:0 0 12px 0;font-size:14px;line-height:20px;">
                  <strong>From:</strong> {{name}} &lt;{{email}}&gt;
                </p>
                <p style="margin:0 0 12px 0;font-size:14px;line-height:20px;">
                  <strong>Subject:</strong> {{subject}}
                </p>
                <p style="margin:16px 0 0 0;font-size:14px;line-height:20px;white-space:pre-wrap;">{{message}}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 24px 24px;border-top:1px solid #e5e5e5;">
                <p style="margin:0;font-size:12px;line-height:16px;color:#666;">
                  Submitted via the portfolio contact form. Reply directly to this email to respond to {{name}}.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

### 6.3 Safe CSS (use)

- `color`, `background-color`, `font-size`, `font-family`, `font-weight`,
  `line-height`, `text-align`, `text-decoration`.
- `margin`, `padding` (on `<td>` and `<p>`).
- `border`, `border-collapse`, `border-spacing`, `border-radius` (border-radius
  is unreliable in Outlook for Windows; accept that).
- `width` / `height` on `<table>`, `<td>`, `<img>`.
- `max-width` (with a fixed `width` on the parent table; Outlook ignores
  `max-width` but will respect `width`).
- `display: none` (for preheader; widely supported).
- `vertical-align` on `<td>`.
- Media query for dark mode: `@media (prefers-color-scheme: dark) { ... }`
  (works in Apple Mail + some web clients; ignored by Outlook; Gmail strips
  it from the head).

### 6.4 Risky / unsupported CSS (avoid)

- `display: flex` and `display: grid` (Outlook on Windows uses the Word
  rendering engine; no flex, no grid).
- `position: absolute` / `position: fixed` (Outlook strips).
- `transform`, `transition`, `animation`.
- `vh` / `vw` units (no support).
- Custom fonts via `@font-face` (Outlook strips). Stick to the font stack
  `Arial, Helvetica, sans-serif` (or `Georgia, serif` for body).
- Media queries for layout (`sm:`, `md:`, `lg:` style responsive
  breakpoints) — Gmail strips them, Outlook ignores them. Use a
  mobile-first single-column layout that works at 320px.
- Inline SVG / WEBP images — many clients don't render them. Use PNG or
  JPG.
- The `<style>` block in `<head>` — many clients strip it. **Inline
  styles on every element is the safe path.**

### 6.5 Preheader text

The preheader is the preview line in the inbox. The technique is a
`<span style="display:none; ...">` as the FIRST child of `<body>`, with
`max-height:0`, `max-width:0`, `opacity:0`, and `overflow:hidden`. The
content of the preheader should be the most informative one-liner about
the email (e.g. "New contact form submission from Jane — Question about
projects").

### 6.6 Plain-text fallback

`text:` field on the Resend payload. Always include it. Resend will
auto-generate a text version from the HTML if omitted, but the
auto-generated version is usually ugly (it strips tags blindly and runs
words together). Hand-write a 4–8 line text version. For the contact
form:

```
New contact form submission

From:    {{name}} <{{email}}>
Subject: {{subject}}

{{message}}

---
Submitted via the portfolio contact form.
Reply directly to this email to respond to {{name}}.
```

### 6.7 Image embedding (NOT needed for this domain, but FYI)

If the email needs the portfolio logo, embed via CID attachment and
reference with `<img src="cid:logo">`. Resend supports this. Total
email size SHOULD stay under **102 KB** to avoid Gmail clipping.

### 6.8 Outlook MSO conditional comments (optional)

If specific Outlook-only fixes are needed (e.g. for padding on `td`),
wrap them in `<!--[if mso]><table>...</table><![endif]-->`. For a
"vanilla" contact notification, this is rarely necessary. Skip unless
the design phase surfaces a real Outlook issue.

## 7. Open questions for proposal phase

These are blocking or clarifying. Listed in decreasing order of impact.

1. **Anti-spam on `POST /api/v1/contacts`.** The spec is silent. The reviews
   domain uses a per-IP throttler (`@nestjs/throttler`, `ThrottledWrite()`).
   Should the contact form mirror that pattern? If yes, this change will need
   to (a) add `CONTACT_THROTTLE_*` env vars to the Joi schema, (b) add
   `ThrottledWrite()` to the public `POST`, and (c) potentially generalize
   the throttler factory in `src/reviews/throttle.decorator.ts` (or duplicate
   it under `src/contact/`). **Recommendation: yes, mirror the reviews
   pattern.** Public forms with no rate limit are a spam vector.

2. **Sender / recipient address strategy.** Resend requires a verified
   domain for the `from` address. The current `RESEND_API_KEY` env var
   carries no companion for sender. The proposal needs to add at least:
   - `RESEND_FROM_ADDRESS` (e.g. `Roonder Portfolio <hello@roonder.dev>`).
   - `RESEND_TO_ADDRESS` (the inbox that receives notifications;
     could default to `SUPERUSER_EMAIL`, but better to keep it separate).
   - Optionally `RESEND_REPLY_TO_FALLBACK` (where to send if the
     visitor's email is malformed — but `replyTo: visitor.email` is the
     default and there's no need for a fallback in practice).
   The proposal should call this out as a **Joi schema addition**.

3. **Sent-email log shape — single boolean vs separate table.** The DBML
   has `email_sent_log boolean` (a "Resend accepted" flag on the contact
   row). The user said "almacenar los registros de los correos enviados"
   (store records of the emails sent). There are three coherent options:
   (a) keep the boolean (minimal change, matches DBML), (b) add a
   `resend_email_id varchar` column to the `contacts` table to store the
   Resend `data.id`, (c) split into a `sent_emails` table with FK to
   `contacts.id` and one row per send attempt (supports the webhook
   delivery-event flow too). **Recommendation: option (b) for this
   change** (minimal DBML delta, captures the Resend id for debugging).
   Option (c) is out of scope for this change unless the user explicitly
   wants delivery-event tracking now (it requires webhook plumbing).

4. **Should the contact form allow file attachments?** Probably no.
   Resend supports attachments, but the spec is silent, the form is a
   simple text area, and attachments are a malware vector. **Recommendation:
   no.** The DTO MUST NOT include an `attachments` field.

5. **Should the admin endpoint also let admin DELETE a contact?** The spec
   only mentions GET + PATCH. A DELETE is not strictly required for an MVP
   (the spec is the source of truth). **Recommendation: do not add it in
   this change.** Surface as a follow-up issue if the user wants it.

6. **"Replied" semantics.** The spec says `PATCH` "marks a contact as
   read/replied". This is a status flip on the DBML enum
   (`pending` / `read` / `replied`). Should the PATCH also trigger an
   outgoing reply email? **Recommendation: no** (the spec describes
   marking, not auto-replying). The admin can hit "Reply" in their own
   email client — the `replyTo` on the Resend send routes their reply
   back to the visitor.

7. **`updated_at` column on `contacts`.** The DBML has only `created_at`.
   The `PATCH` mutates `status` and would benefit from `updated_at`.
   **Recommendation: add `updated_at` to the migration** (mirrors the
   `reviews` precedent which also only had `created_at`, but the reviews
   domain does not have a PATCH route). This is a minor DBML delta.

8. **`@nestjs/event-emitter` dependency.** The spec mandates EventEmitter2
   but the package is not installed. The proposal must add
   `npm i @nestjs/event-emitter` to the dependency list. **This is a
   `package.json` change that flows into `package-lock.json` and the
   verify step.**

9. **Should the public POST be throttled by IP only, or also by some
   honeypot / hCaptcha?** The reviews domain has no captcha. The
   portfolio owner is the only admin; a 5-per-minute per-IP cap is
   probably sufficient. **Recommendation: throttler only.** Surface
   captcha as a follow-up if abuse happens.

10. **Seed data.** The reviews domain has `src/cli/seed-reviews.ts`. The
    contact domain probably does not need a seed (a contact is
    user-submitted, not curated). **Recommendation: do not add a seed.**

## 8. Out-of-scope risks

These are not blockers for the change but could derail it if ignored.

- **Verified domain dependency.** Resend WILL refuse to send from an
  unverified `from` address. The operator MUST verify the sending domain
  in the Resend dashboard before the first production deploy. **Action**:
  the proposal should call this out as a deployment prerequisite (not a
  code change). The `RESEND_FROM_ADDRESS` Joi validation should accept any
  string for now; the runtime check is Resend's, not ours.

- **Email-client CSS variance.** Even with the vanilla skeleton, Outlook
  for Windows renders table-based emails with quirks (padding on `<td>` is
  OK, padding on `<p>` is NOT; border-radius is unreliable; the
  `Arial, Helvetica, sans-serif` stack sometimes falls back to Times).
  **Action**: the design phase should plan to verify the email in Litmus
  or Email on Acid (or just Gmail + Outlook + Apple Mail manually) before
  the verify phase. The verify spec should include a static assertion
  that the email payload does NOT contain `<style>`, `display: flex`,
  or `@font-face`.

- **Rate limit + Resend quota.** A motivated bot can hit the public POST,
  blow through the per-IP throttler (the 5-per-minute window is reset per
  IP, so a botnet defeats it), and trigger Resend's `rate_limit_exceeded`
  or `monthly_quota_exceeded`. **Action**: the proposal should consider a
  global Resend-call throttler OR a CAPTCHA. The 5-per-minute per-IP cap
  is necessary but not sufficient.

- **PII retention.** The `contacts` table stores `name` and `email` in
  free text indefinitely. There is no retention policy in the spec. For
  a personal portfolio the risk is low, but the proposal should at
  minimum document the retention behavior (no auto-purge). **Action**:
  surface in the proposal; do not implement a retention job in this
  change.

- **Inbox deliverability.** A new sending domain with no warm-up may
  land in Gmail's spam folder for the first few sends. **Action**: not a
  code risk; out of scope for this change. Document in the proposal's
  "Operational notes" section.

- **`@nestjs/event-emitter` install on top of an active `dev` branch.**
  The branch `domain/contact` will be cut from `dev` (current HEAD
  `396c465`). Adding the dependency means a `package.json` +
  `package-lock.json` commit. The verify step MUST rebuild the lockfile
  cleanly. **Action**: note in the proposal that the install step is part
  of the change.

- **Test-environment Resend key.** Tests that exercise the email path
  MUST NOT call the real Resend API. The `EmailService` wrapper should
  be designed with a constructor-injectable client (or a
  `ResendServiceOptions` token) so unit tests can pass a fake. **Action**:
  the proposal should specify the DI shape; sdd-design should make the
  injection explicit.

- **Existing 2 contact `*.spec.ts` smoke tests are misleading.** They
  pass today, but they cover no behavior. The apply/verify phase should
  DELETE them and write proper specs, not extend them. **Action**:
  surface in the proposal so the apply phase doesn't accidentally keep
  the smoke tests as "passing coverage".

- **OpenSpec delta spec location.** The OpenSpec config (`config.yaml`
  line 26) says specs "Mirror the domain boundaries in
  openspec/specs/server_specs.md (Auth, Projects, Reviews, Contact)".
  The new delta spec MUST go to
  `openspec/changes/domain-contact/specs/contact-domain/spec.md` and
  be archived into `openspec/specs/contact-domain/spec.md` on archive.
  **Action**: confirm the path with the orchestrator at sdd-spec time.

- **Contact is the only domain that talks to an external network service
  in the request path.** Reviews and projects are pure DB. A network
  failure in Resend should NOT break the public POST (the spec
  specifically says "async event" — the HTTP request should return 201
  before the email send completes, and the email should be retried
  separately). **Action**: the proposal should lock the contract that
  `POST /api/v1/contacts` returns 201 even if the Resend call ultimately
  fails; the `email_sent_log` is the audit trail.

## 9. Skill resolution

Loaded exactly three skills via path injection from the orchestrator's
launch prompt:

1. `~/.config/opencode/skills/sdd-explore/SKILL.md` — phase workflow contract.
2. `~/.config/opencode/skills/_shared/SKILL.md` — index only; the underlying
   `sdd-phase-common.md`, `openspec-convention.md`, `persistence-contract.md`,
   `sdd-status-contract.md`, `engram-convention.md`, and `skill-resolver.md`
   were read from the same directory.
3. `~/.config/opencode/skills/typescript/SKILL.md` — TS conventions.

Skill resolution: `paths-injected` (all three skills were specified by exact
path in the orchestrator's "Skills to load BEFORE work" block).

## 10. Estimated size of the change (rough)

| Layer | Count | LOC (rough) |
| --- | --- | --- |
| Entity | 1 (`ContactEntity`) | 60 |
| DTOs | 3–4 (`CreateContactDto`, `MarkContactReadDto`, `ContactResponseDto`, optional `ListContactsQueryDto` + `ListContactsResponseDto`) | 150 |
| Service | 1 (`ContactService`) with 3 methods + event handler | 150 |
| Email wrapper | 1 (`EmailService`) + 2 renderers (HTML + text) | 200 |
| Event classes | 2 (`ContactCreatedEvent`, listener) | 40 |
| Controllers | 2 (public + admin) | 130 |
| Module | 1 (`ContactModule`) | 25 |
| Migration | 1 (hand-written, `contacts` table + indexes + `updated_at`) | 80 |
| `data-source.ts` update | register `ContactEntity` | 5 |
| `app.module.ts` update | `EventEmitterModule.forRoot()` | 5 |
| `env.config.ts` update | `RESEND_FROM_ADDRESS`, `RESEND_TO_ADDRESS`, throttler env vars | 30 |
| Spec + colocation | entities spec, DTO specs, controller spec, service spec, e2e | 400 |
| `src/contact/README.md` (recommended) | endpoints + error envelope | 60 |

**Realistic lower bound**: ~700 LOC. Upper bound (with seed, README,
e2e): ~1 100 LOC.

**400-line review budget risk: HIGH.** This change will exceed the
single-PR soft cap. **Recommendation**: at sdd-tasks, forecast the
deliverable work units and propose either (a) chained PRs (split by
phase: foundations → public write → admin → email pipeline → verification)
or (b) an explicit maintainer exception for a single oversized PR. The
400-line budget is a soft cap, and the user-locked pattern in
`reviews-domain` was a single trunk-based commit-range — but that was
~1 950 LOC over many small commits. The contact change is materially
smaller and could fit in a single PR if the proposal commits to a
lean scope (no seed, no README, no separate sent_emails table, no
captcha). At sdd-tasks time, the decision must be re-evaluated.

## 11. What I did NOT explore

- **No test runs.** `npm test`, `npm run test:e2e`, `npm run build` were
  not executed. This is exploration only.
- **No real Postgres.** Per the precedent in
  `20260620020316-create-reviews-and-review-comments.ts`, there is no live
  DB in the dev environment. The migration is hand-written; a `docker run`
  verification step is referenced in that file's comments and would apply
  identically here.
- **No real Resend account.** The current `RESEND_API_KEY` in
  `env.config.spec.ts` is `re_test` (a literal). No live send was
  attempted.
- **No review of `AllExceptionsFilter` for the Resend-error mapping.**
  The `EmailService` returns a tagged `{ id } | { error }` result. The
  `ContactService` event handler will need to decide what to do on
  `error` (log + flip `email_sent_log` to `false`; the global filter
  never sees this path). This is a design-phase concern, not an
  exploration concern.
- **No review of `seed-superuser.ts` and `seed-reviews.ts` for CLI
  patterns.** Read at a high level only; if a contact seed is added
  (unlikely per §Open question 10), it would mirror these.
- **No review of the UI spec for the contact form's frontend.** The
  `openspec/specs/ui_specs.md` was not opened. The backend scope is
  unaffected.
- **No review of `with-retry.spec.ts` for the retry contract.** The
  contact service does not use `withRetry` (no transaction); this is
  stated but not deep-dived.
- **No commit / branch plan.** That is `sdd-tasks`'s job. This file is
  deliberately read-only.
- **No exploration of admin auth refresh interaction.** If the admin's
  refresh token is mid-rotation when they hit `GET /admin/contacts`,
  the `JwtAuthGuard` will 401 (per the auth-refresh-retry spec). This
  is the auth-domain's concern, not the contact domain's; not explored
  further.

## 12. Recommended next step

`sdd-propose`, gated on the following clarifications (the user must
answer before the proposal phase can write a non-speculative proposal):

1. Anti-spam stance: per-IP throttler (mirror reviews), no protection,
   or captcha.
2. Sender / recipient address env var strategy (`RESEND_FROM_ADDRESS`
   + `RESEND_TO_ADDRESS`).
3. Sent-email log shape (boolean only, add `resend_email_id`, or
   separate `sent_emails` table).
4. `updated_at` on `contacts` (yes / no).
5. `@nestjs/event-emitter` install acceptance (this is a
   `package.json` change).

Items 1, 2, 3 are blocking. Items 4, 5 can be defaulted by the proposal
(4 = yes, 5 = yes) and the user can override at design time.

A `state.yaml` for the DAG should mark this change as
`phase: explore-complete` and the next pending phase as `sdd-propose`
with the gating questions above as the inputs the user must answer
first.
