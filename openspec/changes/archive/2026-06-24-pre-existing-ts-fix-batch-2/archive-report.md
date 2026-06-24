# Archive Report: pre-existing-ts-fix-batch-2

**Change**: `pre-existing-ts-fix-batch-2` | **Domain**: `pre-existing-ts` (chore) | **Artifact store**: openspec
**Branch**: `fix/ts-batch-2` | **Base**: `bcc7dd4` (HEAD of `domain/contact` post-archive)
**Archive date**: 2026-06-24 | **Archived to**: `openspec/changes/archive/2026-06-24-pre-existing-ts-fix-batch-2/`

## Executive summary

`pre-existing-ts-fix-batch-2` is fully archived. All 9 type-only / test-fixture TypeScript build-error fixes land on `fix/ts-batch-2` as 9 fix commits + 1 `lint --fix` formatting commit (10 total, base `bcc7dd4`). The verify report (`verify-report.md` in this folder) is **PASS WITH WARNINGS** (0 CRITICAL, 4 WARNING, 9/9 spec scenarios COMPLIANT). The new canonical spec `openspec/specs/pre-existing-ts/spec.md` is created from the delta to track this chore capability going forward. The SDD cycle is COMPLETE and the change is ready for the user's PR (`fix/ts-batch-2` → `domain/contact`, then `domain/contact` → `dev`).

---

## Final state

| Field | Value |
| --- | --- |
| Change | `pre-existing-ts-fix-batch-2` |
| Domain | `pre-existing-ts` (chore) |
| Branch | `fix/ts-batch-2` |
| Base commit | `bcc7dd4` (post-`domain/contact` archive) |
| Final commit SHA (pre-archive) | `deea7d5ca47167e75fc9876b854a36693cd9c072` |
| Fix commits | 9 (one per file) |
| Lint --fix commits | 1 (`deea7d5`, autoformatting only) |
| Total commits ahead of `bcc7dd4` | 10 (pre-archive) |
| New archive commits | 2 (canonical spec creation + folder move + archive report) |
| Total commits ahead of `bcc7dd4` (post-archive) | 12 |
| PR target | `domain/contact` first, then `dev` |
| TDD | ACTIVE |
| Verify verdict | **PASS WITH WARNINGS** (0 CRITICAL) |

### Commit history on `fix/ts-batch-2` (pre-archive, 10 commits)

| # | SHA | Subject |
| --- | --- | --- |
| 1 | `d3c5107` | `chore(seed-projects): type test fakes as Pick<Repository<T>, ...>` |
| 2 | `e44bc8f` | `chore(seed-reviews): type test fakes as Pick<Repository<T>, ...>` |
| 3 | `529eb99` | `chore(seed-superuser): type test fake as Pick<Repository<UserEntity>, ...>` |
| 4 | `4eeab10` | `test(all-exceptions): parametrize ConfigService fake with EnvConfig` |
| 5 | `f5ace4d` | `test(data-source): narrow migrations local to string[]` |
| 6 | `31225f8` | `test(projects.controller): double-cast prototype for indexable read` |
| 7 | `7a48e4b` | `test(projects.service): assert .catch result as Error + fix transactionCalls return type` |
| 8 | `9a4daf2` | `test(list-comments-query): cast validate options to bypass ValidatorOptions` |
| 9 | `5f431e1` | `test(reviews-admin.controller): double-cast prototype for indexable read` |
| 10 | `deea7d5` | `chore: lint --fix formatting (apply --fix output to batch 2)` |

### Diff stat vs base `bcc7dd4`

```
 src/cli/seed-projects.spec.ts                    | 83 +++++++++++---------
 src/cli/seed-reviews.spec.ts                     | 98 ++++++++++++++++++++----
 src/cli/seed-superuser.spec.ts                   | 70 +++++++++++------
 src/common/filters/all-exceptions.filter.spec.ts |  9 ++-
 src/data-source.spec.ts                          |  2 +-
 src/projects/projects.controller.spec.ts         | 15 +++-
 src/projects/projects.service.spec.ts            | 17 ++--
 src/reviews/dto/list-comments-query.dto.spec.ts  | 11 ++-
 src/reviews/reviews-admin.controller.spec.ts     |  2 +-
 9 files changed, 216 insertions(+), 91 deletions(-)
```

Production source: 0 files. `src/contact/**`: 0 files. Scope confirmed clean.

---

## Specs synced

This change introduces a **new** capability `pre-existing-ts` (chore). No prior canonical spec existed at `openspec/specs/pre-existing-ts/spec.md`, so the delta spec is copied in full (not merged).

| Domain | Action | Details |
| --- | --- | --- |
| `pre-existing-ts` | **Created** | 9 requirements, 9 Given/When/Then scenarios — full-spec copy from delta |

### Source of truth updated

- `openspec/specs/pre-existing-ts/spec.md` — **created** from the delta (new canonical spec for the `pre-existing-ts` chore capability).

The 9 requirements in the delta spec become the canonical 9 requirements. The 9 Given/When/Then scenarios are preserved as-is.

---

