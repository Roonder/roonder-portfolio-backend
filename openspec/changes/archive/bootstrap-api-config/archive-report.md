# Archive Report: bootstrap-api-config

- **Status**: success
- **Date**: 2026-06-15
- **Change**: bootstrap-api-config
- **Branch**: domain/auth
- **Archived to**: `openspec/changes/archive/bootstrap-api-config/`

## Commits archived

The 9 change-specific commits retained in the audit trail (6 work-unit
commits + 3 SDD meta-commits), listed in chronological order. The 3
pre-existing branch-baseline commits ahead of `origin/domain/auth`
(`1fc4495` MIT license, `ea1d43d` README replacement, `a00374b` SDD
bootstrap) are NOT part of this change and are excluded.

| SHA       | Summary                                                                   |
| --------- | ------------------------------------------------------------------------- |
| `3b75743` | chore(app): wire ConfigModule globally with ENV_CONFIG Joi schema         |
| `a2eeb87` | feat(main): apply api/v1 prefix, global ValidationPipe, CORS, and Swagger |
| `8984b76` | test(e2e): cover bootstrap behavior                                       |
| `82a5d16` | feat(main): use CORS origin function to skip mismatched origins           |
| `34e3254` | docs(readme): document prefix, Swagger, and DTO conventions               |
| `32f944b` | style(main): prettier reformat of ConfigService.get call                  |
| `cf2f17b` | docs(sdd): persist bootstrap-api-config artifacts and reconcile design    |
| `2603a15` | docs(sdd): verify bootstrap-api-config (status: pass)                     |
| `305a1ce` | test(e2e): remove dead Hello World! scaffold test                         |
| `e630769` | chore(sdd): reconcile bootstrap-api-config artifacts for archive          |

## Specs merged

### NEW capability: `openspec/specs/api-bootstrap/spec.md`

5 ADDED Requirements, 11 scenarios total (per `verify-report.md`):

1. **Global API Prefix** — 2 scenarios
2. **Global Validation Pipe** — 2 scenarios
3. **CORS Reflecting Frontend Origin** — 2 scenarios
4. **Swagger API Documentation** — 3 scenarios
5. **Typed Environment Access via ConfigService** — 2 scenarios

Source: `openspec/changes/bootstrap-api-config/specs/api-bootstrap/spec.md`
(headings: `# api-bootstrap`, `## ADDED Requirements` — the file is the
canonical capability spec, not a delta). Moved with `git mv` (history
preserved as rename).

### MODIFIED capability: `openspec/specs/server_specs.md`

5 MODIFIED Requirements + 1 ADDED Requirement (the orchestrator prompt
listed "4 MODIFIED + 1 ADDED"; the actual delta file has 5 MODIFIED +
1 ADDED, which matches `verify-report.md` §"Spec merge preview"). All
5 MODIFIED requirements applied surgically to the existing spec
byte-for-byte except for the replaced lines:

1. **CORS in §2 Authentication & Security** — new text adds
   `Access-Control-Allow-Origin` reflects `FRONTEND_URL`, `credentials: true`,
   and the cross-reference to the new "Global API Prefix" section.
2. **Auth Domain Routes (§3.1)** — both paths gain `/api/v1` prefix
   (`POST /api/v1/auth/login`, `GET /api/v1/auth/profile`).
3. **Projects Domain Routes (§3.2)** — every path gains `/api/v1` prefix
   (5 routes).
4. **Reviews Domain Routes (§3.3)** — every path gains `/api/v1` prefix
   (6 routes, including the `/admin/reviews` group).
5. **Contact Domain Routes (§3.4)** — every path gains `/api/v1` prefix
   (3 routes), and the DTO-validation bullet now references the global
   `ValidationPipe` options.

The 1 ADDED Requirement:

1. **Global API Prefix (cross-reference)** — new `### 3.5. Global API
Prefix` section under §3 Domain Specifications, pointing to the
   `api-bootstrap` capability spec for full semantics. No scenarios
   duplicated.

`prettier --check` passes on the merged file.

### REMOVED

None.

### RENOVATED

None.

## Pre-existing issues left for follow-up changes

These are explicitly OUT OF SCOPE for `bootstrap-api-config` and are
documented in `verify-report.md` §"Pre-existing issues explicitly noted
as OUT OF SCOPE". They are listed here as informational only; each
becomes its own future SDD change.

1. **8 unused-DTO-param lint errors** in
   `src/{auth,contact,projects,reviews}/*.service.ts`
   (`createXxxDto` / `updateXxxDto` declared but unused). These are
   placeholder DTOs in stub services. Domain cleanup change.
2. **Empty DTO stubs** in `src/{auth,projects,reviews,contact}/dto/`.
   Each domain change will fill its own DTO shapes.
3. **Domain implementation gaps** in `auth`, `projects`, `reviews`, and
   `contact`. Each domain ships in its own future SDD change
   (auth login flow, projects CRUD, reviews moderation, contact email
   pipeline). The current controllers in those four modules are
   scaffolds that return 201 on `POST /api/v1/<domain>` because the
   stub handlers accept any body.
