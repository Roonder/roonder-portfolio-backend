# Proposal: Pre-existing TypeScript build errors — Batch 2

**Change**: `pre-existing-ts-fix-batch-2` | **Domain**: `pre-existing-ts` (chore)
**Branch**: `fix/ts-batch-2` (cut from `domain/contact` post-archive `bcc7dd4`)
**PR target**: `domain/contact` first, then `dev` | **Artifact store**: openspec | **TDD**: ACTIVE

## Intent

`npx tsc --noEmit` on `dev` reports 9 additional pre-existing TS error clusters (45 sites, 9 test/seed spec files) the prior `pre-existing-ts-fix` workstream observed but left out of scope (`pre-existing-ts-fix/explore.md` §6). They block CI. This change applies 9 minimal, independent, type-only or test-fixture fixes (~33 LOC, 0 runtime risk) so the build is clean on `dev` once both batches land.

## Scope

**In scope** (9 files, ~33 LOC, type-only or test-fixture — see Affected Areas).
**Out of scope**: `src/contact/**` (the `domain/contact` branch is being archived in parallel — touching it would invalidate the archive cycle); the 4 errors already fixed by `pre-existing-ts-fix` (`chore/fix-pre-existing-ts-errors` PR); production refactors; a third batch (warrants its own change).

## Capabilities

**New**: `pre-existing-ts` — chore capability for tracking batches of pre-existing TS build errors. Contract: `specs/pre-existing-ts/spec.md` (9 requirements + 9 Given/When/Then scenarios).
**Modified**: **None.** All 9 fixes are inside `*.spec.ts` / `seed-*.spec.ts`; canonical `openspec/specs/server_specs.md` and `openspec/specs/database-schema.dbml` are NOT modified.

## Approach

Each fix is a one-line or few-line type annotation/cast change, reusing patterns from the prior workstream (`Pick<Repository<T>, …>` for seed fakes; `as unknown as Record<…>` for prototype indexing in `reviews.controller.spec.ts:397` and `reviews.service.spec.ts:122`; `ConfigService<EnvConfig, false>` for parametrized fakes). No production source, no test behavior, no DB query, no dependency, no migration changes. Delivery: 9 commits, one per file; each self-contained and individually revertible (cross-file independent). PR: `domain/contact` → `dev`. ~33 LOC, well under the 400-line review budget.

## Affected Areas

| File | Impact | Fix |
|---|---|---|
| `src/cli/seed-projects.spec.ts` | test-fixture | `Pick<Repository<T>, …>` × 2 + `Partial<T>` captured arrays |
| `src/cli/seed-reviews.spec.ts` | test-fixture | `Pick<Repository<T>, …>` × 2 |
| `src/cli/seed-superuser.spec.ts` | test-fixture | `Pick<Repository<UserEntity>, …>` |
| `src/common/filters/all-exceptions.filter.spec.ts` | type-only | `ConfigService<EnvConfig, false>` cast |
| `src/data-source.spec.ts` | type-only | `as string[]` on local `migrations` |
| `src/projects/projects.controller.spec.ts` | type-only | `as unknown as Record<…>` × 3 |
| `src/projects/projects.service.spec.ts` | test-fixture + type-only | `as Error` × 3 + `transactionCalls: { count: number }` |
| `src/reviews/dto/list-comments-query.dto.spec.ts` | type-only | `as never` on `validate` options |
| `src/reviews/reviews-admin.controller.spec.ts` | type-only | `as unknown as Record<…>` |

## Risks

| Risk | Lik | Mitigation |
|---|---|---|
| `Pick<Repository<T>, …>` closed lists in the 3 seed specs — future `Repository<T>` method call needs a signature update | Med | `// keep in sync` comment on each helper (see Q3) |
| `as never` cast on `validate` options may become unnecessary in a future `class-validator` version | Low | One-line removal when that lands |
| Prior workstream's 3 inline commits must land first/parallel for `dev` error count to be consistent | Med | Re-run `tsc --noEmit` from `dev` HEAD before applying |
| Branch cut from `domain/contact` post-archive, not `dev` — risk of contact-domain drift before this PR merges to dev | Low | PR review is the gate |

## Rollback Plan

The 9 commits are independent and individually revertible: `git revert <sha>` on any one restores that test file's original behavior without affecting the other 8. No DB migration, no production source change, no API contract change, no dependency change. Full PR rejection = drop the branch; prior workstream's 3 inline commits remain mergeable to `dev` independently.

## Dependencies

- `chore/fix-pre-existing-ts-errors` (prior workstream's 3 inline commits) — must merge to `dev` before OR alongside this batch.
- `domain/contact` post-archive `bcc7dd4` — base of `fix/ts-batch-2`; do not rebase or reset.

## Success Criteria

- [ ] `npx tsc --noEmit` on `dev` reports 0 errors after both batches land
- [ ] `npm test` passes green (no test behavior changes)
- [ ] `npm run lint` passes green
- [ ] PR contains exactly 9 commits, one per file
- [ ] `git diff dev --name-only` contains only `*.spec.ts` / `seed-*.spec.ts` paths
- [ ] No `src/contact/**` file is modified
- [ ] PR merges into `domain/contact` first, then into `dev`

## Proposal question round (for user review)

The session preflight is `interactive`; per the `sdd-propose` SKILL §"Step 0", I cannot ask directly. The 5 questions + recommendations are in the return envelope's `proposal_questions` field. Correct any you disagree with; "looks good" finalizes.
