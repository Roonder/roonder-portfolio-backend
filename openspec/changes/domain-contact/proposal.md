# Proposal: domain-contact (Contact Domain — Resend-backed public form)

## 1. Metadata

| Field | Value |
| --- | --- |
| Change name | `domain-contact` |
| Branch | `domain/contact` (cut from `dev` at apply time) |
| Status | proposed |
| Date | 2026-06-23 |
| Project | `roonder-portfolio-backend` |
| Owner | user (single-admin portfolio) |
| Artifact store | openspec |
| Planning home | `openspec/changes/domain-contact/` |
| Strict TDD | ACTIVE (`openspec/config.yaml > rules.apply.tdd: true`) — applies/verify follow red-green-refactor |
| Review budget | 400 changed lines per PR (soft cap) — **HIGH RISK** per explore forecast 700–1100 LOC |

## 2. Why (intent)

The Contact domain is the **last domain** required to ship a portfolio backend. The user wants visitors of the portfolio site to be able to send a contact message; the server must (a) validate the form, (b) persist the message, (c) send two emails via **Resend** (one notification to the operator, one auto-reply to the visitor), and (d) log every send attempt in the database for audit. Email HTML must stay **vanilla** (minimal CSS, table-based) because email-client CSS support is poor. User intent (verbatim, Spanish):

> *"implementar el último dominio restante: domain/contact ... Configurar un email de contacto sencillo. Configurar los servicios para utilizar Resend como motor de envío de emails. Y almacenar los registros de los correos enviados en la DB ... el email se maneje lo más 'vanilla' posible, al saber que sus estilos son muy malos."*

## 3. User-facing outcome

A portfolio visitor can now submit a contact form from the public site; the message is stored, the operator receives a notification email, and the visitor receives a confirmation auto-reply — without the visitor ever knowing the delivery mechanism. The operator can list and mark messages read/replied from a JWT-protected admin endpoint. The portfolio backend is now feature-complete (auth + projects + reviews + contact).

## 4. Scope (in)

- `POST /api/v1/contacts` — public, throttled per-IP, validates body, persists a `contacts` row, emits a NestJS `EventEmitter2` event, returns **201** with the canonical success envelope.
- `GET /api/v1/admin/contacts` — JWT-protected, paginated list of submitted messages.
- `PATCH /api/v1/admin/contacts/:id` — JWT-protected, transitions `status` (`pending` / `read` / `replied`).
- A new `sent_emails` table that records every Resend send attempt (one row per email: owner notification + visitor auto-reply).
- A `Resend`-backed `EmailService` wrapper called from the event listener, with a constructor-injectable client for unit-testability.
- Two vanilla HTML + plain-text email renderers (owner notification + auto-reply), XHTML Transitional, table-based, no `<style>` block, no `display: flex`, no `@font-face`.
- Joi env schema additions: `RESEND_FROM_ADDRESS`, `RESEND_TO_ADDRESS`, `CONTACT_THROTTLE_*` (mirror reviews pattern).
- Migration that creates the `contacts` table and the `sent_emails` table, with snake-case columns, an `updated_at` on `contacts`, and a down-step that recreates the dropped `email_sent_log` boolean.
- `@nestjs/event-emitter` as a new runtime dependency, with `EventEmitterModule.forRoot()` registered in `AppModule`.
- **Replacement** (not extension) of the existing `src/contact/*.spec.ts` smoke-only tests with real TDD coverage (controller, service, email wrapper, event listener, DTOs, entity, e2e).

## 5. Scope (out / non-goals)

- Resend webhook receiver for delivery events (`email.delivered` / `bounced` / `complained`).
- Admin UI / dashboard.
- hCaptcha / honeypot / advanced anti-spam (per-IP throttler only).
- File attachments on the contact form.
- `DELETE /api/v1/admin/contacts/:id` (not in canonical spec).
- Auto-replying to a contact from the admin PATCH (the spec only marks status; the operator replies via their own email client thanks to `replyTo`).
- Seed CLI for the contact domain.
- A separate `src/common/email/` — wrapper lives under `src/contact/email/` since only this domain uses it today.

## 6. User-confirmed decisions (2026-06-23 preflight)

