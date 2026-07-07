# Tasks: `domain-contact` — Contact domain (Resend-backed public form)

## Metadata

| Field            | Value                                                                                          |
|------------------|------------------------------------------------------------------------------------------------|
| Change name      | `domain-contact`                                                                               |
| Branch           | `domain/contact` (cut from `dev` at apply time; current `dev` HEAD `396c465` = `domains/reviews`) |
| Status           | planned                                                                                        |
| Date             | 2026-06-23                                                                                     |
| Project          | `roonder-portfolio-backend` (NestJS 11 + TypeORM 1.x + PostgreSQL + JWT/passport + Joi + Resend + class-validator + Swagger) |
| Artifact store   | `openspec` (repo-local at `openspec/`)                                                         |
| Planning home    | `openspec/changes/domain-contact/`                                                             |
| Strict TDD       | ACTIVE — every task that adds production code carries a RED → GREEN → REFACTOR step            |
| Skill resolution | `paths-injected`                                                                               |

## Delivery strategy recap

One branch `domain/contact` cut from `dev`. **Work-unit commits, no chained PRs.**
The user handles the final PR themselves — no "create PR" task. The 4,220 LOC
forecast from the design is split across 27 work-unit-commit-sized tasks; the
user reviews commit-by-commit, not as one giant diff. The 400-line PR soft
cap is intentionally exceeded; this is a single-trunk deliverable. The
`chained-pr` skill is **not** used; the `work-unit-commits` skill governs.

```text
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: N/A
400-line budget risk: High (single branch by user decision)
```

## Phase plan

| Phase | Name                              | Tasks  | Theme                                                                     |
|-------|-----------------------------------|-------:|---------------------------------------------------------------------------|
| 0     | Branch & dependencies             | 2      | Cut branch from `dev`; install `@nestjs/event-emitter`                    |
| 1     | Config & envelope (cross-cutting) | 2      | Joi env vars; `.env.example`; `EventEmitterModule` + dual-throttler wiring |
| 2     | Database & schema                 | 4      | Migration (drop `email_sent_log`, add `updated_at`, create `sent_emails`); both entities; `data-source.ts` registration |
| 3     | DTOs & mapper                     | 5      | Request, response, query, status DTOs + pure-function mapper               |
| 4     | Domain core (service + event)     | 3      | `ContactCreatedEvent`; `ContactService.create` (persist + emit); list + status transition |
| 5     | Throttler & public HTTP           | 2      | `ThrottledContactWrite` decorator; public `ContactController` (POST + `@Throttle`) |
| 6     | Email pipeline                    | 4      | Resend client token; vanilla HTML+text templates; renderer; `EmailService` wrapper |
| 7     | Event flow & module wiring        | 2      | `ContactEmailListener` (`@OnEvent`); `ContactModule` (wires TypeORM + providers + `RESEND_CLIENT` factory) |
| 8     | Admin endpoints                   | 1      | `ContactAdminController` (GET + PATCH, JWT-guarded)                       |
| 9     | E2E & verification                | 2      | Public e2e (201, 400, 429, Resend-failure 201); admin e2e (401, 200, 404, 400) |
| **Total** |                               | **27** | Forecast ≈ 4,220 LOC across 27 work-unit commits                          |

## Review workload forecast

| Metric                  | Value                                                                      |
|-------------------------|----------------------------------------------------------------------------|
| Estimated changed lines | ≈ 4,220 (matches the design §13 forecast)                                   |
| 400-line budget risk    | High (single branch by user decision; not gated on per-PR)                |
| Chained PRs recommended | No (user-locked delivery strategy; commits ARE the review unit)            |
| Delivery strategy       | `single-pr` (user handles the final PR; no PR task in this list)           |
| Decision needed before apply | No (user locked strategy on 2026-06-23)                              |

## Suggested work units (per commit)

Each task below maps 1:1 to one conventional commit. The commit message draft
is included verbatim. Tests are colocated with the production code per project
convention; e2e lives in `test/`.

---

### Phase 0 — Branch & dependencies

#### Task 0.1 — Cut the `domain/contact` branch from `dev`
- **Files**: [NEW] `refs/heads/domain/contact` (git ref, not a file in the tree)
- **Type**: infra
- **TDD steps**: N/A (no production code change). The branch is the precondition.
- **Acceptance**: `git rev-parse --abbrev-ref HEAD` returns `domain/contact`; `git log -1` shows the tip of `dev` (`396c465` or whatever the current `dev` HEAD is at apply time) as the parent.
- **Estimated LOC**: 0
- **Depends on**: none
- **Commit message draft**: `chore(branch): cut domain/contact from dev`

#### Task 0.2 — Install `@nestjs/event-emitter` and pin the version
- **Files**: [MOD] `package.json`, `package-lock.json`
- **Type**: infra
- **TDD steps**: Not applicable as a code test. The contract is the dependency declaration + the lockfile entry. Verify after commit with `npm ls @nestjs/event-emitter` resolving to the pinned version.
- **Acceptance**: `package.json` `dependencies` block contains `"@nestjs/event-emitter": "<pinned>";`; `node_modules/@nestjs/event-emitter/package.json` exists; `npm install` is idempotent (no further lockfile churn).
- **Estimated LOC**: 1 (`package.json`) + auto-generated lockfile
- **Depends on**: 0.1
- **Commit message draft**: `chore(deps): add @nestjs/event-emitter runtime dep`

---

### Phase 1 — Config & envelope (cross-cutting)

#### Task 1.1 — Add Resend addressing + contact-throttler env vars to Joi + CREATE `.env.example`
- **Files**: [MOD] `src/config/env.config.ts`, [MOD] `src/config/env.config.spec.ts`, [NEW] `.env.example` (at repo root)
- **Type**: docs
- **TDD steps**:
  - **RED** (`src/config/env.config.spec.ts`): add 7 failing scenarios — `RESEND_FROM_ADDRESS` missing → Joi error; `RESEND_TO_ADDRESS` missing → Joi error; `RESEND_TO_ADDRESS=not-an-email` → Joi error; `RESEND_FROM_ADDRESS="Roonder Portfolio <hello@roonder.dev>"` accepted (friendly-name form); `CONTACT_THROTTLE_TTL_MS=500` → rejected (min floor 1_000); `CONTACT_THROTTLE_WRITE_LIMIT=0` → rejected (min floor 1); default round-trip returns `60_000 / 5 / 60` when none of the three contact env vars are set. Run `npm test -- env.config.spec` and see them fail.
  - **GREEN** (`src/config/env.config.ts`): extend `EnvConfig` interface with the 5 new fields; add the 5 `Joi.*` lines to `ENV_CONFIG` with the floors, `.email()` on `RESEND_TO_ADDRESS` (NOT on `RESEND_FROM_ADDRESS`, which accepts friendly-name form), and `.default()` values matching the spec defaults. Also add the 2 Resend vars to `baseValidEnv` in the spec so existing tests keep passing.
  - **REFACTOR**: clean up any duplicated test setup; consider extracting the `baseValidEnv` builder if it grows further.
