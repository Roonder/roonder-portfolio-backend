# Exploration: reviews-domain

## Change

| Field | Value |
| --- | --- |
| Change name | `reviews-domain` |
| Branch | `domains/reviews` (current; only domain branch left on the remote — `domain/auth` and `domain/projects` were merged and removed) |
| Intent (verbatim, Spanish) | "Siguiendo las definiciones del DBML, y trabajando en los specs, vamos a trabajar en el dominio de reviews. Su función principal es permitir que usuarios no autenticados dejen reviews (las cuales serán luego supervisadas desde el panel de administración para su visualización) sobre los proyectos realizados, o sobre mi persona." |
| Intent (English, paraphrased) | Build the Reviews domain following the DBML definitions. The domain's main function is to let **unauthenticated** visitors leave reviews, which are then moderated by the admin before they are displayed. Reviews are about **the projects** carried out, **OR about the owner** ("mi persona"). |
| Commit strategy (user-locked) | ONE commit per file / spec / service / functionality completed. ZERO small-progress commits. |
| Delivery strategy | Trunk-based commit-range on `domains/reviews`; no PRs created by sdd-apply. `apply-progress` markers track progression. |
| Strict TDD | Active. Runner: `npm test` (Jest 30 + ts-jest). Test scenarios MUST be written first (RED), then implementation, then refactor. |

## Detected intent (re-statement)

The user wants the public surface to accept anonymous feedback on two distinct subject types — **a project** and **the owner** — with an admin moderation queue for approval before public display. The DBML currently defines only the two tables (`reviews` and `review_comments`) without a way to discriminate which subject a row refers to. That gap is the single most important finding of this exploration and is documented under **§DBML gap** and **§Open product questions** below.

The two known established conventions from `projects-crud` that this change will inherit are:

- The NestJS module-per-domain layout (`controller + service + dto/ + entities/ + module`).
- The `{ data, total, page, pageSize }` envelope for paginated lists and the canonical 4xx/5xx error envelope from `global-exception-filter`.

The user said "Siguiendo las definiciones del DBML" — but the DBML does not encode the polymorphism the user wants. This conflict must be resolved before the proposal can be written.

## Existing artifacts read

| File | One-line summary |
| --- | --- |
| `openspec/specs/database-schema.dbml` | Source-of-truth schema. Tables `users`, `projects`, `project_urls`, **`reviews`**, **`review_comments`**, `contacts`, `refresh_tokens`. The `reviews` table has 7 columns: `id`, `author_name`, `author_role`, `content`, `rating`, `is_approved`, `created_at`. **No** `project_id` / `owner_id` / `subject_type` column. |
| `openspec/specs/server_specs.md` | §3.3 "Reviews Domain" — lists 6 endpoints (3 public, 3 protected). §3.5 "Global API Prefix" + §4 env vars are cross-cutting rules to inherit. |
| `openspec/specs/api-bootstrap/spec.md` | Locks the `/api/v1` prefix, the `ValidationPipe` options, the CORS-from-`FRONTEND_URL` rule, Swagger at `/api/v1/docs`, and `ConfigService`-only env access. |
| `openspec/specs/global-exception-filter/spec.md` | Locks the 4xx/5xx body shape `{ statusCode, error, message, timestamp, path }`, the prod-vs-dev sanitization, and the registration point in `main.ts`. |
| `openspec/specs/projects-domain/spec.md` | Reference implementation of the "domain capability" pattern — entities, service, controller, DIFF semantics, slug uniqueness, transactional create, envelope-shaped public list, existence-leak guard on detail. **Not inherited wholesale — only its conventions.** |
| `openspec/specs/auth-domain/spec.md` | Locks `JwtAuthGuard` (method-level, never global), the cookie naming, the seed-superuser CLI. |
| `openspec/specs/ui_specs.md` | Frontend spec. §2.4 names "Admin Reviews — Moderation table. Quick action buttons to Approve/Reject (PATCH /admin/reviews/:id/approve)." No visual spec for the public review form beyond §2.1 ("Reviews Section: A carousel or list of approved testimonials. Includes a button to open a 'Leave a Review' modal"). No indication of which subject the user picks (project vs owner). |
| `openspec/changes/archive/projects-crud/proposal.md` + `explore.md` | Conventions for proposals and explores. **Do not inherit scope** (no DIFF `urls` row, no full-text search, no caching, etc.). |
| `openspec/changes/archive/2026-06-17-auth-domain/proposal.md` | Conventions for entity / module / CLI seed wiring. |
| `src/reviews/*` | Scaffolding stubs. `controller` exposes 5 wrong routes (`:id` everywhere, no admin split, no `@UseGuards`, no Swagger); `service` returns string placeholders; `dto/create-review.dto.ts` is `export class CreateReviewDto {}`; `dto/update-review.dto.ts` is `PartialType(CreateReviewDto)`; `entities/review.entity.ts` is `export class Review {}`; both spec files are smoke tests only. There is **no** `review-comment.entity.ts` and no DTO for comments. |
| `src/projects/*` | Closest sibling domain. Mirrors: entities under `entities/`, DTOs under `dto/` with `*-response.dto.ts` mirrors, `*.spec.ts` next to every file, `project-response.mapper.ts`, `data-source.ts` registration, `TypeOrmModule.forFeature([...])` in the module, `@ApiTags` + `@ApiBearerAuth` on protected methods. |
| `src/database/migrations/20260618205116-create-projects-and-project-urls.ts` | The precedent for a hand-written TypeORM migration when a domain needs a new table. The reviews change needs the same kind of migration for `reviews` and `review_comments`. |
| `src/cli/seed-projects.ts` | Precedent for a domain seed script with a `SEED_DRY_RUN` env flag. Reviews-domain MAY want an analogous `seed-reviews.ts` — to be decided. |
| `src/common/filters/all-exceptions.filter.ts` | The global filter that every domain inherits automatically. No new wiring needed. |
| `src/main.ts` + `src/app.module.ts` | Already wires `ReviewsModule` into `AppModule.imports` (line 30) — the module exists in the graph but does nothing real. |
| `package.json` | All needed deps are present (`@nestjs/swagger`, `class-validator`, `class-transformer`, `typeorm`). **No new package** is anticipated. |

