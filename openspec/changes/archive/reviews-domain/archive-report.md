# Archive Report: reviews-domain

- **Status**: success_with_warnings (verify-verdict inherited)
- **Date**: 2026-06-19
- **Change**: reviews-domain
- **Branch**: `domains/reviews`
- **Archived to**: `openspec/changes/archive/reviews-domain/`
- **Verify verdict**: **PASS WITH WARNINGS** (per `verify-report.md` — 55/55 scenarios PASS, 0 FAIL, 0 CRITICAL, 2 WARNING documented trade-offs, 4 SUGGESTION future hardening)

## Summary

`reviews-domain` lands the full Reviews domain on the
`bootstrap-api-config` + `auth-domain` + `projects-crud` +
`global-exception-filter` foundations: 2 TypeORM entities
(`ReviewEntity` 7 cols, `ReviewCommentEntity` 6 cols including
`is_approved`), 7 HTTP routes (4 public throttled + 3 admin
JWT-guarded), 1 hand-written TypeORM migration with
`ON DELETE CASCADE`, a 2-controller split
(`ReviewsController` + `ReviewsAdminController`), the
`{ data, total, page, pageSize }` envelope, the existence-leak
guard with documented asymmetry (ADR-11), and `@nestjs/throttler`
wired at the module level with per-route decorators and 3
Joi-validated env vars. Delivered as **46 trunk-based commits**
on `domains/reviews` since the `0614d6e` base (25 work-unit +
21 `apply-progress` markers; T8 and T16 each split into 3
sub-tasks honored). Net: **1,266 production + 3,559 tests =
4,825 total LOC**, plus the canonical DBML delta and the
`server_specs.md` §3.3 update.

The implementation is **behavior-equivalent to the spec
line-by-line**. All 4 locked product decisions pass verification
(no subject polymorphism; `@nestjs/throttler` per-IP + 3 Joi env
vars + public POSTs only; `is_approved default false` on
`review_comments` with public GET filter; `ON DELETE CASCADE`
on the FK with no manual `comments.delete`). All 15 design
ADRs pass verification. The change is **archive-eligible**:
0 CRITICAL, 2 WARNING (both documented trade-offs), 4
SUGGESTION (forward-looking).

## What changed (in scope)

- **`ReviewEntity`** (7 cols) + **`ReviewCommentEntity`** (6 cols
  incl. `is_approved`); both registered in `AppDataSource` AND
  `ReviewsModule`; FK CASCADE on `review_comments.review_id`.