## Archive contents checklist

`openspec/changes/archive/2026-06-24-pre-existing-ts-fix-batch-2/`

- [x] `proposal.md` — change intent, scope, approach, rollback plan
- [x] `explore.md` — root-cause analysis of the 9 TS error clusters (from prior `pre-existing-ts-fix/explore.md` §6)
- [x] `specs/pre-existing-ts/spec.md` — delta spec with 9 requirements + 9 scenarios
- [x] `tasks.md` — 12 tasks, all `[x]` (9 implementation + 3 verification; see "Reconciliation" below)
- [x] `apply-progress.md` — RED/GREEN TDD evidence per task, deviations, and out-of-scope TS error ownership
- [x] `verify-report.md` — PASS WITH WARNINGS, 9/9 spec scenarios COMPLIANT, TDD evidence re-validated
- [x] `archive-report.md` — this file (the one this `sdd-archive` invocation produced)

### Task Completion Gate (re-validated at archive time)

| Phase | Tasks | Status at archive |
| --- | --- | --- |
| Phase 1 — Test fixture fakes | 1.1, 1.2, 1.3 | All `[x]` |
| Phase 2 — Type-only spec fixes | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6 | All `[x]` |
| Phase 3 — Verification | 3.1 (`tsc`), 3.2 (`npm test`), 3.3 (`npm run lint`) | All `[x]` (see Reconciliation) |

#### Reconciliation (per SKILL §Task Completion Gate)

At archive time, the 3 Phase 3 verification checkboxes (3.1, 3.2, 3.3) were marked `[x]` in `tasks.md` based on the verify-report's evidence. Per `verify-report.md` §"Build & test gates" (re-run by the verifier):

- `npx tsc --noEmit` → 0 errors in the 9 in-scope files (7 errors remain in 4 out-of-scope files owned by `chore/fix-pre-existing-ts-errors`).
- `npm test` → 47/47 suites, 471/471 tests, 0 failed, 1 skipped (pre-existing).
- `npm run lint` → exit 0, 0 ESLint errors.

The verify-report documented that these 3 tasks are "checkboxes the verifier fills in" — `sdd-verify` runs the commands and records results in `verify-report.md`, but the checkbox state in `tasks.md` was not mechanically updated. To satisfy the archive gate and the user's instruction "confirm EVERY implementation task is `- [x]`", the archive agent marked them `[x]` at archive time, with this explicit note. The `verify-report.md` itself is the authoritative evidence; the checkbox update is a bookkeeping reconciliation.

**No implementation task is incomplete.** The SDD cycle is properly closed.

---

## Cycle summary

| Phase | Output | Status |
| --- | --- | --- |
| `sdd-explore` | `explore.md` (root-cause analysis from `pre-existing-ts-fix/explore.md` §6) | ✅ Done |
| `sdd-spec` | `specs/pre-existing-ts/spec.md` (9 requirements + 9 scenarios) — combined with propose in this workstream | ✅ Done |
| `sdd-propose` | `proposal.md` (intent, scope, approach, rollback) | ✅ Done |
| `sdd-tasks` | `tasks.md` (12 tasks across 3 phases; ~33 LOC forecast) | ✅ Done |
| `sdd-apply` | 9 fix commits + 1 lint --fix commit on `fix/ts-batch-2`; `apply-progress.md` | ✅ Done |
| `sdd-verify` | `verify-report.md` (PASS WITH WARNINGS, 9/9 COMPLIANT) | ✅ Done |
| `sdd-archive` | This report; canonical spec promoted; change folder moved to archive | ✅ Done |

**Full cycle**: explore → spec → propose → tasks → apply → verify → archive. Complete.

---

## Known warnings (carried forward from verify report)

These 4 WARNINGs were documented in `verify-report.md` and `apply-progress.md` §Deviations. None break a spec scenario. The change is still PASS WITH WARNINGS (0 CRITICAL) and is archiveable.

1. **WARNING-1 — Diff size exceeds `tasks.md` estimate (~33 LOC → ~307 LOC).** Actual `git diff --stat` shows 216 insertions / 91 deletions across 9 files. The growth comes from (a) call-site `as unknown as Repository<T>` casts on the 3 seed specs (12 sites, 18 casts), (b) `as unknown as` on the `jest.fn()` object construction in 2 seed specs, (c) `!` non-null assertions on 3 `row.*` field reads in `seed-projects.spec.ts`. **Spec impact**: none — the spec specifies the type signatures, not the call-site cast count. **Remediation**: amend `explore.md` §3 with a "call-site cast multiplier" note for future workstreams.
2. **WARNING-2 — `EnvConfig` import path is 2 levels deep, not 1.** `src/common/filters/all-exceptions.filter.spec.ts` imports `from "../../config/env.config"` (the spec text says `from "../config/env.config"`). **Spec impact**: none — the spec's intent was "import `EnvConfig` from `src/config/env.config.ts`", which is satisfied. **Remediation**: minor edit in `specs/pre-existing-ts/spec.md` Requirement 2.1 is unnecessary; the apply agent caught and fixed this in flight.
3. **WARNING-3 — `let config: ConfigService` declarations also needed `<EnvConfig, false>` parametrization.** Lines 66 and 177 of `all-exceptions.filter.spec.ts` are now `let config: ConfigService<EnvConfig, false>;` (the spec only mentioned the cast at lines 87/193). **Spec impact**: none — the scenarios "fake `ConfigService` matches the constructor parameter" are fully satisfied. **Remediation**: amend `tasks.md` task 2.1 to mention the `let` declarations (for future reference).
4. **WARNING-4 — 10th commit `deea7d5 chore: lint --fix formatting` is autoformatting-only.** `npm run lint` auto-applies prettier on 5 of the 9 files. **Spec impact**: none — the 9 spec fix commits are intact. **Remediation**: squash `deea7d5` into the 9 fix commits during PR review if a strict 9-commit count is preferred.

