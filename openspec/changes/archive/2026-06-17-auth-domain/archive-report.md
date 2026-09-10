# Archive Report: auth-domain

- **Status**: success
- **Date**: 2026-06-17
- **Change**: auth-domain
- **Branch**: domain/auth
- **Archived to**: `openspec/changes/archive/2026-06-17-auth-domain/`

## Commits archived

The 10 change-specific commits retained in the audit trail, listed in
chronological order (oldest first). The 3 pre-existing branch-baseline
commits ahead of `origin/domain/auth` (`7413fb2` archive bootstrap, `e630769`
reconcile bootstrap, `305a1ce` dead-test removal) are NOT part of this
change and are excluded.

| SHA       | Summary                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `512ad85` | `[auth-domain/slice-A] chore(auth): add typeorm/passport/bcrypt/pg deps and 5 new Joi keys`          |
| `1278b86` | `[auth-domain/slice-A] feat(data): wire TypeORM and add User entity`                                 |
| `2bd505e` | `[auth-domain/slice-B] feat(auth): bcrypt password + JWT sign/verify + AuthService methods`          |
| `cfb3012` | `feat(auth): controller endpoints, DTOs, Swagger tags`                                               |
| `3b65cfa` | `feat(auth): JwtStrategy + JwtAuthGuard per-controller`                                              |
| `38c914c` | `feat(cli): seed:superuser script`                                                                   |
| `ffec496` | `chore(specs): mark auth-domain slice-B tasks (§4 + §5) as complete`                                 |
| `37ef3fe` | `chore(specs): commit untracked auth-domain phase artifacts`                                         |
| `28c54f6` | `docs(specs): clarify @UseGuards is method-level per NestJS constraint`                              |
| `eb4d35c` | `chore(specs): apply bootstrap test fixup + README; defer spec deltas to archive`                    |

7 work-unit commits + 3 SDD meta-commits. Diff range
`7413fb2..eb4d35c` = 10 commits, **3.360 LOC net** (1.860 production +
1.500 tests).

## Specs merged

### NEW capability: `openspec/specs/auth-domain/spec.md`

5 ADDED Requirements, 22 scenarios total (per `verify-report.md`):

1. **User Entity** — 3 scenarios
2. **Login Endpoint** — 4 scenarios
3. **Refresh Token Rotation** — 3 scenarios
4. **Refresh Token Reuse Detection** — 2 scenarios
5. **Refresh Token Storage** — 2 scenarios
6. **Refresh Cookie Transport** — 3 scenarios
7. **Logout Endpoint** — 3 scenarios
8. **Profile Endpoint** — 4 scenarios
9. **JwtAuthGuard** — 3 scenarios
10. **Seed Superuser CLI** — 4 scenarios

Source: `openspec/changes/auth-domain/specs/auth-domain/spec.md`
(post-wording-fixup state from commit `28c54f6`). Heading updated
from `# Delta for \`auth-domain\`` to `# auth-domain` per the
bootstrap-api-config archive pattern. Body text cleaned of
change-dir-only path references (the source file in the archived
change dir retains its original delta heading + path references for
audit trail).

### MODIFIED capability: `openspec/specs/server_specs.md`

1 MODIFIED Requirement (the §3.1 route list) + 5 ADDED Requirements
mirrored to the §4 environment-variable list. The new content is the
surgical merge of `openspec/changes/auth-domain/specs/server_specs/spec.md`
into the existing canonical file:

1. **§3.1 Auth Domain Routes** — extended from 2 routes to 4
   (`POST /api/v1/auth/login`, `POST /api/v1/auth/refresh`,
   `POST /api/v1/auth/logout`, `GET /api/v1/auth/profile`); added
   cross-reference to the new `auth-domain` capability spec
   (`openspec/specs/auth-domain/spec.md`).