- **Acceptance**: `npm test -- env.config.spec` is green; `ENV_CONFIG.validate({...baseValidEnvWithoutResendFromAndTo})` fails with a Joi error mentioning `RESEND_FROM_ADDRESS`; `ConfigService.get("RESEND_FROM_ADDRESS")` returns the full friendly-name string; `.env.example` exists at the repo root, contains placeholders for every env var (including the new 5), and has the literal comment `# REEMPLAZAR CUANDO SE COMPRE EL DOMINIO` adjacent to `RESEND_FROM_ADDRESS` and `RESEND_TO_ADDRESS`.
- **Estimated LOC**: 120 (env.config +30, env.config.spec +60, .env.example 30)
- **Depends on**: 0.2
- **Commit message draft**: `feat(env): add Resend addressing + contact throttler vars to Joi`

#### Task 1.2 — Wire `EventEmitterModule.forRoot()` + extend the throttler factory to read `CONTACT_THROTTLE_*`
- **Files**: [MOD] `src/app.module.ts`
- **Type**: infra
- **TDD steps**: No new test (cross-cutting wiring). The contract is asserted by the per-route `@Throttle` spec in task 5.1 + the e2e in 11.1. Before this commit, `EventEmitter2` is not injectable; after this commit, `EventEmitter2` is reachable from any module that imports `EventEmitterModule` or any module that receives it through the global module (the `forRoot()` registration in `AppModule` makes the events bus global).
- **Acceptance**: `npm run build` succeeds; the new `import { EventEmitterModule } from "@nestjs/event-emitter"` is in `src/app.module.ts`; `ThrottlerModule.forRootAsync` factory now reads `CONTACT_THROTTLE_TTL_MS` + `CONTACT_THROTTLE_WRITE_LIMIT` in addition to the existing `REVIEWS_THROTTLE_*` reads and returns the `Math.min(...)` of the two domains' values as the "default" tracker (so an operator who forgets to set a domain-specific env still gets a safe default; per-route `@Throttle` overrides still win).
- **Estimated LOC**: 15
- **Depends on**: 1.1
- **Commit message draft**: `feat(app): register EventEmitterModule + dual-domain throttler`

---

### Phase 2 — Database & schema