## Existing endpoints (from server_specs §3.3) vs. what's needed

| # | Method + path (post-prefix) | Auth | Status today | What reviews-domain must add |
| - | --- | --- | --- | --- |
| 1 | `POST /api/v1/reviews` | Public | Stub `create()` returns the string placeholder | Real DTO with `authorName?` (default `'Anónimo'`), `authorRole?`, `content` (required), `rating` (1–5), `subject` (discriminator) + `subjectId` (uuid) — **subject shape TBD**, see §DBML gap. Persists with `isApproved=false`. |
| 2 | `GET /api/v1/reviews` | Public | Stub `findAll()` returns string | Paginated, envelope-shaped, **only `isApproved=true`**, no `isPublished`-style filter param (the spec does not mention one). Optional subject filter (TBD). |
| 3 | `GET /api/v1/admin/reviews` | Protected (JwtAuthGuard) | **Does not exist in the stub** — the stub uses `findAll` on `/reviews` for both surfaces | New route. Lists **all** reviews for moderation (any `isApproved`), with the same envelope shape. |
| 4 | `PATCH /api/v1/admin/reviews/:id/approve` | Protected | **Does not exist in the stub** | New route. Toggles `isApproved`. `:id` is a uuid with `ParseUUIDPipe`. |
| 5 | `POST /api/v1/reviews/:id/comments` | Public | **Does not exist in the stub** | New route. Body: `authorName?` (default `'Anónimo'`), `content` (required). `:id` is the parent review's uuid; route MUST `404` if the parent does not exist. |
| 6 | `DELETE /api/v1/admin/reviews/:id` | Protected | Stub `@Delete(':id')` exists, but returns the string placeholder and lives on the public path (no admin split) | New route on `/admin/reviews/:id`. Returns `204 No Content` (matches `projects-crud` convention). Must decide cascade behavior for `review_comments` (see §Risks). |

The stub also exposes a `GET /reviews/:id` and a `PATCH /reviews/:id` (the latter via `UpdateReviewDto extends PartialType(CreateReviewDto)`) — **neither is in `server_specs.md` §3.3.** The proposal phase should treat those as out-of-scope and remove the stub routes that do not belong (or, if the user wants to keep a `PATCH /reviews/:id` for editing, that is a §Open question).

The spec is silent on:

- Whether a single review can be about BOTH a project AND the owner (unlikely; one or the other).
- Whether the public `GET /api/v1/reviews` should expose the `authorRole` field.
- Whether comments are public-read (`GET /api/v1/reviews/:id/comments`) or only displayed alongside an approved review.
- Whether `DELETE /api/v1/admin/reviews/:id` cascades to its comments.

## DBML state vs. user intent

The DBML is **incomplete for the user's stated intent**. Concretely:

| Column needed for intent | Present in DBML? | Notes |
| --- | --- | --- |
| Discriminator (project vs owner) | **No** | The DBML has neither `subject_type` nor two nullable FKs. Today, the `reviews` table cannot tell apart a review of project X from a review of the owner. |
| FK to `projects.id` (when subject is a project) | **No** | The `project_urls` table demonstrates the `ref: > projects.id` shape that the missing FK would mirror. |
| FK to `users.id` (when subject is the owner) | **No** | The `users` table is referenced by `refresh_tokens.user_id`; the reviews table has no equivalent. |
| `reviewer_email` / IP / user-agent for spam moderation | **No** | The DBML has no anti-spam columns. The user did not mention anti-spam. |
| `is_approved` on `review_comments` | **No** | Admin moderation is on the parent review only. Comments have no moderation gate; a comment on an approved review becomes public immediately. |
| ON DELETE behavior on `review_comments.review_id` | **Not declared** | The DBML has `[ref: > reviews.id, not null]` with no `note` about CASCADE. Postgres defaults to `NO ACTION`. The proposal phase must decide. |
| CHECK constraint on `rating` 1..5 | **Not declared** | The DBML has only a `[note: 'Escala 1-5']`. The numeric range must be enforced somewhere (DTO + DB or DTO only). |
| `index` on `reviews.is_approved` | **No** | The public list filters on `is_approved=true`; an index is recommended. |
| `index` on `review_comments.review_id` | **No** | Listed in the public-list expansion of a review (if added) — recommended. |

This is a **RISK: schema change required**. The user said "Siguiendo las definiciones del DBML" but the DBML does not encode the polymorphism. The proposal phase cannot proceed without the user picking one of the §Candidate modeling options below OR explicitly accepting a DBML delta.

## Candidate modeling options for the "subject" question

> **No recommendation is made here.** The proposal phase will pick, but the orchestrator MUST route these to the user first.

1. **Add `project_id` + `subject_type` discriminator** to the existing `reviews` table.
   - Columns: `project_id uuid [ref: > projects.id, null]` + `subject_type varchar [not null, note: "'project' or 'owner'"]` + a CHECK that exactly one of `project_id` (subject_type='project') is set, and subject_type='owner' has `project_id IS NULL`.
   - Pros: stays in one table, easy to filter (`WHERE subject_type = 'project' AND project_id = X`), smallest migration footprint. Mirrors how `is_published` already lives in the table.
   - Cons: needs a CHECK constraint or trigger; need to handle the `owner` case where there is no row to point at (the owner is the singleton superuser in `users`, but referencing `users.id` is also an option — see option 2).

2. **Two nullable FKs (`project_id` and `owner_user_id`) + a CHECK constraint.**
   - Columns: `project_id uuid [ref: > projects.id, null]` + `owner_user_id uuid [ref: > users.id, null]` + CHECK exactly-one-non-null.
   - Pros: no discriminator string, FK-level integrity, straightforward joins. Works well with TypeORM `@ManyToOne`.
   - Cons: the owner concept is a singleton — pointing at `users.id` (the superuser) means every owner-review is a second review tied to the same user. That is acceptable but slightly noisy.

3. **Two separate tables** (`project_reviews` + `owner_reviews`), or a single `reviews` table split into a parent + a child per subject type.
   - Pros: cleanest domain modeling; per-subject columns (e.g. `project_role`, `project_rating` for projects) become trivial.
   - Cons: more migrations, more entities, more DTOs, and the public `GET /api/v1/reviews` query has to UNION the two — which is not free.

4. **Polymorphic `subject_type` + `subject_id`** (string discriminator + uuid column with no FK).
   - Pros: maximally flexible, the public list query is one row.
   - Cons: **no referential integrity on `subject_id`**, which is a known anti-pattern. Hard to model in TypeORM (no `@ManyToOne` works). Explicitly discouraged by the projects-crud precedent (the DIFF on `project_urls` is FK-based, not polymorphic).

The user said "Siguiendo las definiciones del DBML" — but the DBML defines neither the discriminator nor the FK. Reading literally, the DBML permits NO `subject_type` at all, in which case every review is "about the owner" by default and the project-tied case is impossible. The user must clarify whether "following the DBML" means "extend it to encode the intent" or "accept the DBML's lack of polymorphism and re-scope the feature".

## Open product questions (ordered by impact)

> These are the questions the orchestrator MUST route to the user before `sdd-propose` can write a non-speculative proposal. They are listed in decreasing order of impact.