| # | Decision | Source |
|---|----------|--------|
| 1 | **Per-IP throttler** on `POST /api/v1/contacts`, mirror reviews pattern (3 env vars + disable knob via `limit = 1_000_000`). | confirmed by user |
| 2 | **NEW `sent_emails` table** with `id`, `subject`, `from`, `to`, `resend_id`, `status` (enum: `accepted` / `failed`; room for `delivered` / `bounced` / `complained`), `kind` (enum: `contact_notification` / `contact_auto_reply`), `error_message`, `created_at`, `updated_at`. | confirmed by user |
| 3 | **Two emails per submission** (owner notification + sender auto-reply) via the same `EmailService`, both logged with distinct `kind`. | confirmed by user |
| 4 | **Env vars** `RESEND_FROM_ADDRESS` + `RESEND_TO_ADDRESS` added to Joi; `.env.example` (or equivalent) placeholders + `# REEMPLAZAR CUANDO SE COMPRE EL DOMINIO` comment. | confirmed by user |
| 5 | `POST /api/v1/contacts` is **public** (no auth), throttled per IP. | confirmed by user |
| 6 | **Form fields**: `name` (string, required, 1–100), `email` (string, required, valid email), `subject` (string, required, 1–150), `message` (string, required, 1–5000). | confirmed by user |
| 7 | **Error handling on Resend failure**: log to `sent_emails.error_message`, return 201 with success envelope (no 500 leak). | confirmed by user |

## 7. Current state

- `src/contact/` is the untouched NestJS CLI scaffold: empty `ContactService` returning string literals, controller with 5 placeholder routes (including a `+id` numeric-id bug), empty DTOs, a `Contact` class that is not even a `@Entity()`, and **two smoke-only `*.spec.ts` files that pass via `toBeDefined()` and cover no behavior**.
- No migration for `contacts` exists in `src/database/migrations/`; this domain owns the first `contacts` migration.
- No `src/common/email/` or Resend wrapper exists; the SDK is in `node_modules` but unused.
- `RESEND_API_KEY` is already required by the Joi schema (forward-compat). No `RESEND_FROM_ADDRESS` / `RESEND_TO_ADDRESS` / throttler knobs are declared yet.
- `@nestjs/event-emitter` is **not** installed (spec §3.4 mandates it).
- `database-schema.dbml` lines 58–67 define a `contacts` table with `email_sent_log boolean` — this **contradicts the user intent** ("store records of the emails sent"). The boolean will be **removed** and replaced by a new `sent_emails` table (destructive change, see §10).
- Full audit at `openspec/changes/domain-contact/explore.md` §2.

## 8. Deltas vs. canonical spec

| # | Source | Was | Now |
|---|--------|-----|-----|
| 1 | `server_specs.md` §3.4 — sent-email audit shape | "Updates the contact record (email_sent_log) confirming the dispatch." | New `sent_emails` table. `email_sent_log` boolean on `contacts` is **removed**. Every send attempt writes one row. |
| 2 | `server_specs.md` §3.4 — async event | "Emits an asynchronous event (NestJS EventEmitter2) to trigger the email service." | Unchanged in contract; `EventEmitter2` is wired via the new `@nestjs/event-emitter` dep. |
| 3 | `server_specs.md` §3.4 — error handling on Resend failure | (silent) | When one or both Resend sends fail, the failure is logged to `sent_emails.error_message`; the public `POST` still returns 201 with the success envelope. |
| 4 | `server_specs.md` §3.4 — auto-reply | (silent — not in canonical spec) | Visitor receives a short auto-reply email. Adds a new outbound channel not explicitly in §3.4. |
| 5 | `server_specs.md` §3.4 — anti-spam | (silent) | Per-IP throttler on the public `POST` (3 env vars + disable knob, mirror reviews). |
| 6 | `database-schema.dbml` lines 58–67 | `Table contacts { … email_sent_log boolean … }` (no `updated_at`) | `email_sent_log` column is **dropped**. `updated_at` is **added**. New `Table sent_emails { … }` (9 columns) is **added**. **DESTRUCTIVE DBML DELTA — explicit user confirmation required.** |
| 7 | `server_specs.md` §4 (env vars) | Required: `… RESEND_API_KEY …` | `RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS` are **added as required**. `CONTACT_THROTTLE_TTL_MS`, `CONTACT_THROTTLE_WRITE_LIMIT`, `CONTACT_THROTTLE_READ_LIMIT` are **added with defaults** (mirror reviews). |
| 8 | `package.json` | `@nestjs/event-emitter` not present | **Added** as a runtime dependency. |

## 9. Acceptance criteria