#### Task 2.1 — Hand-write the contacts/sent_emails migration
- **Files**: [NEW] `src/database/migrations/20260623000000-create-contacts-and-sent-emails.ts`
- **Type**: migration
- **TDD steps**: No unit test (the contract is the entities' column shape — tasks 2.2 + 2.3 — and `typeorm schema:log` against a live Postgres). Mirror the reviews precedent (`src/database/migrations/20260620020316-create-reviews-and-review-comments.ts`) for the hand-written-migration style.
- **Acceptance**: migration file has `up` (DROP `email_sent_log`, ADD `updated_at` to `contacts`, CREATE the two enums, CREATE `sent_emails` table, CREATE the 4 indexes incl. the partial unique on `resend_id`) and `down` (reverse order; recreates the dropped `email_sent_log boolean NOT NULL DEFAULT true` column on the `contacts` table). The migration is picked up by the `migrations` glob in `src/data-source.ts` (no edit needed there — same glob as reviews/projects).
- **Estimated LOC**: 120
- **Depends on**: 1.2
- **Commit message draft**: `feat(db): add contacts/sent_emails migration (drop email_sent_log, add updated_at)`

#### Task 2.2 — Replace the 1-LOC `Contact` stub with `ContactEntity` + colocation spec
- **Files**: [MOD] `src/contact/entities/contact.entity.ts` (was 1 LOC: `export class Contact {}`), [NEW] `src/contact/entities/contact.entity.spec.ts`
- **Type**: domain
- **TDD steps**:
  - **RED** (`contact.entity.spec.ts`): write 8 static-metadata assertions (mirror `src/reviews/entities/review.entity.spec.ts` pattern): (1) registers against `"contacts"` table; (2) declares exactly the 8 columns `id`, `name`, `email`, `subject`, `message`, `status`, `createdAt`, `updatedAt`; (3) `id` is `uuid` PK; (4) `status` defaults to `'pending'`; (5) `createdAt` is `@CreateDateColumn`; (6) `updatedAt` is `@UpdateDateColumn`; (7) snake-case mapping for `name → name` (kept), `subject → subject`, `email → email`, `message → message`, `status → status`, `createdAt → created_at`, `updatedAt → updated_at`; (8) **NO `emailSentLog` column** (the destructive change).
  - **GREEN** (`contact.entity.ts`): write the entity class with the 8 columns, snake-case via `@Column({ name })` for the timestamp + everything that TypeORM might camelcase, `@UpdateDateColumn({ name: "updated_at" })`, `@CreateDateColumn({ name: "created_at" })`, `subject` nullable.
  - **REFACTOR**: extract a small helper for the snake-case test data if needed; remove any dead imports.
- **Acceptance**: `npm test -- contact.entity.spec` is green; static-metadata test confirms no `emailSentLog` column exists; `@Entity('contacts')` is set.
- **Estimated LOC**: 200 (entity 80 + spec 120)
- **Depends on**: 2.1
- **Commit message draft**: `feat(contact): add ContactEntity with updated_at, no emailSentLog`

#### Task 2.3 — Add `SentEmailEntity` + colocation spec
- **Files**: [NEW] `src/contact/entities/sent-email.entity.ts`, [NEW] `src/contact/entities/sent-email.entity.spec.ts`
- **Type**: domain
- **TDD steps**:
  - **RED** (`sent-email.entity.spec.ts`): 7 assertions: (1) registers against `"sent_emails"` table; (2) declares the 10 columns in order; (3) `status` uses the `sent_emails_status_enum` native enum; (4) `kind` uses the `sent_emails_kind_enum` native enum; (5) `resendId` is nullable; (6) `errorMessage` is nullable; (7) snake-case mapping for `from → "from"`, `to → "to"`, `subject → "subject"`, `resendId → "resend_id"`, `status → "status"`, `kind → "kind"`, `errorMessage → "error_message"`, `createdAt → "created_at"`, `updatedAt → "updated_at"`. Also assert no FK to `contacts` (audit-only table; not relationally linked).
  - **GREEN** (`sent-email.entity.ts`): write the entity. Use TypeORM's `@Column({ type: "enum", enum: [...], name: "status" })` for the two enums; the migration's `CREATE TYPE` matches the values.
  - **REFACTOR**: define `SENT_EMAIL_KIND` and `SENT_EMAIL_STATUS` const objects + types (per the design §8 sketch) and use them in the `@Column({ enum })` declaration so the runtime + the TS type share one source of truth.
- **Acceptance**: `npm test -- sent-email.entity.spec` is green; spec scenario "Table exists with the documented columns" is locked.
- **Estimated LOC**: 210 (entity 110 + spec 100)
- **Depends on**: 2.1
- **Commit message draft**: `feat(contact): add SentEmailEntity + enums`

#### Task 2.4 — Register both entities in the shared `DataSource`
- **Files**: [MOD] `src/data-source.ts`
- **Type**: domain
- **TDD steps**: No new test. The contract is asserted by `typeorm schema:log` against a live Postgres (per the migration's header comment) and by the e2e (11.1) that builds a parallel app composition with the entities.
- **Acceptance**: `AppDataSource.options.entities` includes `ContactEntity` + `SentEmailEntity`; `npm run build` succeeds; the CLI seeds (which import `AppDataSource` from this file) keep type-checking.
- **Estimated LOC**: 10
- **Depends on**: 2.2, 2.3
- **Commit message draft**: `chore(data-source): register ContactEntity + SentEmailEntity`

---

### Phase 3 — DTOs & mapper

#### Task 3.1 — Add `CreateContactDto` (4 fields) + colocation spec; REPLACE the 1-LOC `CreateContactDto` stub
- **Files**: [MOD] `src/contact/dto/create-contact.dto.ts` (was 1 LOC: `export class CreateContactDto {}`), [NEW] `src/contact/dto/create-contact.dto.spec.ts`
- **Type**: domain
- **TDD steps**:
  - **RED** (`create-contact.dto.spec.ts`): 10+ scenarios mirroring `src/reviews/dto/create-review.dto.spec.ts` — accepts valid body; rejects missing `name`/`email`/`subject`/`message`; rejects bad email (`"not-an-email"`); rejects `name > 100`; rejects `subject > 150`; rejects `message > 5000`; rejects empty strings (length 0); rejects `phone`/`company`/`attachments` extra fields (`forbidNonWhitelisted`); rejects whitespace-only `message`.
  - **GREEN** (`create-contact.dto.ts`): 4 fields with `@IsString @IsNotEmpty @MinLength(1) @MaxLength(100) @ApiProperty` for `name`; `@IsEmail() @ApiProperty` for `email`; `@IsString @IsNotEmpty @MinLength(1) @MaxLength(150) @ApiProperty` for `subject`; `@IsString @IsNotEmpty @MinLength(1) @MaxLength(5000) @ApiProperty` for `message`. NO `phone`, NO `company`, NO `attachments`.
  - **REFACTOR**: import-order + group the decorators consistently.
- **Acceptance**: `npm test -- create-contact.dto.spec` is green; spec scenarios "Required fields are enforced", "Email must be a valid format", "Length bounds are enforced", "Extra fields are rejected" are all locked.
- **Estimated LOC**: 160 (dto 50 + spec 110)
- **Depends on**: 2.2
- **Commit message draft**: `feat(contact): add CreateContactDto with strict field validation`

#### Task 3.2 — Add `UpdateContactStatusDto` + colocation spec; DELETE the broken `update-contact.dto.ts` stub
- **Files**: [NEW] `src/contact/dto/update-contact-status.dto.ts`, [NEW] `src/contact/dto/update-contact-status.dto.spec.ts`, [DEL] `src/contact/dto/update-contact.dto.ts` (the broken `PartialType(CreateContactDto)`)
- **Type**: domain
- **TDD steps**:
  - **RED** (`update-contact-status.dto.spec.ts`): 5 scenarios — accepts `{ status: "pending" }`; accepts `{ status: "read" }`; accepts `{ status: "replied" }`; rejects missing `status`; rejects `{ status: "spam" }` (not in enum). Plus a `forbidNonWhitelisted` check for extra fields (`isRead`, `emailSentLog`).
  - **GREEN** (`update-contact-status.dto.ts`): single field `status` with `@IsIn(["pending", "read", "replied"]) @IsNotEmpty @ApiProperty`.
  - **REFACTOR**: define `CONTACT_STATUS` const object (per the typescript skill: const-type-first) and pass its values to `@IsIn` so the runtime + TS type share one source.
  - **DELETE**: `src/contact/dto/update-contact.dto.ts` (the scaffold's broken `PartialType` — no longer referenced once 3.2 lands).
- **Acceptance**: `npm test -- update-contact-status.dto.spec` is green; `grep -r "update-contact.dto" src/` returns no hits (the file is gone and nothing imports it); the canonical status enum is locked at the DTO surface.
- **Estimated LOC**: 85 (dto 35 + spec 50, minus 4 for the deleted file → net +81)
- **Depends on**: 3.1
- **Commit message draft**: `feat(contact): add UpdateContactStatusDto, drop broken stub`

#### Task 3.3 — Add `ListContactsQueryDto` (page + pageSize) + colocation spec
- **Files**: [NEW] `src/contact/dto/list-contacts-query.dto.ts`, [NEW] `src/contact/dto/list-contacts-query.dto.spec.ts`
- **Type**: domain
- **TDD steps**:
  - **RED** (`list-contacts-query.dto.spec.ts`): 6 scenarios mirroring `list-reviews-query.dto.spec.ts` — no params → optionals undefined; `?page=2&pageSize=5` → numeric fields; rejects `?page=0`; rejects `?pageSize=500` (DTO `@Max(100)` wire-level guard); accepts boundary `?pageSize=100`; rejects non-integer.
  - **GREEN** (`list-contacts-query.dto.ts`): 2 fields with `@IsOptional @Type(() => Number) @IsInt @Min(1)` for `page`; `@IsOptional @Type(() => Number) @IsInt @Min(1) @Max(100)` for `pageSize`; `@ApiPropertyOptional` for Swagger.
  - **REFACTOR**: pull the `Type(() => Number)` import to the top.
- **Acceptance**: `npm test -- list-contacts-query.dto.spec` is green; pagination defaults are a service concern (matches the reviews precedent).
- **Estimated LOC**: 90 (dto 40 + spec 50)
- **Depends on**: 3.2
- **Commit message draft**: `feat(contact): add ListContactsQueryDto with page+pageSize gates`

#### Task 3.4 — Add response DTOs (`ContactResponseDto`, `ListContactsResponseDto`, `ListContactsResult`)
- **Files**: [NEW] `src/contact/dto/contact-response.dto.ts`, [NEW] `src/contact/dto/list-contacts-response.dto.ts`
- **Type**: domain
- **TDD steps**: No separate spec file — the response shape is locked by the controller spec (task 6.2) and the e2e (task 11.1). The mapper (task 5.1) has its own spec for the field-by-field mapping. Add a TDD assertion in the controller spec that the response body matches the documented shape (8 fields, snake_case or camelCase per the convention).
- **Acceptance**: `ContactResponseDto` declares 8 fields (`id`, `name`, `email`, `subject`, `message`, `status`, `createdAt`, `updatedAt`) with `@ApiProperty`; `ListContactsResponseDto` declares 4 fields (`data`, `total`, `page`, `pageSize`); `ListContactsResult` interface matches.
- **Estimated LOC**: 80 (ContactResponseDto 45 + ListContactsResponseDto 35)
- **Depends on**: 3.1
- **Commit message draft**: `feat(contact): add ContactResponseDto + ListContactsResponseDto`

#### Task 5.1 — Add `contact.mapper.ts` (pure functions) + colocation spec
- **Files**: [NEW] `src/contact/contact.mapper.ts`, [NEW] `src/contact/contact-response.mapper.spec.ts`
- **Type**: domain
- **TDD steps**:
  - **RED**: write 6+ spec scenarios — `toContactResponse(row)` returns the 8-field object (id, name, email, subject, message, status, createdAt, updatedAt); preserves null subject; copies `createdAt` and `updatedAt` Date references; does NOT include any `emailSentLog` field; `toContactResponse` is a pure function (no side effects, same input → same output).
  - **GREEN** (`contact.mapper.ts`): export `toContactResponse(row: ContactEntity): ContactResponseDto` (the inline object shape — assignable to the response DTO class).
  - **REFACTOR**: consider whether the mapper should `new ContactResponseDto()` or return a plain object — for service-returned objects, the reviews precedent returns a plain object with the same shape (the DTO class is for Swagger typing only).
- **Acceptance**: `npm test -- contact-response.mapper.spec` is green; mapper is the single point where the success shape is decided (per the design §11).
- **Estimated LOC**: 100 (mapper 50 + spec 50)
- **Depends on**: 2.2, 3.4
- **Commit message draft**: `feat(contact): add contact.mapper pure functions + spec`

---

### Phase 4 — Domain core (event + service)

#### Task 4.1 — Add `ContactCreatedEvent` (the async event payload)
- **Files**: [NEW] `src/contact/events/contact-created.event.ts`
- **Type**: event
- **TDD steps**: No separate spec — the event is a 2-field data class; the listener spec (8.1) covers behavior. The shape is locked by the design §9.1.
- **Acceptance**: `export class ContactCreatedEvent { constructor(public readonly contactId: string, public readonly recipientEmail: string) {} }` is exported; importable from `src/contact/events/contact-created.event.ts`.
- **Estimated LOC**: 25
- **Depends on**: 0.2
- **Commit message draft**: `feat(contact): add ContactCreatedEvent payload`

#### Task 4.2 — Add `ContactService.create` (persist + emit) + REPLACE the smoke `contact.service.spec.ts` with a real spec
- **Files**: [MOD] `src/contact/contact.service.ts` (replaces 26-LOC stub with real implementation; initially just `create` + the constructor with both repo tokens + `EventEmitter2`), [MOD] `src/contact/contact.service.spec.ts` (REPLACES the 18-LOC smoke spec — the smoke `toBeDefined()` test is GONE)
- **Type**: domain
- **TDD steps**:
  - **RED** (`contact.service.spec.ts`): write 6+ scenarios — `create(dto)` calls `this.contacts.create({...dto, status: 'pending'})` and `this.contacts.save(row)`; the persisted row's id is the value emitted on `ContactCreatedEvent`; the row's email is the recipientEmail; the service returns the response DTO shape (8 fields); the `status` is locked to `'pending'` regardless of the DTO contents (the public submission contract); no `emailSentLog` reference (the destructive change).
  - **GREEN** (`contact.service.ts`): wire `@InjectRepository(ContactEntity)`, `@InjectRepository(SentEmailEntity)` (forward-declared for the email service; injected but unused in this task), `EventEmitter2` from `@nestjs/event-emitter`. Implement `async create(dto)`: build the row with `status: 'pending'`, save, emit `this.eventEmitter.emit('contact.created', new ContactCreatedEvent(saved.id, saved.email))`, return `toContactResponse(saved)`.
  - **REFACTOR**: pull the `'pending'` literal to a `CONTACT_STATUS.PENDING` const (consistent with the DTO).
- **Acceptance**: `npm test -- contact.service.spec` is green; the smoke `toBeDefined` test is gone; spec scenario "Event is emitted after persistence" is locked; `EventEmitter2` is injected but the listener (task 8.1) is not yet wired (the emit is a no-op for now).
- **Estimated LOC**: 350 (service this commit ~150 including unused-but-injected SentEmail repo + EventEmitter2; spec ~200 covering create + the static-method-surface guards for the upcoming findAllForAdmin + updateStatus)
- **Depends on**: 3.1, 4.1, 5.1
- **Commit message draft**: `feat(contact): add ContactService.create with event emission`

#### Task 4.3 — Add `ContactService.findAllForAdmin` (paginated) + `updateStatus` (404 on missing)
- **Files**: [MOD] `src/contact/contact.service.ts` (extends with 2 new methods), [MOD] `src/contact/contact.service.spec.ts` (extends with new describe blocks)
- **Type**: domain
- **TDD steps**:
  - **RED**: write 8+ spec scenarios — `findAllForAdmin({})` returns `{ data: [], total: 0, page: 1, pageSize: 20 }` shape; calls the repo with `orderBy created_at DESC`; respects explicit page/pageSize; silently clamps pageSize > 100; `updateStatus(id, { status: 'read' })` reads the row, sets the status, saves, returns the mapped DTO; `updateStatus(missing)` throws `NotFoundException`; `updateStatus(id, { status: 'replied' })` works; no FK CASCADE assertion needed (sent_emails has no FK to contacts).
  - **GREEN**: implement `findAllForAdmin(query)` (paginated list, same shape as reviews); `updateStatus(id, dto)` (find → mutate → save; 404 on missing).
  - **REFACTOR**: extract a small `applyPagination(query, qb)` helper if the reviews service has one — but the reviews service doesn't expose it, so duplicate the 4 lines.
- **Acceptance**: `npm test -- contact.service.spec` is green; `findAllForAdmin` returns the canonical `{ data, total, page, pageSize }` envelope; `updateStatus` 404s on missing.
- **Estimated LOC**: 250 (service extension ~50 + spec extension ~200)
- **Depends on**: 4.2
- **Commit message draft**: `feat(contact): add ContactService.findAllForAdmin + updateStatus`

---

### Phase 5 — Throttler & public HTTP

#### Task 6.1 — Add `ThrottledContactWrite()` decorator factory + colocation spec
- **Files**: [NEW] `src/contact/throttle.decorator.ts`, [NEW] `src/contact/throttle.decorator.spec.ts`
- **Type**: controller
- **TDD steps**:
  - **RED** (`throttle.decorator.spec.ts`): 5 scenarios mirroring `src/reviews/throttle.decorator.spec.ts` — `ThrottledContactWrite()` returns a function (a `MethodDecorator`); defaults to `limit=5`, `ttl=60_000` when env is absent; binds `CONTACT_THROTTLE_WRITE_LIMIT` when set; binds `CONTACT_THROTTLE_TTL_MS` when set; env restoration in `afterEach`.
  - **GREEN** (`throttle.decorator.ts`): `export function ThrottledContactWrite(): MethodDecorator { const limit = Number(process.env.CONTACT_THROTTLE_WRITE_LIMIT ?? 5); const ttl = Number(process.env.CONTACT_THROTTLE_TTL_MS ?? 60_000); return Throttle({ default: { limit, ttl } }); }`.
  - **REFACTOR**: extract the `Number(...)` fallback to a single helper if a future `ThrottledRead` is added.
- **Acceptance**: `npm test -- throttle.decorator.spec` is green; the spec scenario "Throttler uses CONTACT_THROTTLE_* env vars" is locked.
- **Estimated LOC**: 145 (decorator 45 + spec 100)
- **Depends on**: 0.2
- **Commit message draft**: `feat(contact): add ThrottledContactWrite decorator`

#### Task 6.2 — Replace the 5-route scaffold `ContactController` with the 1-route public controller + colocation spec
- **Files**: [MOD] `src/contact/contact.controller.ts` (replaces 45-LOC stub with 1-route public controller), [MOD] `src/contact/contact.controller.spec.ts` (REPLACES the 20-LOC smoke spec with HTTP shape + metadata tests; smoke `toBeDefined` is GONE)
- **Type**: controller
- **TDD steps**:
  - **RED** (`contact.controller.spec.ts`): 8+ supertest scenarios mirroring `reviews.controller.spec.ts` — `POST /api/v1/contacts` returns 201 + the 8-field response DTO on a valid body; 400 on missing `message`; 400 on bad email; 400 on `name > 100`; 400 on extra field `phone` (forbidNonWhitelisted); metadata: `@ThrottledContactWrite()` is applied (static source check); metadata: NO `@UseGuards(JwtAuthGuard)`; metadata: NO `+id` numeric coercion bug (no `:id` route at all on this controller).
  - **GREEN** (`contact.controller.ts`): `@ApiTags("contact") @Controller("contacts")`; single `@Post() @ThrottledContactWrite() @ApiOperation @ApiResponse 201/400/429 create(@Body() dto: CreateContactDto) { return this.contacts.create(dto); }`. The service name in DI is `private readonly contacts: ContactService` (NOT `contactService` — keeps it short for the public controller; the admin controller uses a different inject).
  - **REFACTOR**: clean up imports; remove the now-unused `updateContactDto` import.
- **Acceptance**: `npm test -- contact.controller.spec` is green; the smoke `toBeDefined` is gone; the spec scenarios "Valid body persists a contact and returns 201" + "Public route carries no JwtAuthGuard" are locked; static check confirms `@ThrottledContactWrite` is present and no `@Throttle(`/no `@UseGuards(JwtAuthGuard` is present.
- **Estimated LOC**: 360 (controller 80 + spec 280)
- **Depends on**: 4.2, 6.1
- **Commit message draft**: `feat(contact): add public ContactController with per-IP throttler`

---

### Phase 6 — Email pipeline

#### Task 7.1 — Add the `RESEND_CLIENT` injection token
- **Files**: [NEW] `src/contact/email/resend-client.token.ts`
- **Type**: email
- **TDD steps**: No separate spec — the token is a `Symbol` constant. The EmailService spec (task 7.4) and the e2e (task 11.1) inject via this token.
- **Acceptance**: `export const RESEND_CLIENT = Symbol("RESEND_CLIENT");` is exported; importable from `src/contact/email/resend-client.token.ts`.
- **Estimated LOC**: 8
- **Depends on**: 0.2
- **Commit message draft**: `feat(contact): add RESEND_CLIENT injection token`

#### Task 7.2 — Add the vanilla HTML + text email template constants
- **Files**: [NEW] `src/contact/email/email-template.ts`
- **Type**: email
- **TDD steps**: The regex invariants are tested in 7.3 (email-renderer.spec.ts) against the rendered output (which substitutes the placeholders but preserves the template). The template itself is a literal string constant; no separate spec.
- **Acceptance**: `email-template.ts` exports `CONTACT_NOTIFICATION_HTML`, `CONTACT_NOTIFICATION_TEXT`, `CONTACT_AUTO_REPLY_HTML`, `CONTACT_AUTO_REPLY_TEXT` as `export const` string values. The HTML uses the XHTML 1.0 Transitional doctype, table-based layout, inline-styled, with `{{name}}`, `{{email}}`, `{{subject}}`, `{{message}}` placeholders. The auto-reply HTML has no `{{subject}}` (subject is locked to "We received your message"). The text variants are 4–8 line plain-text versions.
- **Estimated LOC**: 130
- **Depends on**: 7.1
- **Commit message draft**: `feat(contact): add vanilla HTML + text email templates`

#### Task 7.3 — Add `email-renderer.ts` (pure `{{placeholder}}` substitution) + colocation spec
- **Files**: [NEW] `src/contact/email/email-renderer.ts`, [NEW] `src/contact/email/email-renderer.spec.ts`
- **Type**: email
- **TDD steps**:
  - **RED** (`email-renderer.spec.ts`): 8+ scenarios — `renderContactNotificationHtml(row)` returns a string; the string does NOT match `/<style\b/i`; the string does NOT contain `display: flex`, `display: grid`, `position: absolute`, `position: fixed`, or `@font-face`; the `{{name}}` placeholder is replaced with the row's name; the `{{email}}` placeholder is replaced; the `{{subject}}` placeholder is replaced; the `{{message}}` placeholder is replaced; `renderContactAutoReplyText(row)` contains the literal Spanish phrase `Recibimos tu mensaje, te contactaremos por email en breve.`; `renderContactNotificationText(row)` is non-empty and starts with "New contact form submission".
  - **GREEN** (`email-renderer.ts`): 4 pure functions that take a `ContactEntity`-shaped object and return the substituted template string. Use a small `substitute(template, row)` helper to avoid 4x duplication.
  - **REFACTOR**: tighten the substitute helper; consider template-literal-as-constant for the placeholders.
- **Acceptance**: `npm test -- email-renderer.spec` is green; the spec scenarios "Email HTML does not contain a `<style>` block" + "Email HTML does not use flex/grid/float/positioning" + "Plain-text fallback is always provided" are locked.
- **Estimated LOC**: 290 (renderer 90 + spec 200)
- **Depends on**: 7.2
- **Commit message draft**: `feat(contact): add email-renderer with vanilla invariants spec`

#### Task 7.4 — Add `EmailService` (Resend wrapper) + colocation spec
- **Files**: [NEW] `src/contact/email/email.service.ts`, [NEW] `src/contact/email/email.service.spec.ts`
- **Type**: email
- **TDD steps**:
  - **RED** (`email.service.spec.ts`): 6+ scenarios mirroring the design §8 sketch — `sendContactNotification(row)` calls `resend.emails.send` with `from = RESEND_FROM_ADDRESS`, `to = [RESEND_TO_ADDRESS]`, `subject = "New contact form submission: <subject>"`, `replyTo = row.email`, `headers = { "X-Contact-Id": row.id }`, `tags = [{ name: "domain", value: "contact-form" }]`; when Resend returns `{ data: { id: "abc" } }`, writes a `sent_emails` row with `status = accepted`, `resendId = "abc"`, `errorMessage = null`, `kind = contact_notification`; when Resend returns `{ data: null, error: {...} }`, writes a row with `status = failed`, `resendId = null`, `errorMessage = <error.message>`, `kind = contact_notification`; when Resend throws (network), writes a `failed` row with the thrown error's message and DOES NOT rethrow; `sendContactAutoReply(row)` mirrors the same paths with `kind = contact_auto_reply` and `to = row.email`; subject is locked to `"We received your message"`.
  - **GREEN** (`email.service.ts`): mirror the design §8 class sketch. The `send(input)` private method is non-throwing (it catches and writes a `failed` row).
  - **REFACTOR**: extract the `SENT_EMAIL_KIND` / `SENT_EMAIL_STATUS` const objects (shared with the entity in 2.3) into a small `src/contact/email/email.constants.ts` to keep the entity and the service in sync.
- **Acceptance**: `npm test -- email.service.spec` is green; the spec scenario "Successful send writes an `accepted` row" + "Failed send writes a `failed` row" + "Resend client is constructor-injectable" are locked; the EmailService NEVER rethrows on Resend failure.
- **Estimated LOC**: 440 (service 140 + spec 300)
- **Depends on**: 7.1, 7.3, 2.3
- **Commit message draft**: `feat(contact): add EmailService Resend wrapper (never throws)`

---

### Phase 7 — Event flow & module wiring

#### Task 8.1 — Add `ContactEmailListener` (`@OnEvent`) + colocation spec
- **Files**: [NEW] `src/contact/listeners/contact-email.listener.ts`, [NEW] `src/contact/listeners/contact-email.listener.spec.ts`
- **Type**: event
- **TDD steps**:
  - **RED** (`contact-email.listener.spec.ts`): 5+ scenarios — when `ContactCreatedEvent` is emitted and the row exists, the listener calls `emailService.sendContactNotification(row)` AND `emailService.sendContactAutoReply(row)`; the two calls are sequential (auto-reply runs after notification); when the row is missing (deleted between create and dispatch), the listener logs a warning and does NOT invoke either EmailService method; the listener does NOT rethrow on EmailService errors (a defensive try/catch in the listener is optional — the EmailService itself is non-throwing); the listener re-reads the row fresh (does NOT trust the event payload for anything other than the id).
  - **GREEN** (`contact-email.listener.ts`): `@Injectable() export class ContactEmailListener { @OnEvent("contact.created", { async: true }) async handleContactCreated(event: ContactCreatedEvent) { const row = await this.contacts.findOne({ where: { id: event.contactId } }); if (!row) { this.logger.warn(...); return; } await this.emailService.sendContactNotification(row); await this.emailService.sendContactAutoReply(row); } }`. Inject `ContactRepository` + `EmailService`.
  - **REFACTOR**: extract the "row missing" warning into a private method if the test wants to assert the log level.
- **Acceptance**: `npm test -- contact-email.listener.spec` is green; the spec scenarios "Event handler triggers both sends" + "Event is emitted after persistence" are locked.
- **Estimated LOC**: 380 (listener 130 + spec 250)
- **Depends on**: 4.1, 7.4, 2.2
- **Commit message draft**: `feat(contact): add ContactEmailListener (async @OnEvent)`

#### Task 9.1 — Replace the 9-LOC `ContactModule` stub with the real module + colocation spec
- **Files**: [MOD] `src/contact/contact.module.ts` (replaces the 9-LOC stub: imports TypeOrmModule.forFeature with both entities, both controllers, ContactService, EmailService, ContactEmailListener; provides the `RESEND_CLIENT` factory), [NEW] `src/contact/contact.module.spec.ts`
- **Type**: domain
- **TDD steps**:
  - **RED** (`contact.module.spec.ts`): 5 static-source assertions mirroring `src/reviews/reviews.module.spec.ts` — imports `TypeOrmModule` from `@nestjs/typeorm`; calls `TypeOrmModule.forFeature([ContactEntity, SentEmailEntity])`; provides `ContactService`, `EmailService`, `ContactEmailListener`; declares BOTH controllers (`ContactController`, `ContactAdminController` — the admin controller is referenced even though it lands in 10.1; the spec asserts the SOURCE has the reference at write time, not the runtime); provides the `RESEND_CLIENT` factory via `useFactory`.
  - **GREEN** (`contact.module.ts`): write the module per the design §5.1 entry. The `RESEND_CLIENT` factory injects `ConfigService<EnvConfig>` and returns `new Resend(config.get("RESEND_API_KEY", { infer: true }) as string)`.
  - **REFACTOR**: group the imports (Nest common, TypeORM, Resend SDK, relative).
- **Acceptance**: `npm test -- contact.module.spec` is green; the module is the only file in this change that mutates DI; `npm run build` succeeds (the admin controller import in 10.1 is the next commit; the spec's source-check accepts the forward reference).
- **Estimated LOC**: 105 (module 55 + spec 50)
- **Depends on**: 2.4, 4.3, 6.2, 7.4, 8.1
- **Commit message draft**: `feat(contact): wire ContactModule (TypeOrm + controllers + email + listener)`

---

### Phase 8 — Admin endpoints

#### Task 10.1 — Add `ContactAdminController` (GET + PATCH, JWT-guarded) + colocation spec
- **Files**: [NEW] `src/contact/contact-admin.controller.ts`, [NEW] `src/contact/contact-admin.controller.spec.ts`
- **Type**: controller
- **TDD steps**:
  - **RED** (`contact-admin.controller.spec.ts`): 8+ scenarios mirroring `src/reviews/reviews-admin.controller.spec.ts` — metadata: class-level `@ApiTags("contact")`; metadata: class-level `@ApiBearerAuth()`; metadata: class-level `@UseGuards(JwtAuthGuard)`; metadata: NO `@Throttle()` decorator (admin is unthrottled per the design); metadata: `:id` uses `ParseUUIDPipe`; HTTP: `GET /api/v1/admin/contacts` returns 401 (route mounted + guarded, via StubJwtAuthGuard); HTTP: `PATCH /api/v1/admin/contacts/:id` returns 401; HTTP: PATCH on a non-uuid id returns 400 (via the real pipe, not the stub guard).
  - **GREEN** (`contact-admin.controller.ts`): `@ApiTags("contact") @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller("admin/contacts")`; 2 methods: `@Get() @ApiOperation @ApiResponse 200 findAllForAdmin(@Query() query: ListContactsQueryDto)` and `@Patch(":id") @ApiOperation @ApiResponse 200/400/401/404 updateStatus(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateContactStatusDto)`.
  - **REFACTOR**: ensure no `@Throttle` decorators leaked from copy-paste.
- **Acceptance**: `npm test -- contact-admin.controller.spec` is green; the spec scenarios "Missing JWT returns 401" + "Valid JWT returns paginated contacts" + "PATCH on unknown id returns 404" + "PATCH on non-uuid id returns 400" + "Admin routes are not throttled" are locked.
- **Estimated LOC**: 360 (controller 110 + spec 250)
- **Depends on**: 4.3, 9.1
- **Commit message draft**: `feat(contact): add ContactAdminController (GET + PATCH, JWT-guarded)`

---

### Phase 9 — E2E & verification

#### Task 11.1 — Add `test/contact.e2e-spec.ts` (public POST: 201, 400, 429, Resend-failure-201)
- **Files**: [NEW] `test/contact.e2e-spec.ts`
- **Type**: e2e
- **TDD steps**:
  - **RED**: write 6+ supertest scenarios in a parallel app composition (mirror `test/reviews.e2e-spec.ts` but build a minimal app: ContactModule only, with in-memory `Contact` + `SentEmail` repos, an injected `Resend` fake via the `RESEND_CLIENT` token, `configureApp` from `src/main.ts`, the `AllExceptionsFilter` for the canonical error envelope).
    - `POST /api/v1/contacts` with a valid body returns 201 + the canonical success envelope (8-field response DTO).
    - 201 triggers a `ContactCreatedEvent`; the listener fires; **2 `sent_emails` rows** are persisted (one `contact_notification` to `RESEND_TO_ADDRESS`, one `contact_auto_reply` to the submitter's email), each with `status = accepted` and a non-null `resend_id`.
    - 400 on missing `message` with the canonical error envelope (5 keys: `statusCode`, `error`, `message`, `timestamp`, `path`).
    - 400 on bad email.
    - 400 on extra field `phone` (forbidNonWhitelisted).
    - 429 on the 6th request with `CONTACT_THROTTLE_WRITE_LIMIT=5` (flip the env at the right place in the e2e to enable the throttler).
    - Resend failure path: with a Resend fake that returns `{ data: null, error: { ... } }`, the POST still returns 201 and **2 `failed` `sent_emails` rows** are persisted, each with a non-null `error_message`; the global filter is NOT invoked (no 5xx).
  - **GREEN**: write the spec; the fake repos + fake Resend make the assertions pass.
  - **REFACTOR**: extract the e2e bootstrap into a `bootstrapTestApp` helper if it grows past ~80 LOC.
- **Acceptance**: `npm run test:e2e -- contact.e2e-spec` is green; all 6+ scenarios pass; the spec scenario "Resend failure does not 5xx the public POST" is locked end-to-end (not just at the EmailService level).
- **Estimated LOC**: 400
- **Depends on**: 9.1
- **Commit message draft**: `test(e2e): add contact public POST e2e (201/400/429/Resend-failure-201)`

#### Task 11.2 — Add `test/contact-admin.e2e-spec.ts` (admin: 401, 200, 404, 400)
- **Files**: [NEW] `test/contact-admin.e2e-spec.ts`
- **Type**: e2e
- **TDD steps**:
  - **RED**: write 5+ supertest scenarios in a parallel app composition (same pattern as 11.1, but flip throttler to permissive `1_000_000` for admin paths).
    - `GET /api/v1/admin/contacts` with no `Authorization` header returns 401 with the canonical error envelope (`error: "Unauthorized"`).
    - `GET /api/v1/admin/contacts?page=1&pageSize=20` with a valid (stub) JWT returns 200 + the canonical paginated envelope `{ data: [...], total, page, pageSize }`.
    - `PATCH /api/v1/admin/contacts/:id` with a valid (stub) JWT and `{ status: "read" }` returns 200 + the updated contact DTO; the row's `status` is `read` in the in-memory repo.
    - `PATCH /api/v1/admin/contacts/:id` with a valid (stub) JWT and `{ status: "spam" }` returns 400 (DTO-level rejection, not 500).
    - `PATCH /api/v1/admin/contacts/not-a-uuid` returns 400 (`ParseUUIDPipe`).
    - `PATCH /api/v1/admin/contacts/<valid-uuid-of-missing-row>` returns 404.
  - **GREEN**: write the spec.
  - **REFACTOR**: share the test-app bootstrap with 11.1 if possible (extract a `contactE2eHelpers.ts` file in `test/`).
- **Acceptance**: `npm run test:e2e -- contact-admin.e2e-spec` is green; all 5+ scenarios pass; the spec scenario "Missing JWT returns 401" is locked end-to-end with the real `JwtAuthGuard` (not the stub).
- **Estimated LOC**: 280
- **Depends on**: 10.1
- **Commit message draft**: `test(e2e): add contact admin e2e (401/200/404/400)`

---

## Verification (post-apply)

These are NOT tasks — they are the `sdd-verify` checklist. Apply should land
all 27 tasks above, then verify should run:

1. `npm test` — all unit specs green.
2. `npm run test:e2e` — all e2e specs green (the new contact e2e + the existing
   auth/projects/reviews e2e must still pass; the contact e2e does NOT
   import `ContactModule` to avoid coupling).
3. `npm run build` — TypeScript build succeeds.
4. `npm run lint` — ESLint clean.
5. `grep -r email_sent_log src/` — no hits (the destructive change is gone from
   application code; only the `down` migration's `ADD COLUMN` references the
   column name).
6. `typeorm schema:log` against a live Postgres (per the migration's header
   comment) — the `sent_emails` DDL matches the entity column shape.
7. `curl -X POST http://localhost:3000/api/v1/contacts -d '...'` against a
   staging deploy — happy path returns 201; verify the 2 `sent_emails` rows
   in the DB.
8. Manual send of a `contact_notification` and a `contact_auto_reply` to
   Gmail + Outlook + Apple Mail — verify the vanilla HTML renders without
   obvious quirks (the unit spec asserts the structural invariants; a manual
   eyeball pass is a future-work follow-up if any client breaks).

## File inventory (post-apply)

| Status | Path                                                                     | Notes                                              |
|--------|--------------------------------------------------------------------------|----------------------------------------------------|
| [NEW]  | `.env.example`                                                           | Created at repo root (did not exist before)        |
| [NEW]  | `src/contact/email/resend-client.token.ts`                               | `RESEND_CLIENT` Symbol                             |
| [NEW]  | `src/contact/email/email-template.ts`                                    | 4 string constants (HTML + text)                   |
| [NEW]  | `src/contact/email/email-renderer.ts` + spec                             | Pure substitution                                  |
| [NEW]  | `src/contact/email/email.service.ts` + spec                              | Resend wrapper                                     |
| [NEW]  | `src/contact/events/contact-created.event.ts`                            | Payload class                                      |
| [NEW]  | `src/contact/listeners/contact-email.listener.ts` + spec                 | `@OnEvent('contact.created')`                      |
| [NEW]  | `src/contact/contact.mapper.ts` + spec                                   | `toContactResponse`                                |
| [NEW]  | `src/contact/contact.module.spec.ts`                                     | Static contract                                    |
| [NEW]  | `src/contact/contact-admin.controller.ts` + spec                         | JWT-guarded GET + PATCH                             |
| [NEW]  | `src/contact/throttle.decorator.ts` + spec                               | `ThrottledContactWrite()`                          |
| [NEW]  | `src/contact/dto/contact-response.dto.ts`                                | Single-object response                             |
| [NEW]  | `src/contact/dto/list-contacts-response.dto.ts`                          | Paginated envelope                                 |
| [NEW]  | `src/contact/dto/list-contacts-query.dto.ts` + spec                      | `?page&pageSize`                                   |
| [NEW]  | `src/contact/dto/update-contact-status.dto.ts` + spec                    | `status` enum gate                                 |
| [NEW]  | `src/contact/entities/sent-email.entity.ts` + spec                       | 10 columns + 2 enums                               |
| [NEW]  | `src/database/migrations/20260623000000-create-contacts-and-sent-emails.ts` | Hand-written reversible                        |
| [NEW]  | `test/contact.e2e-spec.ts`                                               | Public POST e2e                                    |
| [NEW]  | `test/contact-admin.e2e-spec.ts`                                        | Admin e2e                                          |
| [MOD]  | `package.json` + `package-lock.json`                                     | `@nestjs/event-emitter` dep                        |
| [MOD]  | `src/app.module.ts`                                                      | `EventEmitterModule.forRoot()` + dual throttler    |
| [MOD]  | `src/config/env.config.ts` + spec                                        | 5 new env vars                                     |
| [MOD]  | `src/data-source.ts`                                                     | Register both entities                             |
| [MOD]  | `src/contact/contact.controller.ts` + spec                               | Replaces 5-route scaffold (was 45 + 20 LOC)        |
| [MOD]  | `src/contact/contact.service.ts` + spec                                  | Replaces 26 + 18 LOC stub; adds create/list/update |
| [MOD]  | `src/contact/contact.module.ts`                                          | Replaces 9-LOC stub                                |
| [MOD]  | `src/contact/dto/create-contact.dto.ts` + spec                           | Replaces 1-LOC stub                                |
| [MOD]  | `src/contact/entities/contact.entity.ts` + spec                          | Replaces 1-LOC stub                                |
| [DEL]  | `src/contact/dto/update-contact.dto.ts`                                  | Broken `PartialType` from scaffold                 |

## Task summary

- **Total tasks**: 27
- **Estimated LOC sum**: ≈ 4,220 (matches the design §13 forecast within 1%)
- **Work-unit commits**: 27 (one task = one commit; tests colocated per project convention)
- **E2E files**: 2 (public + admin; both live in `test/`)
- **No PR task** (user handles the final PR; the orchestrator contract is explicit on this)
- **Strict TDD**: every task that adds production code carries explicit RED → GREEN → REFACTOR steps

## Open questions for the user (none blocking sdd-apply)

The user has locked all 7 preflight decisions (per the proposal §6). No new
questions emerged during this `sdd-tasks` pass. The two minor deviations from
the literal user wording are pre-authorized in the proposal:

1. `.env.example` does not exist in the repo; the apply phase will CREATE it
   (per the 2026-06-23 user-approved deviation in the proposal §10 risk row).
2. The locked `Resend call: 5/60_000` throttler env vars use the names
   `CONTACT_THROTTLE_WRITE_LIMIT` + `CONTACT_THROTTLE_TTL_MS` (mirroring
   `REVIEWS_THROTTLE_*`); the `READ_LIMIT` is reserved for future use per
   the cross-cutting spec.

If both deviations are still good, no user input is needed before `sdd-apply`.