1. **Subject modeling (the schema-gap question).** Pick one of the §Candidate modeling options, or accept a different approach. Without this, the proposal cannot pick an entity shape, a migration shape, or a DTO shape.
2. **Is the public `POST /api/v1/reviews` truly open (no anti-spam)?** The DBML has no IP / user-agent / rate-limit field. Confirm whether the user accepts untrusted traffic with no throttling, or whether the proposal should add a minimal rate-limit (per-IP, e.g. via `@nestjs/throttler`) and/or an `ip_address` column for moderation.
3. **Comment moderation.** Today `POST /api/v1/reviews/:id/comments` is public, with no `is_approved` on the child table. Should the proposal (a) add `is_approved` to `review_comments` and gate the public list, (b) auto-approve comments when the parent review is approved, or (c) accept the current "no moderation on comments" stance?
4. **Cascade on `DELETE /api/v1/admin/reviews/:id`.** Does the hard delete remove the review's `review_comments` rows too? The DBML has no `ON DELETE` clause; the default is `NO ACTION` (i.e. Postgres will reject the delete if children exist). The proposal must pick a side: cascade, restrict, or soft-delete.
5. **Public exposure of `authorRole` and `authorName`.** The DBML defaults `author_name` to `'Anónimo'`. Does the public `GET /api/v1/reviews` (the approved-only list) return the real author name, or a normalized "Anonymous" for any review where the visitor left the field empty? Same question for `author_role` (it can leak employer info).
6. **Seed data.** Does the user want a `seed-reviews.ts` (mirroring `seed-projects.ts`) for dev/test data? Or do they want to add real reviews manually through the admin UI?
7. **Comments public read endpoint.** Is `GET /api/v1/reviews/:id/comments` (public) in scope, or do comments only render inside the approved-review body? The §3.3 spec only mandates the POST; the GET is silent.
8. **Editing a review after submission.** The scaffold has a `PATCH /reviews/:id` route that is **not** in the §3.3 spec. Does the user want to keep it (admin edit), drop it, or surface it as a separate `PATCH /admin/reviews/:id`?

Items 1, 2, 3, 4 are blocking. Items 5, 6, 7, 8 are clarifying.

## Conventions to inherit from projects-crud

- **Layout**: `src/reviews/{dto,entities,reviews.controller.ts,reviews.service.ts,reviews.module.ts,*.spec.ts}`. Colocated `*.spec.ts` (Jest 30 + ts-jest). E2E in `test/reviews.e2e-spec.ts`.
- **Entity shape**: TypeORM `@Entity('reviews')` mirroring the DBML exactly (column names in snake_case via `@Column({ name })`, `createdAt` / `updatedAt` via `@CreateDateColumn` / `@UpdateDateColumn`). Register in `src/data-source.ts` `entities` array AND in `ReviewsModule.imports` via `TypeOrmModule.forFeature([...])`.
- **DTOs**: `CreateReviewDto`, `UpdateReviewDto` (only if §Open question 8 keeps editing; otherwise drop), `CreateReviewCommentDto`, `ListReviewsQueryDto`, `ListReviewsResponseDto`, `ReviewResponseDto`, `ReviewCommentResponseDto`. All annotated with `@ApiProperty` for Swagger. `@IsOptional()` on optional fields, `@MaxLength(...)` on free-text fields.
- **ValidationPipe**: inherited from `main.ts` — `whitelist`, `transform`, `forbidNonWhitelisted`, `enableImplicitConversion`. Numeric / boolean query params MUST use `@Type(() => Number)` / `@Type(() => Boolean)` per the precedent in `list-projects-query.dto.ts`.
- **Response envelope**: `{ data, total, page, pageSize }` for paginated lists; single-object responses return the entity-shaped DTO directly (no envelope).
- **Error envelope**: canonical 4xx/5xx shape from `global-exception-filter/spec.md` — `{ statusCode, error, message, timestamp, path }`. Service throws `NotFoundException` / `ConflictException` / `BadRequestException`; the filter renders the rest.
- **Service style**: `@InjectRepository(Entity)` per entity, `DataSource` injection only if a transaction is needed (project_urls DIFF uses it; for reviews this depends on the subject-modeling choice).
- **Controller style**: `@ApiTags('reviews')` at the class level; `@ApiBearerAuth()` on each `@UseGuards(JwtAuthGuard)` method; `@ApiOperation` + `@ApiResponse` on every route; `ParseUUIDPipe` on every `:id` param. The admin split is `/admin/reviews/...` mounted as a sub-route on the same controller or a second controller — `projects-crud` does NOT have a `/admin/projects/...` precedent (the projects change locks the path question for design to decide). For reviews, §3.3 already mandates the `/admin/reviews` sub-path, so the controller MUST mount it.
- **CORS**: inherited from `main.ts`. No additional configuration.
- **Swagger**: inherited. Add the new routes under the `reviews` tag. The 3 protected routes advertise the bearer padlock; the 3 public ones do not.
- **Migration**: a hand-written TypeORM migration in `src/database/migrations/` (mirror `20260618205116-create-projects-and-project-urls.ts`). The migration MUST be reversible via `down()`. Comments at the top document the "no live Postgres in this env" caveat.
- **Tests**: entity metadata spec, controller HTTP-shape spec, service behavior spec, full e2e in `test/`. E2E for protected routes must mint a JWT signed with the test secret (mirror `test/projects.e2e-spec.ts`).
- **README**: the projects domain's `src/projects/README.md` is the template — endpoints table, DTO catalog, error envelope, cascading notes. The reviews change should grow an analogous `src/reviews/README.md` (not required by the proposal, recommended).
- **`apply-progress` markers**: per the user-locked commit strategy, every file/spec/service/functionality-complete commit MUST be accompanied by an `apply-progress.md` entry naming the task.