2. **§4 Environment Variable Management** — added 5 new required
   variables to the bootstrap Joi list: `JWT_EXPIRES_IN`,
   `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `SUPERUSER_EMAIL`,
   `SUPERUSER_PASSWORD`. Added forward-pointer to the
   `auth-domain` capability spec for the validation rules
   (`JWT_REFRESH_SECRET` ≥ 32 chars and ≠ `JWT_SECRET`;
   `JWT_REFRESH_EXPIRES_IN` positive integer seconds;
   `SUPERUSER_PASSWORD` ≥ 8 chars).

The CORS line in §2 was NOT modified — the existing canonical text
already cross-references the `api-bootstrap` capability, and the
delta did not require additional text there. All other sections
(§3.2 Projects, §3.3 Reviews, §3.4 Contact, §3.5 Global API Prefix)
are byte-for-byte identical to the pre-archive state.

### MODIFIED capability: `openspec/specs/database-schema.dbml`

1 ADDED table (`refresh_tokens`) appended at the end of the file:

- `id` (uuid, pk)
- `user_id` (uuid, FK → `users.id`, not null)
- `family_id` (uuid, not null, indexed)
- `hashed_token` (varchar, unique, sha-256 hex)
- `expires_at` (timestamp, not null)
- `revoked_at` (timestamp, nullable)
- `replaced_by` (uuid, self-FK, nullable)
- `created_at` (timestamp, default `now()`)
- Indexes: `idx_refresh_tokens_family_id`, `idx_refresh_tokens_user_id`

The `users` table is unchanged (its existing definition is the
source of truth for the `UserEntity` columns; the bootstrap-api-config
archive already established this). No other tables were modified.

## Reconciliation pass (per sdd-archive skill §Task Completion Gate)

`openspec/changes/auth-domain/tasks.md` was reconciled before archive
per the sdd-archive skill's task-completion gate. The persisted tasks
artifact showed 32 of 45 implementation tasks as `- [ ]` (unchecked)
even though `apply-progress.md` (engram obs #15) and the 10 work-unit
commits in the audit trail prove every task is done. The remaining
13 (slice-B tasks 4.1-4.6 and 5.1-5.7) were already flipped to `[x]`
in commit `ffec496`. The 32 stale checkboxes were flipped to `[x]`
via a single `sed -i 's/^- \[ \]/- [x]/g'`, preserving wording,
grouping, and structure byte-for-byte — only the leading `- [ ]` was
changed.

The reconciliation is recorded here so the next reader understands
why the persisted tasks artifact needed a final touch-up: the apply
phase focused on code/test execution (10 work-unit commits) and did
not always flip the corresponding checkbox in `tasks.md`. This is the
same pattern used in the `bootstrap-api-config` archive (see
`openspec/changes/archive/bootstrap-api-config/apply-progress.md`
§"Reconciliation pass").

## Pre-existing issues left for follow-up changes

These are explicitly OUT OF SCOPE for `auth-domain` and are documented
in the `bootstrap-api-config` archive report (carried over):

1. **8 unused-DTO-param lint errors** in
   `src/{auth,contact,projects,reviews}/*.service.ts`. Now reduced to
   **6 errors** because the auth stub service was replaced wholesale.
   The remaining 6 are in `projects`, `reviews`, and `contact` stub
   services. Cleanup change.
2. **Stub DTOs** in `src/{projects,reviews,contact}/dto/`. Each domain
   change will fill its own DTO shapes.
3. **Domain implementation gaps** in `projects`, `reviews`, and
   `contact`. Each domain ships in its own future SDD change.
4. **No DB integration tests.** The e2e harness stubs `DATABASE_URL`
   to satisfy Joi but does not connect to a real Postgres. The
   auth-domain `npm run seed:superuser` CLI is the first code path
   that actually opens a real Postgres connection (out-of-process,
   via `AppDataSource.initialize()`). Integration tests will land
   with the first domain change that ships real CRUD.
5. **Swagger per-endpoint annotations** are not yet on
   `projects`/`reviews`/`contact` controllers. Auth-domain added
   `@ApiTags('auth')` + `@ApiBearerAuth()` to `AuthController` (this
   change), so the per-domain annotation pattern is now established.

## Follow-up changes (explicit)

In addition to the above, auth-domain surfaces the following
first-class follow-up changes:

1. **`typeorm migration:generate` for `refresh_tokens`** — the
   `synchronize: false` policy (per design ADR-3) means the new
   `refresh_tokens` table needs a real migration before `seed:superuser`
   can be invoked against a fresh database. The migration is a
   mechanical translation of the DBML block in
   `openspec/specs/database-schema.dbml`.
2. **Password rotation after first login** — `SUPERUSER_PASSWORD` is
   a bootstrap secret. Production deployments MUST change the seeded
   superuser's password after the first login. Login + change-password
   is a follow-up SDD change (the current auth domain has no
   `PATCH /api/v1/auth/password` endpoint).
3. **Device-management for family-level logout** — the current
   `POST /api/v1/auth/logout` revokes only the presented token
   (spec question #3 resolved). A future "log out everywhere"
   capability will add a `POST /api/v1/auth/logout-all` endpoint
   that walks the user's families and revokes the whole
   `family_id` set.

## Audit trail

`openspec/changes/archive/2026-06-17-auth-domain/` contains the full
history of the change:

- `proposal.md` — intent, scope, capabilities contract
- `design.md` — 10 ADRs, sequence diagrams, file-by-file plan
- `tasks.md` — 45 substeps, all marked `[x]` (reconciled in this pass)
- `specs/auth-domain/spec.md` — NEW capability source (5 Requirements)
- `specs/server_specs/spec.md` — delta source (1 MODIFIED + 5 ADDED)
- `specs/database-schema/spec.md` — delta source (1 ADDED table)

`openspec/specs/auth-domain/spec.md` is the merged NEW capability
(heading swapped from `# Delta for \`auth-domain\`` to `# auth-domain`
per the bootstrap-api-config archive pattern). `openspec/specs/server_specs.md`
is the merged MODIFIED capability (2 surgical edits applied; the
rest of the file is byte-for-byte identical to the pre-archive
state). `openspec/specs/database-schema.dbml` is the merged MODIFIED
DBML (1 new table appended; the rest is byte-for-byte identical).

## Archive rules applied (`openspec/config.yaml > rules.archive`)

- ✅ "Warn before merging destructive deltas" — the deltas are
  additive/non-destructive (1 NEW + 1 MODIFIED add-only + 1 MODIFIED
  add-only, 0 REMOVED, 0 RENAMED, 0 destructive edits). No warning
  needed.
- ✅ "Update `openspec/specs/server_specs.md` with merged deltas" —
  2 surgical edits applied (§3.1 routes + §4 env list).
- ✅ "Update `openspec/specs/database-schema.dbml` when entity
  shapes change" — 1 new table appended (`refresh_tokens`).
- ✅ "Use ISO date format (YYYY-MM-DD) for archive folder prefix" —
  `2026-06-17-auth-domain` (today is 2026-06-17).
- ✅ "Archive is an audit trail — never delete or modify archived
  changes" — the change folder is preserved at
  `openspec/changes/archive/2026-06-17-auth-domain/`.

## Next

The orchestrator will commit the archive (3 spec syncs + 1 tasks
reconciliation + 1 folder move + 1 archive report). After that
commit, `auth-domain` is closed and `domain/auth` is ready for the
user to push and open a PR. No new SDD change is opened by this
archive; the next change (likely `typeorm-migration-refresh-tokens`
or the first non-auth domain) lands on top of this foundation.