- [ ] `POST /api/v1/contacts` accepts a valid body, persists a `contacts` row, emits an event, returns 201 with the canonical success envelope. A subsequent `GET /api/v1/admin/contacts` lists that row.
- [ ] `POST /api/v1/contacts` returns 400 with the canonical error envelope on invalid body (missing field, malformed email, oversize field, etc.).
- [ ] `POST /api/v1/contacts` is throttled per-IP at the configured `CONTACT_THROTTLE_WRITE_LIMIT` and returns 429 with the canonical envelope + `Retry-After` when exceeded.
- [ ] `POST /api/v1/contacts` returns **201** even when the Resend send fails (failure is recorded in `sent_emails.error_message`; the operator audits via the DB).
- [ ] When the Resend send succeeds, **two** rows appear in `sent_emails` for one submission: `kind = contact_notification` and `kind = contact_auto_reply`, each with a non-null `resend_id` and `status = accepted`.
- [ ] When the Resend send fails, the corresponding row is recorded with `status = failed` and a non-null `error_message`.
- [ ] `GET /api/v1/admin/contacts` returns 401 without a valid JWT; returns 200 with a paginated list with a valid JWT.
- [ ] `PATCH /api/v1/admin/contacts/:id` transitions `status` and returns 404 on unknown id.
- [ ] All Resend calls in the test suite are stubbed (no real network).
- [ ] All non-DBML behaviors above are covered by unit + e2e tests (Strict TDD). The two pre-existing `*.spec.ts` smoke files are **replaced**, not merely extended.
- [ ] The Joi env schema rejects `CONTACT_THROTTLE_TTL_MS` < 1 000 ms (mirror reviews) and rejects a missing `RESEND_FROM_ADDRESS` / `RESEND_TO_ADDRESS`.
- [ ] The email HTML payload does NOT contain `<style>`, `display: flex`, `display: grid`, `@font-face`, or any `<style>` block (vanilla invariant).
- [ ] `npm test`, `npm run test:e2e`, and `npm run build` all pass green on a clean checkout (subject to a verified Resend sender domain for live smoke).

## 10. Risks and open dependencies

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| **Destructive DBML change** — `email_sent_log` boolean removed; replaced by a new `sent_emails` table. | Med | Flag explicitly to the user; migration is reversible (`down` recreates the boolean). Archive phase syncs the DBML delta. |
| **`@nestjs/event-emitter` install on top of an active `dev` branch** — `package.json` + `package-lock.json` change. | Low | The package is widely used; pin the version. Verify step must rebuild the lockfile cleanly. |
| **No verified Resend sender domain yet** — Resend will refuse to send from an unverified `from` address. | High (until domain is verified) | `.env.example` (or equivalent) carries a `# REEMPLAZAR CUANDO SE COMPRE EL DOMINIO` comment. This is a deployment gate, not a code change. |
| **400-line PR review budget is HIGH RISK** — explore forecast 700–1100 LOC. | High | `sdd-tasks` will re-evaluate and propose either (a) chained PRs (foundations → public write → admin → email pipeline → verification) or (b) an explicit maintainer exception for one oversized PR. The change is materially smaller than `reviews-domain` and could fit a single PR with a lean scope. |
| **Per-IP throttler is necessary but not sufficient** — a motivated botnet can still spam. | Med | The 5-per-minute per-IP cap blocks casual abuse; CAPTCHA is surfaced as future work. |
| **Pre-existing smoke-only specs are misleading** — they pass via `toBeDefined()` and cover no behavior. Verify could mistake them for passing coverage. | Med | Proposal explicitly states the apply phase must REPLACE them, not extend them. |
| **No `.env.example` file in the repo** — the user's instruction says "Update `.env.example`" but only a (gitignored) `.env` exists. | Low | Apply phase will CREATE `.env.example` with the placeholders + the `# REEMPLAZAR CUANDO SE COMPRE EL DOMINIO` comment. Minor deviation from the literal wording, matches project intent. |
| **Test-environment Resend key** — tests must never call the real Resend API. | Low | The `EmailService` wrapper accepts a constructor-injectable client (or `ResendServiceOptions` token) so unit tests can pass a fake. |
| **Inbox deliverability** — a new sending domain with no warm-up may land in Gmail's spam folder. | Low | Operational concern, not a code risk. |
| **PII retention** — `contacts.name` and `contacts.email` are stored indefinitely. | Low | Surface in the proposal; no retention job in this change. |

## 11. Out-of-scope (future work)

- **Resend webhook receiver** for delivery events (`email.delivered` / `bounced` / `complained`) to flip the `status` column on `sent_emails` from `accepted` to `delivered` / `bounced` / `complained`. Requires `RESEND_WEBHOOK_SECRET`, a `WebhookController`, and svix signature verification.
- **Admin endpoint to read `sent_emails`** as a paginated list (the admin currently sees only `contacts`).
- **hCaptcha / honeypot** for stronger anti-spam.
- **`DELETE /api/v1/admin/contacts/:id`** (not in canonical spec).
- **Auto-reply on `PATCH /admin/contacts/:id`** (the spec only marks status; the operator replies via their own email client thanks to `replyTo`).
- **Seed CLI** (`seed-contacts.ts`) — not needed since contacts are user-submitted, not curated.
- **PII retention job** (auto-purge after N days).

## 12. Skill resolution

`paths-injected`. The three required skills (`sdd-propose/SKILL.md`, `_shared/SKILL.md`, `typescript/SKILL.md`) were loaded directly from the orchestrator's launch prompt. The `sdd-propose` workflow contract was read first; the `_shared` index was read second; the `typescript` style guide was read third. No fallbacks were needed.