## Risks

- **Schema gap (the dominant risk).** The user wants two subject types, the DBML defines zero. Until §Open question 1 is resolved, the proposal cannot pick an entity shape. If the user insists "Siguiendo las definiciones del DBML" means NO schema change, the feature scope shrinks to "owner-only reviews" and the DBML is sufficient — but the user's stated intent is the broader one. **Severity: high. Likelihood: certain if not surfaced.**
- **Anti-spam gap.** Public `POST /api/v1/reviews` and `POST /api/v1/reviews/:id/comments` with no rate-limit, no CAPTCHA, no IP capture. A motivated bot can flood the admin queue. **Severity: medium. Mitigation: surface to user; the change can be deferred with a follow-up issue, but a one-line `npm i @nestjs/throttler` + 60s window is a cheap insurance.**
- **Comment moderation gap.** `review_comments` has no `is_approved`. A spam comment on an approved review is public immediately. **Severity: medium. Mitigation: §Open question 3 must be answered before spec.**
- **Cascade on review delete.** The DBML is silent; Postgres defaults to `NO ACTION`. Without a DBML delta to `ON DELETE CASCADE`, a `DELETE /admin/reviews/:id` that has children will 500 (or, if the service deletes children first, it is a manual cascade that the e2e must cover). **Severity: low. Mitigation: the proposal phase locks the choice.**
- **Validation error format.** Confirming that the global `AllExceptionsFilter` from `projects-crud` (envelope `{ statusCode, error, message, timestamp, path }`) is the chosen format for reviews too — and that the `message` field carries the `class-validator` `string[]` shape for `400 Bad Request` from the global `ValidationPipe`. No new wiring; the filter already handles every domain.
- **`is_published`-style leak in `GET /api/v1/reviews` (public).** The public list MUST filter to `is_approved=true` ONLY (mirror the projects public list's `isPublished=true` default). The admin list shows everything. If the proposal accepts an `?isApproved=` query param on the admin list, the test must cover it.
- **Author role / PII surface.** `author_role` (free text, e.g. "CTO en Startup X") is potentially identifying. The proposal should at minimum document what the public list exposes; consider an opt-in `?redactPii=true` flag for the public list, or a normalized "Anonymous" for any author that left `author_name` blank. **Severity: low (privacy).** Linked to §Open question 5.
- **`rating` range enforcement.** DBML has a `note`, not a CHECK. The DTO MUST enforce `@Min(1) @Max(5)` (and the integer-typed column rejects non-integers in the migration). If the user wants a DB-level CHECK for defense in depth, the migration needs to add it.
- **`content` length cap.** `projects-crud` caps `content` at 50 000 chars. Reviews are shorter; pick a reasonable cap (e.g. 2 000 chars for the review body, 1 000 for a comment). The proposal should justify the number.
- **PII / GDPR (jurisdictional, low likelihood).** The user is in Venezuela; the system is single-admin. Storing `author_name` free text of anonymous visitors is a small risk, but the user did not ask for retention policies. **Surface in the proposal; do not act.**
- **Out-of-spec stub routes.** The scaffold has `GET /reviews/:id` and `PATCH /reviews/:id` (with `UpdateReviewDto extends PartialType(CreateReviewDto)`). Neither is in §3.3. The proposal MUST either remove them or move them under `/admin/reviews/:id` and re-state the spec. Leaving them is a leak.

## Estimated size of the change (rough)

**Magnitude: medium.** Reading the projects-crud archive as a reference (~670 LOC over 4 chains), reviews-domain will land in roughly the same ballpark once you account for:

- 2 entities (`ReviewEntity`, `ReviewCommentEntity`) + 1 FK relation on `project_id` (subject-modeling dependent).
- 5–6 DTOs (`CreateReviewDto`, `CreateReviewCommentDto`, `ListReviewsQueryDto`, `ListReviewsResponseDto`, `ReviewResponseDto`, `ReviewCommentResponseDto`, plus possibly `UpdateReviewDto` if §Open question 8 keeps editing).
- 1 mapper (`to-review-response.mapper.ts`).
- 6 controller routes, 4 of which need Swagger + JwtAuthGuard annotation.
- 1 service with 6 methods, one of which (create) is subject-modeling dependent.
- 1 module update.
- 1 hand-written migration (review + review_comments + indexes + CHECK constraints, if the user picks option 1/2).
- Colocated `*.spec.ts` for entities, DTOs, controller, service.
- 1 e2e file in `test/`.
- A `seed-reviews.ts` CLI only if §Open question 6 says yes.
- A `src/reviews/README.md` (recommended, not required).

Realistic lower bound: ~350 LOC. Upper bound (with seed, with full e2e, with README, with `update`): ~600 LOC. The **400-line soft cap is borderline** — at the upper end the change will need an explicit `apply-progress` cut or an exception note in the proposal. **Do not commit to a number; the proposal phase should forecast against the 400-line budget once the subject-modeling choice is locked.**

## What I did NOT explore

- **No test runs.** `npm test`, `npm run test:e2e`, `npm run build` were not executed. This is exploration only.
- **No real Postgres.** Per the precedent in `20260618205116-create-projects-and-project-urls.ts`, there is no live DB in the dev environment. Migrations are hand-written; a `docker run` verification step is referenced in that file's comments.
- **No frontend / no UI specs beyond what `ui_specs.md` declares.** There is no `front-office` project in this repo, and `ui_specs.md` does not describe the "Leave a Review" form's fields in detail (e.g., which subject the form picks, whether the comment box is part of the modal or a separate page).
- **No review of admin UI patterns.** The user mentioned "panel de administración para su visualización" — that is presumably part of the (separate) frontend project. No admin UI work is in scope for this backend change.
- **No review of seed-superuser / seed-projects precedent against an admin user model.** The reviews domain is the first one to reference a "subject" outside the `projects` table; the design phase may want to consult the seed-superuser CLI (`src/cli/seed-superuser.ts`) for the canonical superuser row id pattern, but I did not load that file in detail.
- **No review of `seed-projects.spec.ts`.** I confirmed `src/cli/seed-projects.ts` exists and uses a `SEED_DRY_RUN` flag. I did not study the test file in detail; the reviews seed (if §Open question 6 says yes) should mirror it.
- **No review of the `apply-progress.md` format.** I noted its existence in the git log but did not read the most recent version. The proposal should reference it but the sdd-tasks phase owns its content.
- **No review of `src/contact/contact.service.ts`.** The contact domain is the closest analogue (public POST + admin list); I read the controller and verified it is still a stub. The contact service file may have additional patterns to mirror; I left this for the design phase to confirm.
- **No commit / branch plan.** That is `sdd-tasks`'s job. This file is a deliberate read-only.

## Recommended next step

`sdd-propose`, but **gated** on the following:

1. The user picks one of the §Candidate modeling options for the subject (or accepts a different approach).
2. The user confirms the anti-spam stance (no protection, or throttler, or IP capture).
3. The user confirms the comment-moderation stance.
4. The user confirms the cascade on review delete.
5. The user picks a public PII redaction stance for `authorRole` / `authorName`.

Items 1–4 are blocking; item 5 can be deferred to the design phase if the user prefers.

If the user wants to "follow the DBML strictly" and refuses any schema delta, the proposal scope shrinks to **owner-only reviews** and items 1, 2, 3, 5 simplify materially — but item 4 (cascade) still needs an answer because the DBML is silent on it.

A `state.yaml` for the DAG should mark this change as `phase: explore-complete` and the next pending phase as `sdd-propose` with the gating questions above as the inputs the user must answer first.