---

## Out-of-scope context (audit trail)

Per the structured status and the verify report, 7 pre-existing TS errors remain in 4 files that are **NOT** this change's scope. They exist on `bcc7dd4` and persist through this branch because they belong to a parallel workstream:

| File | Errors | Owned by | Fixed in (other branch) |
| --- | --- | --- | --- |
| `src/reviews/reviews.controller.spec.ts:397` | 1 × TS2352 | `pre-existing-ts-fix` | commit `a221fbc` on `chore/fix-pre-existing-ts-errors` |
| `src/reviews/reviews.service.spec.ts:122, 419, 437` | 1 × TS2352 + 2 × TS2345 | `pre-existing-ts-fix` | commit `dba8115` on `chore/fix-pre-existing-ts-errors` |
| `test/auth.e2e-spec.ts:224, 225` | 1 × TS2304 + 1 × TS2769 | `pre-existing-ts-fix` | commit `a8ea07e` on `chore/fix-pre-existing-ts-errors` |
| `test/projects.e2e-spec.ts:369` | 1 × TS2352 | `pre-existing-ts-fix` | commit `a8ea07e` on `chore/fix-pre-existing-ts-errors` |

`npx tsc --noEmit` returns 0 errors in the 9 in-scope files; the 7 errors above are explicitly the next batch's responsibility. Once `chore/fix-pre-existing-ts-errors` merges to `dev`, the project will be `tsc` clean.

This change does **not** touch `src/contact/**` (that source tree belongs to the `domain/contact` archive cycle, frozen at `bcc7dd4`).

---

## Archive location decision

Per the SKILL's default policy ("Move the entire change folder to archive with date prefix"), the change folder was moved to:

```
openspec/changes/pre-existing-ts-fix-batch-2/
  → openspec/changes/archive/2026-06-24-pre-existing-ts-fix-batch-2/
```

This is the **default** per the SKILL. The prior `domain-contact` archive was kept at the active path per user preference; no such preference was stated for this change, so the default applies. The archive contains all artifacts (proposal, spec, explore, tasks, apply-progress, verify-report, archive-report) and is the immutable audit trail.

---

## SDD Cycle Complete

`pre-existing-ts-fix-batch-2` is **feature-complete, type-clean, lint-clean, and test-green** on its in-scope scope (9 files). The 9 spec scenarios are each backed by runtime evidence. The new canonical spec `openspec/specs/pre-existing-ts/spec.md` reflects the chore capability going forward. The 7 pre-existing TS errors in 4 other files are out of scope and owned by the parallel `chore/fix-pre-existing-ts-errors` workstream.

The branch `fix/ts-batch-2` is ready for the user's PR flow:

1. `fix/ts-batch-2` → `domain/contact` (PR #1)
2. `domain/contact` → `dev` (PR #2, after #1 merges)

**The SDD cycle for `pre-existing-ts-fix-batch-2` is COMPLETE.** The next recommended step is the user handling the PR — `sdd-archive` returns the orchestrator to the user's GitHub workflow.

---

## Provenance

- **Archiver**: `sdd-archive` sub-agent (model: `opencode-go/minimax-m3`)
- **Archive date**: 2026-06-24
- **Skill resolution**: `paths-injected` — orchestrator pre-injected 5 skill files, all read before this artifact was written:
  - `~/.config/opencode/skills/sdd-archive/SKILL.md`
  - `~/.config/opencode/skills/_shared/SKILL.md`
  - `~/.config/opencode/skills/_shared/sdd-phase-common.md`
  - `~/.config/opencode/skills/_shared/openspec-convention.md`
  - `~/.config/opencode/skills/typescript/SKILL.md`
- **Commands run by the archiver**:
  - `npx tsc --noEmit` (project-wide) → 7 errors in 4 out-of-scope files; 0 in the 9 in-scope files (matches verify report).
  - `npx jest src/cli/ src/common/ src/data-source.spec.ts src/projects/ src/reviews/` → 27/27 suites, 272/272 tests, 0 failed.
  - `git status` / `git log bcc7dd4..HEAD --oneline` → 10 commits pre-archive.
  - `cp` (delta spec → canonical), `mv` (change folder → archive), `git status` (verify clean archive state).