- **Hand-written TypeORM migration**
  (`20260620020316-create-reviews-and-review-comments.ts`, 91
  lines): 2 tables + 3 indexes + idempotent
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS is_approved` safety
  net (ADR-14). Reversible.
- **DTOs** (8 files): `CreateReviewDto`, `CreateReviewCommentDto`,
  `ListReviewsQueryDto`, `ListCommentsQueryDto`,
  `ListReviewsResponseDto`, `ListCommentsResponseDto`,
  `ReviewResponseDto`, `ReviewCommentResponseDto`, plus
  `review-response.mapper`. The `UpdateReviewDto` stub is
  **DELETED** (locked #8).
- **`ReviewsService`** (8 methods): `create` (sets
  `isApproved: false`), `findAllApproved` (filters
  `WHERE is_approved = true` + pageSize silent cap at 100),
  `findAllForAdmin` (all by default + `?isApproved` filter),
  `toggleApproval` (flip-flop, 404 on missing), `remove` (204,
  NO manual `comments.delete` — FK CASCADE does the work),
  `addComment` (404 ONLY on missing parent — asymmetric per
  ADR-11), `findApprovedCommentsByReviewId` (404 on missing OR
  unapproved with byte-equal body — existence-leak guard).
- **`ReviewsController`** (4 public routes): `POST /api/v1/reviews`
  (`@ThrottledWrite()`), `GET /api/v1/reviews` (`@ThrottledRead()`),
  `POST /api/v1/reviews/:id/comments` (`@ThrottledWrite()`),
  `GET /api/v1/reviews/:id/comments` (`@ThrottledRead()`). All
  `:id` params use `ParseUUIDPipe` (scaffold's `+id` numeric
  coercion bug is gone).
- **`ReviewsAdminController`** (3 protected routes, class-level
  `@UseGuards(JwtAuthGuard) @ApiBearerAuth()`):
  `GET /admin/reviews`, `PATCH /admin/reviews/:id/approve`,
  `DELETE /admin/reviews/:id` (204, FK cascade). **No
  `@Throttle()` on any admin method** (ADR-4).
- **`@nestjs/throttler` integration**:
  `ThrottlerModule.forRootAsync` in `AppModule` (NOT
  `APP_GUARD` — ADR-2), reading 3 env vars via
  `ConfigService<EnvConfig>`: `REVIEWS_THROTTLE_TTL_MS` (default
  60 000), `REVIEWS_THROTTLE_WRITE_LIMIT` (default 5),
  `REVIEWS_THROTTLE_READ_LIMIT` (default 60). `ThrottledWrite()`
  and `ThrottledRead()` factories in
  `src/reviews/throttle.decorator.ts` read `process.env` at
  decoration time with the Joi defaults as fallbacks.
- **`app.set('trust proxy', 1)` in `main.ts` BEFORE
  `useGlobalPipes`** — locked in by
  `src/main.spec.ts:307-324` (order assertion via `indexOf`).
- **Global `AllExceptionsFilter` extension**: added
  `TOO_MANY_REQUESTS: "Too Many Requests"` to `STATUS_LABELS`
  so the canonical 429 envelope reads "Too Many Requests"
  (ADR-12). The filter does NOT strip `Retry-After` (verified
  by static source-read in `all-exceptions.filter.spec.ts:320-336`).
- **`seed-reviews.ts` CLI** + spec (420 LOC, W1) — mirrors
  `seed-projects.ts` with `SEED_DRY_RUN=1`; inserts 3 approved
  + 2 pending reviews, comments `isApproved: false`. Registered
  in `package.json` as `seed:reviews`.
- **Domain README** (`src/reviews/README.md`, T18) — endpoints
  table (7 routes) + throttler section (3 env vars + disable
  knob).
- **E2E suite** (`test/reviews.e2e-spec.ts`, 1 199 LOC across
  T16a/b/c) — full HTTP coverage of the 7 routes + throttler
  shape + existence-leak + FK CASCADE contract.

### Out of scope (follow-up changes own these)

`PATCH /api/v1/admin/reviews/:commentId/approve` (admin moderation
of comments); `PATCH /api/v1/reviews/:id` (review content edit);
reply threading; email notification on new review; FTS / ranking
/ sentiment; per-`author_name` rate-limit / CAPTCHA / IP capture;
GDPR retention; soft delete; i18n; HTTP cache; DB-level
`CHECK (rating BETWEEN 1 AND 5)`; Redis-backed throttler;
`RequestIdMiddleware` (carried over from `projects-crud`);
real-DB e2e subset; top-level `README.md` cross-link.

## Verification outcome

Per `verify-report.md` (PASS WITH WARNINGS):

- **55/55 spec scenarios PASS** (38/38 in `reviews-domain`;
  17/17 in `reviews-throttling`).
- **0 CRITICAL** — zero spec scenario missing a passing covering
  test; zero covering test fails; zero locked decision deviates;
  zero ADR deviates; zero out-of-scope item leaked.
- **2 WARNING** — both documented trade-offs:
  - **W1**: T17 (`seed-reviews.ts` + spec) is **420 LOC**,
    exceeding the 400-line review budget. 20-LOC overrun is
    small; the CLI + spec is a single coherent deliverable.
  - **W2**: File inventory is **49 files** vs the design's
    stated **43 files**. The 6 extras are required:
    `package-lock.json` (auto), `seed-projects.spec.ts`
    (prettier reformat), `all-exceptions.filter.ts` (added
    `STATUS_LABELS[429]` for ADR-12), `data-source.spec.ts`
    (T4 follow-up), `env.config.spec.ts` (T1 follow-up),
    `bootstrap.e2e-spec.ts` (T11 follow-up). The design's
    43-file count was a rough estimate.
- **4 SUGGESTION** — all forward-looking: T17 sub-split if it
  grows; real-DB e2e; top-level README cross-link; automated
  runtime 429 trigger test (the `npm run start:dev + curl`
  recipe in the README closes the loop manually).

The 4-step verification gate was re-run after the archive
commits:

| Gate | Result |
|---|---|
| `npm run lint` | 2 pre-existing errors in `src/contact/contact.service.ts` (out of scope, contact domain owns them). 0 NEW errors. |
| `npm test` | 35 suites, 321 tests passed, 1 skipped, 0 failures. |
| `npm run build` | Clean. `nest build` produces no output. |
| `npm run test:e2e` | 4 suites, 84 tests passed, 0 failures. |

## Files archived

`openspec/changes/archive/reviews-domain/` (audit trail; no
date prefix per the `projects-crud` precedent in this project —
the orchestrator's launch instructions specified the
change-name-only format):

- `proposal.md` — 894 lines, intent, scope, capabilities contract
- `design.md` — 1 223 lines, 15 ADRs, architecture diagram
- `tasks.md` — 1 216 lines, 18 tasks (T1-T18 with T8 and T16
  expanded to a/b/c sub-splits), all marked `[x]` (reconciled
  in this pass)
- `apply-progress.md` — 30 lines, 22 task entries (one per
  work-unit commit, including the T8 and T16 sub-splits)
- `verify-report.md` — 536 lines, 55 scenarios × 1 covering
  test, locked-decision table, 4-step verification gate verbatim
- `explore.md` — 199 lines, initial exploration notes
- `specs/reviews-domain/spec.md` — 644 lines, 13 Requirements,
  38 Scenarios (delta source; canonical at
  `openspec/specs/`)
- `specs/reviews-throttling/spec.md` — 270 lines, 4 Requirements,
  17 Scenarios (delta source; canonical at
  `openspec/specs/`)
- `archive-report.md` (this file)

## Files synced to canonical

### NEW capability: `openspec/specs/reviews-domain/spec.md`

13 ADDED Requirements, 38 scenarios total:

1. ReviewEntity (3)
2. ReviewCommentEntity (2)
3. Submit Review (Public) (6)
4. List Approved Reviews (Public) (5)
5. List All Reviews For Admin (Protected) (4)
6. Toggle Review Approval (Protected) (5)
7. Add Comment To Review (Public) (5)
8. Delete Review (Protected) (3)
9. List Approved Comments For Review (Public) (3)
10. Pagination Envelope (2)
11. Validation Error Format (2 — inherited from
    `global-exception-filter`)
12. 404 Existence-Leak Guard On Public Reads (4 — covering the
    asymmetric `addComment` does-not-404 + the byte-equal
    missing/unapproved `findApprovedCommentsByReviewId`)

Source: `openspec/changes/archive/reviews-domain/specs/reviews-domain/spec.md`
(headings: `# reviews-domain`, `## ADDED Requirements` — the
file is the canonical capability spec, not a delta, so no
heading swap or body transformation was needed). Copied via
`cp` (the archive keeps its own byte-identical audit-trail
copy). Top-level structure mirrors
`openspec/specs/projects-domain/spec.md` and
`openspec/specs/auth-domain/spec.md`.