4. **No DB integration tests.** The e2e harness stubs `DATABASE_URL`
   to satisfy Joi but does not connect to a real Postgres. Database
   integration tests will land with the first domain change that
   actually needs Postgres (likely the `projects` change, since it
   owns the first real entity surface).
5. **Swagger per-endpoint annotations** are not yet on domain
   controllers (no `@ApiTags`, `@ApiOperation`, `@ApiBearerAuth()` on
   individual routes). Wiring is in place; annotation is a per-domain
   concern (see SUGGESTION #1 below).

## 5 SUGGESTION findings from verify-report.md

Verbatim, as guidance for the future domain change:

1. **Domain controller annotation.** The `api-bootstrap` capability is
   now the foundation; future domain changes (auth, projects, reviews,
   contact) should annotate their controllers with `@ApiTags`,
   `@ApiOperation`, `@ApiResponse`, and `@ApiBearerAuth()` to populate
   the OpenAPI document. `src/main.ts` already calls `addBearerAuth()`
   and the spec asserts the scheme is registered, so the per-endpoint
   annotations are the natural next step.

2. **Extend the bootstrap e2e to cover the per-endpoint prefix once
   domain controllers are real.** The current `__bootstrap_fixture`
   test covers the pipe but not the domain controllers. When the auth
   change lands, add a real `POST /api/v1/auth/login` flow assertion.
   This is informational — not a gap in this change.

3. **Add a domain-routing smoke test** to `test/bootstrap.e2e-spec.ts`
   that asserts every domain controller's declared routes resolve
   under `/api/v1/...` automatically (no manual prefixing in the
   controllers). The current spot-check via `src/main.spec.ts:40-56`
   exercises only the auth module; extending it to
   projects/reviews/contact would catch a controller-level mistake
   early. Again — informational, not a gap.

4. **Consider a domain-routing test convention in the README.** The
   current "DTO conventions" subsection documents the ADR-2 rule. A
   future "Routing conventions" subsection could codify "controllers
   declare paths without the global prefix; the prefix is applied at
   bootstrap." This would lock in the prefix application point and
   reduce the chance of a future contributor hand-prefixing a
   controller path.

5. **Style commit (`32f944b`).** The
   `style(main): prettier reformat` commit is a small follow-up after
   a `ConfigService.get` call was reformatted. Future work-unit splits
   should bundle formatting into the originating change so a
   stand-alone style commit does not appear in the history. The commit
   is harmless but reduces review clarity; not a blocker.

## Audit trail

`openspec/changes/archive/bootstrap-api-config/` contains the full
history of the change:

- `proposal.md` — intent, scope, capabilities contract
- `design.md` — 6 ADRs, bootstrap sequence diagram, file-by-file plan
- `tasks.md` — 35 substeps, all marked done (`[x]`)
- `apply-progress.md` — phase-by-phase TDD evidence table and reconciliation log
- `verify-report.md` — PASS, no CRITICAL, no WARNING
- `specs/api-bootstrap/spec.md` — NEW capability source (5 ADDED Requirements)
- `specs/server_specs/spec.md` — delta source (5 MODIFIED + 1 ADDED, 0 REMOVED, 0 RENAMED)

`openspec/specs/api-bootstrap/spec.md` is the merged NEW capability
(file already has the canonical `# api-bootstrap` heading per the
reconciliation pass — no transformation was needed). `openspec/specs/server_specs.md`
is the merged MODIFIED capability (5 surgical edits applied; the rest
of the file is byte-for-byte identical to the pre-archive state).

## Next

The orchestrator will commit the staged changes (4 renames in the
archive folder, 1 rename of the new capability, 1 modification of
`server_specs.md`, plus the archive report). After that commit,
`bootstrap-api-config` is closed and `domain/auth` is ready to push
and open a PR. No new SDD change is opened by this archive; the
domain implementation work (auth login, projects CRUD, reviews
moderation, contact email pipeline) lands as its own future changes
on top of this foundation.

## Pre-archive reconciliation (informational)

Per `apply-progress.md` §"Reconciliation pass", the change was
bookkeeping-reconciled before archive:

- `tasks.md` checkboxes flipped from `- [ ]` to `- [x]` for all 35
  substeps (wording, grouping, and structure preserved).
- Spec deltas re-wrapped from flat files (`specs/api-bootstrap.md`,
  `specs/server_specs.md`) to the `specs/<capability>/spec.md` layout
  using `git mv` (history preserved as renames).
- The `api-bootstrap` heading was swapped from
  `# Delta for api-bootstrap` to `# api-bootstrap` because the
  capability is brand-new — the merged file is canonical, not a
  delta.

The reconciliation commit (`e630769`) is the last commit on the
branch. Archive ran against the reconciled state.

## Archive rules applied (`openspec/config.yaml > rules.archive`)

- ✅ "Warn before merging destructive deltas" — the delta is
  additive/non-destructive (5 MODIFIED + 1 ADDED, 0 REMOVED, 0
  RENAMED). No destructive merges performed. No warning needed.
- ✅ "Update openspec/specs/server_specs.md with merged deltas" — 5
  surgical edits applied.
- ✅ "Update openspec/specs/database-schema.dbml when entity shapes
  change" — no entity shapes changed in this change (domain
  implementations are out of scope). No DBML update needed.