### NEW capability: `openspec/specs/reviews-throttling/spec.md`

4 ADDED Requirements, 17 scenarios total:

1. Throttler Module Registration (3)
2. Per-Route Throttle Limits (4)
3. Throttle Response Shape (3)
4. Trust Proxy For req.ip (2)
5. Configurable Limits via Joi (5)

Source: `openspec/changes/archive/reviews-domain/specs/reviews-throttling/spec.md`.
Copied via `cp`. The throttler integration is a NEW
cross-cutting capability owned by the reviews domain for now;
a future change could promote it to a top-level capability
if more domains adopt it.

### MODIFIED: `openspec/specs/database-schema.dbml`

1 surgical edit on the `review_comments` table (per
`openspec/config.yaml > rules.archive` rule "Update
`openspec/specs/database-schema.dbml` when entity shapes
change"):

- Added `is_approved boolean [default: false]` column.
- Added `note: 'ON DELETE CASCADE'` on the
  `review_comments.review_id` FK.

```diff
 Table review_comments {
   id uuid [pk, default: `uuid_generate_v4()`]
-  review_id uuid [ref: > reviews.id, not null]
+  review_id uuid [ref: > reviews.id, not null, note: 'ON DELETE CASCADE']
   author_name varchar [default: 'Anónimo']
   content text [not null]
+  is_approved boolean [default: false] // Moderación pública: solo se exponen comentarios aprobados
   created_at timestamp [default: `now()`]
 }
```

The `reviews` table is unchanged (it already has `is_approved
boolean [default: false]` per the original DBML — locked #3
is about the new column on `review_comments`, not on
`reviews`). No other tables were modified.

### MODIFIED: `openspec/specs/server_specs.md`

1 surgical edit on §3.3 (per
`openspec/config.yaml > rules.archive` rule "Update
`openspec/specs/server_specs.md` with merged deltas"):

- Added the 7th route `GET /api/v1/reviews/:id/comments`
  (per clarifier #7 default, added in this change, not part
  of the original §3.3).
- Added a one-line note that the 7th route belongs to
  `reviews-domain`, and a forward-pointer to the
  `openspec/specs/reviews-domain/spec.md` capability spec for
  the full throttler/envelope/cascade contract.

```diff
 - `POST /api/v1/reviews/:id/comments`: Adds a comment to a specific review (Public).
+- `GET /api/v1/reviews/:id/comments`: Lista los comentarios aprobados de una reseña (Public).
 - `DELETE /api/v1/admin/reviews/:id`: Deletes a review (Protected).

+> `GET /api/v1/reviews/:id/comments` (7ª ruta) fue añadida en el change `reviews-domain` (ver `openspec/changes/archive/reviews-domain/` y la capability spec `openspec/specs/reviews-domain/spec.md`). El throttler, el envelope canónico, y el contrato `is_approved`/`ON DELETE CASCADE` viven en la capability spec.
+
 ### 3.4. Contact Domain
```

All other sections (§3.1 Auth, §3.2 Projects, §3.4 Contact,
§3.5 Global API Prefix, §4 Environment Variables) are
byte-for-byte identical to the pre-archive state.

## Commits archived

46 change-specific commits retained in the audit trail; full
chronological table is preserved in
`apply-progress.md` (22 entries with commit SHAs + LOC deltas).
The 5 archive commits (`cc3e93b`, `933f9eb`, `88743a4`, `04111df`,
`2e9a64e`) sit on top. Total branch position: **51 commits
ahead of `origin/domains/reviews`**.

**Sub-splits fired**:

- **T8a / T8b / T8c** — the 8-method `ReviewsService` was split
  into 3 work-unit commits when the original 600-LOC forecast
  threatened the 400-line cap. T8a (create, 70+203), T8b
  (findAll, 56+199), T8c (toggle + remove, 27+188).
- **T16a / T16b / T16c** — `test/reviews.e2e-spec.ts` was
  split into 3 work-unit commits matching the 3 controller
  surfaces: T16a (public, 0+500), T16b (admin, 0+277), T16c
  (comments + throttler shape, 0+422).

## Reconciliation pass (per sdd-archive skill §Task Completion Gate)

`openspec/changes/reviews-domain/tasks.md` was reconciled before
archive per the sdd-archive skill's task-completion gate. The
persisted tasks artifact showed **25 implementation sub-tasks as
`- [ ]` (unchecked)** even though `apply-progress.md` (22
entries with commit SHAs) and `verify-report.md` (55/55
scenarios PASS, 195/195 tests passing) prove every task is
done. The reconciliation reason, recorded for the next reader:

> The apply phase focused on code/test execution (25 work-unit
> commits, one per task including T8a/b/c and T16a/b/c) and
> appended entries to `apply-progress.md` with commit SHAs and
> LOC deltas, but the `tasks.md` checkboxes were not flipped
> line-by-line. The verify phase covered 55/55 spec scenarios
> with passing tests, confirming the implementation is
> complete. The reconciliation was a single mechanical
> `sed -i 's/^- \[ \]/- [x]/g'` on `tasks.md`, preserving
> wording, grouping, and structure byte-for-byte — only the
> leading `- [ ]` was changed. After reconciliation, all 25
> sub-tasks are `- [x]`. The archive is audit-trail-ready.

This is the same pattern used in the `auth-domain` archive (see
`openspec/changes/archive/2026-06-17-auth-domain/archive-report.md`
§"Reconciliation pass"): the apply phase focuses on code
delivery, the verify phase proves correctness, and the archive
phase reconciles the persisted artifact to match the proof.

## Pre-existing issues left for follow-up changes

1. **2 pre-existing lint errors** in
   `src/contact/contact.service.ts:7,19` (unused DTO params).
   The contact domain change owns them. The 2 pre-existing
   errors that lived in `src/reviews/reviews.service.ts`
   resolved to 0 as a side effect of T8's rewrite.
2. **`@nestjs/throttler` runtime 429 trigger is not automated-
   tested.** The e2e source-reads the decorator and the filter
   unit spec covers the canonical envelope + `Retry-After`
   preservation, but no automated test issues 6 real
   `POST /api/v1/reviews` to assert a live 429 + `Retry-After`
   header on the wire. The `npm run start:dev + curl` recipe
   in `src/reviews/README.md` (T18) closes the loop manually.
3. **`RequestIdMiddleware` is still pre-existing** (carried
   over from `projects-crud`'s follow-up). The filter is
   already defensive; the middleware is the missing piece for
   5xx correlation in production. Separate future change.
4. **No real-DB E2E subset.** The e2e harness stubs
   `DATABASE_URL` and uses in-memory fakes. The unit suite
   covers the SQL surface at the service level; a real-DB e2e
   would close the loop on the migration's DDL.
5. **T17 420-LOC commit (W1).** The seed CLI + spec is at
   the edge of the 400-line cap. A future change that adds
   50+ LOC to the seed should split T17a / T17b.
6. **No top-level `README.md` cross-link** to
   `src/reviews/README.md` (S3, ~5 lines).

## Open follow-ups (carryover from SUGGESTION findings)

1. **Automated runtime 429 trigger test** (S4, ~30 lines +
   spec file). A separate `test/reviews.throttler.e2e-spec.ts`
   with strict env vars at the top of the file (the per-route
   `@ThrottledWrite()` captures the env at decoration time, so
   the env must be set before the test module loads).
2. **T17 sub-split** (S1). If the seed CLI grows past
   420 LOC, split T17a (CLI) / T17b (spec).
3. **Real-DB e2e subset via docker-compose** (S2). A
   `*.real-db.e2e-spec.ts` file would close the loop on the
   migration's DDL.
4. **Top-level `README.md` cross-link** to
   `src/reviews/README.md` (S3, ~5 lines). Single-source docs.

## Lessons learned

1. **The 2-controller split (`@Controller('reviews')` +
   `@Controller('admin/reviews')`) is the correct shape for
   "public + protected" domains.** Each controller owns one
   guard policy (no guard + per-route `@Throttle()` vs.
   class-level `@UseGuards(JwtAuthGuard)` + no throttler).
   The `ProjectsController` precedent put both surfaces in one
   controller; the 2-controller split here is cleaner for any
   future domain with the same shape.
2. **`@nestjs/throttler` per-route is the correct shape for
   "different limits per endpoint" domains.** The
   `ThrottlerModule.forRootAsync` + `@ThrottledWrite()` /
   `@ThrottledRead()` pattern encapsulates the limit in the
   route itself and lets admin routes opt out completely.
   The factory reads env at decoration time, which is the
   documented trade-off (a runtime e2e needs separate test
   files with strict env).
3. **The `app.set('trust proxy', 1)` placement is critical.**
   It MUST be BEFORE `useGlobalPipes` (or the throttler sees
   `req.ip === '::ffff:127.0.0.1'` for every request). The
   `src/main.spec.ts:307-324` order assertion (via `indexOf`)
   locks this in.
4. **The existence-leak guard asymmetry is the correct shape
   for "comment on unapproved but don't read unapproved".**
   `addComment` 404s only on missing parent (so visitors can
   comment on unapproved reviews — moderation is the toggle);
   `findApprovedCommentsByReviewId` 404s on missing OR
   unapproved with a byte-equal body (so a 1-byte difference
   can't leak the existence of an unapproved review). The
   unit `reviews.service.spec.ts:730-755` asserts the byte-equal
   contract; the asymmetric counterpart is asserted at
   `:640-648` and in the e2e at
   `test/reviews.e2e-spec.ts:943-961`.
5. **`git mv` for untracked files is a footgun.** The
   orchestrator's launch instructions listed `apply-progress.md`
   as untracked, but it WAS tracked (committed in 21 prior
   task commits). The fix is `git add` at the new path +
   `git rm` at the old path, which lets git's rename detection
   recover. Future archives: always check
   `git ls-files --error-unmatch <path>` first.

## Archive rules applied (`openspec/config.yaml > rules.archive`)

- ✅ "Warn before merging destructive deltas" — the deltas are
  additive/non-destructive (2 NEW capabilities + 2 surgical
  MODIFIED edits; 0 REMOVED, 0 RENAMED, 0 destructive edits).
  No warning needed.
- ✅ "Update `openspec/specs/server_specs.md` with merged deltas" —
  1 surgical edit applied (§3.3 added the 7th route + a
  one-line note).
- ✅ "Update `openspec/specs/database-schema.dbml` when entity
  shapes change" — 1 surgical edit applied (added
  `is_approved` to `review_comments` + `note: 'ON DELETE CASCADE'`
  on the FK).
- ⚠️ "Use ISO date format (YYYY-MM-DD) for archive folder prefix"
  — the orchestrator's launch instructions specified
  `openspec/changes/archive/reviews-domain/` (no date prefix),
  so the archive folder name is the change name only. This
  matches the `projects-crud` archive precedent in this
  project; the `auth-domain` archive uses the
  `2026-06-17-auth-domain` date-prefix format. The deviation
  is intentional and matches the orchestrator's explicit
  instruction.
- ✅ "Archive is an audit trail — never delete or modify
  archived changes" — the change folder is preserved at
  `openspec/changes/archive/reviews-domain/`. The
  `apply-progress.md` rename is preserved (git's rename
  detection preserved the history). The new capability spec
  files are preserved in the archive's `specs/` folder for
  audit trail (verbatim copies of the canonical versions;
  byte-identical because no transformation was needed).

## Archive commits (5 commits, Option B)

The archive was split into 5 reviewable work-unit commits per
the user-locked commit strategy ("ONE commit per file / spec /
service / functionality completed"):

| SHA | Commit | Files | LOC |
|---|---|---|---|
| `cc3e93b` | `chore(sdd): archive reviews-domain — move change folder` | 8 (1 rename + 7 new) | +4 982 |
| `933f9eb` | `docs(specs): promote reviews-domain capability to canonical` | 1 (new) | +644 |
| `88743a4` | `docs(specs): promote reviews-throttling capability to canonical` | 1 (new) | +270 |
| `04111df` | `docs(dbml): add is_approved to review_comments table` | 1 (modified) | +2 -1 |
| `2e9a64e` | `docs(server-specs): §3.3 reviews-domain — 7th route (public comments list)` | 1 (modified) | +3 |

Total: 12 files, 5 901 insertions(+), 1 deletion(-), 1 rename.
The `tasks.md` reconciliation (25 stale checkboxes flipped to
`[x]`) is bundled into the first commit (the archive folder
move); the file content differs from the `0614d6e` base only
in the checkbox state.

## Next

The orchestrator has committed the 5 archive commits. After
that, `reviews-domain` is closed and `domains/reviews` is
ready for the user to push and merge to `main`. No new SDD
change is opened by this archive; the next change (likely
`request-id-middleware` to close the 5xx correlation gap, the
top-level `README.md` cross-link, or the first non-reviews
domain — e.g. `contact-pipeline`) lands on top of this
foundation.

The next concrete domain change should be `contact-pipeline`
(the contact domain's full implementation), which can now
reuse the `AllExceptionsFilter` for uniform 4xx/5xx envelopes,
the `ThrottlerModule` for the public contact form, and the
2-controller split (public + admin) pattern.
