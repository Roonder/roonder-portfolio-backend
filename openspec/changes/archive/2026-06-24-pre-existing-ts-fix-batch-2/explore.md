# Explore: pre-existing TS build errors — Batch 2

**Project**: `roonder-portfolio-backend`
**Date**: 2026-06-23
**Phase**: `sdd-explore` + `sdd-spec` (combined)
**Change folder**: `openspec/changes/pre-existing-ts-fix-batch-2/`
**Author**: `sdd-explore` executor
**Dev commit**: `2f9c4eb` (`Merge pull request #4 from Roonder/domain/auth-retry`)

---

## 1. Why this workstream exists

A prior `sdd-explore` (`openspec/changes/pre-existing-ts-fix/explore.md`, engram id 66) speced and applied 5 minimal fixes (3 inline commits on `chore/fix-pre-existing-ts-errors`) for the 4 reported error clusters. While doing so, the prior agent observed **9 additional pre-existing TS errors** (§6 of that report, page 14–16) and explicitly left them out of scope. This workstream picks up those 9.

The user decision: give the 9 errors their own workstream with a spec, not bolt them onto the prior fix. The spec is at `specs/pre-existing-ts/spec.md`; this file is the supporting investigation.

## 2. Error enumeration and verification

I ran `npx tsc --noEmit` against the working tree (on `domain/contact`) and captured 83 lines of output. After filtering out the 4 already-fixed files (`reviews.service.spec.ts`, `reviews.controller.spec.ts`, `auth.e2e-spec.ts`, `projects.e2e-spec.ts`), 76 lines remain — spanning **45 distinct TS error sites** in **9 files**.

**Discrepancy vs. the prior report**: the prior report's §6 lists 9 file groups. The actual error count (45 sites) is much higher because the seed-spec fake-typing errors cascade: each fake-typing mismatch at a factory call propagates to every site that uses the fake. The "9 errors" framing = 9 file groups = 9 fix units. Each fix unit may repair many individual error sites.

I read every affected file via `git show dev:<path>` (not from the working tree) to avoid contamination from the parallel `domain/contact` workstream and the parallel `chore/fix-pre-existing-ts-errors` branch.

## 3. Per-file root-cause analysis

### 3.1 `src/cli/seed-projects.spec.ts` (13 sites)

**Root cause**: The fakes are hand-rolled interfaces `FakeProjectRepo` (3 methods) and `FakeProjectUrlRepo` (1 method). The `seedProjects({ projectRepo, projectUrlRepo })` production function takes `Repository<ProjectEntity>` / `Repository<ProjectUrlEntity>`, which has 36+ / 38+ members. TS reports `TS2740` ("missing the following properties from type `Repository<T>`") at 10 sites (5 factory calls × 2 repos). Separately, the captured `createCalls: Array<Record<string, unknown>>` / `insertCalls: Array<Array<Record<string, unknown>>>` arrays type `row.slug`, `row.title`, `row.projectId` as `unknown` (3 sites, `TS18046`).

**Proposed fix**: 
- Type `makeFakeProjectRepo` return as `{ repo: Pick<Repository<ProjectEntity>, "findOne" | "create" | "save">; createCalls: Array<Partial<ProjectEntity>>; saveCalls: Array<Partial<ProjectEntity>>; findOneCalls: Array<{ where: Record<string, unknown> }> }`
- Type `makeFakeProjectUrlRepo` return as `{ repo: Pick<Repository<ProjectUrlEntity>, "insert">; insertCalls: Array<Array<Partial<ProjectUrlEntity>>> }`
- Remove the `interface FakeProjectRepo` and `interface FakeProjectUrlRepo` declarations.
- **Estimated LOC**: ~10 lines (interface removal + return-type annotations + `Partial<T>` captured arrays).

**Risk**: `test-fixture` (types only). Runtime: identical.

### 3.2 `src/cli/seed-reviews.spec.ts` (14 sites)

**Root cause**: The two `makeFake...Repo` helpers return `repo: Record<string, jest.Mock>`. This is structurally a strict subset of `Repository<T>` and TS 5.7+ rejects the assignment at 7 call sites × 2 repos = 14 `TS2740` errors.

**Proposed fix**:
- Type `makeFakeReviewRepo` return as `{ repo: Pick<Repository<ReviewEntity>, "create" | "save" | "findOne" | "insert" | "delete" | "findAndCount" | "createQueryBuilder">; ... }` (the 7 methods the fake already exposes).
- Type `makeFakeCommentRepo` return as `{ repo: Pick<Repository<ReviewCommentEntity>, "create" | "save" | "findOne" | "delete" | "insert" | "findAndCount" | "createQueryBuilder">; ... }`.
- **Estimated LOC**: ~4 lines (two return-type annotations).

**Risk**: `test-fixture` (types only).

### 3.3 `src/cli/seed-superuser.spec.ts` (6 sites)

**Root cause**: The `interface FakeUserRepo` (4 methods) is the same pattern as seed-projects. `seedSuperuser(..., repo)` takes `Repository<UserEntity>`; 6 call sites × 1 repo = 6 `TS2345` errors.

**Proposed fix**:
- Type `makeFakeUserRepo` return as `{ repo: Pick<Repository<UserEntity>, "findOne" | "create" | "save" | "update">; ... }`.
- Remove the `interface FakeUserRepo` declaration.
- **Estimated LOC**: ~6 lines (interface removal + return-type annotation).

**Risk**: `test-fixture` (types only).

### 3.4 `src/common/filters/all-exceptions.filter.spec.ts` (2 sites)

**Root cause**: Lines 87 and 193 cast `{ get: getMock } as unknown as ConfigService`. The bare `ConfigService` defaults to `ConfigService<Record<string | symbol, unknown>, false>`, but the `AllExceptionsFilter` constructor expects `ConfigService<EnvConfig, false>`. Two `TS2345` errors.

**Proposed fix**:
- Add `import { EnvConfig } from "../config/env.config";` (the interface is exported from `src/config/env.config.ts`).
- Change the two casts to `as unknown as ConfigService<EnvConfig, false>`.
- **Estimated LOC**: 3 lines (1 import + 2 cast updates).

**Risk**: `type-only`.

### 3.5 `src/data-source.spec.ts` (1 site)

**Root cause**: Line 11: `expect(migrations.length).toBeGreaterThan(0);` where `migrations` is `AppDataSource.options.migrations` (typed as `string[] | undefined`). The `Array.isArray(migrations)` runtime guard on line 10 doesn't narrow the type for the subsequent `.length` access. One `TS18048` error.

**Proposed fix**:
- Add `as string[]` to the local binding: `const migrations = AppDataSource.options.migrations as string[];`
- **Estimated LOC**: 1 line.

**Risk**: `type-only` (the runtime `Array.isArray` guard still runs).

### 3.6 `src/projects/projects.controller.spec.ts` (3 sites)

**Root cause**: Lines 257, 276, 289: `ProjectsController.prototype as Record<string, unknown|object>` and the analogous `Record<string, object>` cast. TS 5.7+ blocks the single-step cast (controller has no index signature). Three `TS2352` errors.

**Proposed fix**:
- Insert `unknown` as an intermediate cast at all 3 sites: `... as unknown as Record<string, ...>`. This is the canonical TS escape hatch and matches the pattern used by the prior `pre-existing-ts-fix` workstream in `reviews.controller.spec.ts:397`, `reviews.service.spec.ts:122`.
- **Estimated LOC**: 3 lines (one `as unknown` insertion per site).

**Risk**: `type-only`.

### 3.7 `src/projects/projects.service.spec.ts` (4 sites at 3 lines)

**Root cause**:
- Lines 243 (×2 cols): `expect(missingErr.message).toBe(draftErr.message)`. The `missingErr` / `draftErr` come from `service.findOneBySlug(...).catch((e: Error) => e)`. The return type of `.catch<U>(...)` is `T | U` where T is the original promise's resolution type (`ProjectResponseDto`). So the result type is `Error | ProjectResponseDto`, and `.message` is not on `ProjectResponseDto`. Two `TS2339` errors.
- Line 408: `function makeDataSourceWithTransaction(...): { ...; transactionCalls: number }` declares the return type as `transactionCalls: number` but the implementation returns `transactionCalls: transactionCalls` where `transactionCalls` is `{ count: 0 }`. The destructure-rename is irrelevant; the return-type annotation is the actual error. One `TS2322` error.
- Line 910: `service.remove(...).catch((e: Error) => e)`. `remove()` returns `Promise<void>`, so the result type is `void | Error`. `.message` is not on `void`. One `TS2339` error.

**Proposed fix**:
- Lines 243: append `as Error` to the two `.catch((e: Error) => e)` results: `const missingErr = (await ... .catch((e: Error) => e)) as Error;` (or change the `.catch` callback to `e as Error`).
- Line 408: change the return-type annotation from `transactionCalls: number` to `transactionCalls: { count: number }`. The body remains unchanged.
- Line 910: append `as Error` to the `.catch(...)` result.
- **Estimated LOC**: ~4 lines (2 × `as Error` + 1 return-type fix + 1 × `as Error`).

**Risk**: `test-fixture` (line 243 + 910) and `type-only` (line 408).

### 3.8 `src/reviews/dto/list-comments-query.dto.spec.ts` (1 site)

**Root cause**: Line 19: `validate(dto as object, { transform: true, transformOptions: { enableImplicitConversion: true } })`. The second argument's type `ValidatorOptions` (from `class-validator` 0.15.1) does not accept the `transform` / `transformOptions` keys — those are class-transformer options. One `TS2769` error.

**Proposed fix**:
- Cast the options object: `await validate(dto as object, { transform: true, transformOptions: { enableImplicitConversion: true } } as never);` — bypasses the `ValidatorOptions` type check while preserving the runtime options.
- Alternative: `as unknown as Parameters<typeof validate>[1]` for explicitness.
- **Estimated LOC**: 1 line.

**Risk**: `type-only`.

### 3.9 `src/reviews/reviews-admin.controller.spec.ts` (1 site)

**Root cause**: Line 174: `ReviewsAdminController.prototype as Record<string, unknown>`. Same TS 5.7+ single-step cast rejection as the prior workstream. One `TS2352` error.

**Proposed fix**:
- Insert `unknown`: `... as unknown as Record<string, unknown>`.
- **Estimated LOC**: 1 line.

**Risk**: `type-only`.

## 4. Total LOC estimate

| File | Sites | LOC | Nature |
|---|---|---|---|
| `src/cli/seed-projects.spec.ts` | 13 | ~10 | test-fixture |
| `src/cli/seed-reviews.spec.ts` | 14 | ~4 | test-fixture |
| `src/cli/seed-superuser.spec.ts` | 6 | ~6 | test-fixture |
| `src/common/filters/all-exceptions.filter.spec.ts` | 2 | 3 | type-only |
| `src/data-source.spec.ts` | 1 | 1 | type-only |
| `src/projects/projects.controller.spec.ts` | 3 | 3 | type-only |
| `src/projects/projects.service.spec.ts` | 4 | 4 | test-fixture + type-only |
| `src/reviews/dto/list-comments-query.dto.spec.ts` | 1 | 1 | type-only |
| `src/reviews/reviews-admin.controller.spec.ts` | 1 | 1 | type-only |
| **TOTAL** | **45** | **~33** | |

Net LOC change: ~33 across 9 files. The PR review budget is trivial.

## 5. Recommended delivery path

**Recommended: Option A — `inline-fresh-branch` with 9 commits, one per file.**

**Branch name**: `chore/fix-pre-existing-ts-errors-batch-2` (cut from `dev` at `2f9c4eb`). Do **not** include the `domain/contact` work or the prior `chore/fix-pre-existing-ts-errors` work.

**Commit shape**: 9 commits, one per file. Each commit is a self-contained "make this file type-check" change. Reviewers can sanity-check each commit independently and revert any single one without invalidating the others.

- Commit 1: `chore(seed-projects): type test fakes as Pick<Repository<T>, ...>`
- Commit 2: `chore(seed-reviews): type test fakes as Pick<Repository<T>, ...>`
- Commit 3: `chore(seed-superuser): type test fake as Pick<Repository<UserEntity>, ...>`
- Commit 4: `test(all-exceptions): parametrize ConfigService fake with EnvConfig`
- Commit 5: `test(data-source): narrow migrations local to string[]`
- Commit 6: `test(projects.controller): double-cast prototype for indexable read`
- Commit 7: `test(projects.service): assert .catch result as Error + fix transactionCalls return type`
- Commit 8: `test(list-comments-query): cast validate options to bypass ValidatorOptions`
- Commit 9: `test(reviews-admin.controller): double-cast prototype for indexable read`

**Merge target**: `dev`. If `domain/contact` is still open when this lands, the user can rebase `domain/contact` onto the new `dev` (likely necessary, since the contact branch is downstream of dev and `npm run build` is the gate).

### Why not Option B (`inline-followup-pr` on the same branch)?

- The prior `chore/fix-pre-existing-ts-errors` branch's PR is being applied in 3 inline commits by the parallel `sdd-apply Batch A`. Adding 9 more commits to that branch would bloat the PR and mix two "fix waves" that the user has explicitly separated.
- A separate branch is trivially mergeable to `dev` independently, and the user can choose to drop the second batch if the first turns out to be controversial.

### Why not Option C (full SDD cycle)?

- 33 LOC of type-only/test-fixture changes does not warrant `sdd-propose` + `sdd-design` + `sdd-tasks` ceremony.
- The user explicitly produced a **spec** for this workstream, which is the right ceiling of ceremony: the spec is the contract, the explore report is the WHY, and the apply phase can proceed with the contract in hand.

## 6. Risks

- **0 runtime risk** across all 9 fixes. Every change is type-only or test-fixture; no production source is modified, no test behavior changes, no DB query changes.
- **Lowest-effort risks** (worth flagging, not blocking):
  - The 3 seed spec fakes will need to be kept in sync if the production `seedProjects` / `seedReviews` / `seedSuperuser` functions ever add a new `Repository<T>` method call. The `Pick<...>` subset is a closed list; adding a method means editing the type signature AND adding the corresponding `jest.fn()` entry in the helper.
  - `src/projects/projects.service.spec.ts:408` return-type fix changes the public type of `makeDataSourceWithTransaction`'s return — anyone importing the helper from another spec file (none, in this codebase) would see the new shape. Grep confirms the helper is local to the spec.
  - `src/reviews/dto/list-comments-query.dto.spec.ts:19` cast-as-`never` is a type-only hack; future class-validator upgrades may add `transform` to `ValidatorOptions` legitimately, at which point the cast should be removed.
- **Cross-file coordination**: none required. The 9 files do not interact; the spec scopes each fix to a single file.
- **Pre-existing TS error count drift**: this workstream assumed the prior `pre-existing-ts-fix` workstream's 3 inline commits are being applied **in parallel** on `chore/fix-pre-existing-ts-errors`. If they land first, the dev build's error count drops from 13 to 9, matching this workstream's scope exactly. If they land after, both workstreams run independently and the build will be clean when both are merged to dev.

## 7. Skill resolution

`paths-injected` — the orchestrator pre-injected the four skill files in the launch prompt:
- `~/.config/opencode/skills/sdd-explore/SKILL.md`
- `~/.config/opencode/skills/sdd-spec/SKILL.md`
- `~/.config/opencode/skills/_shared/SKILL.md`
- `~/.config/opencode/skills/typescript/SKILL.md`

All four were read before this artifact was written. The `sdd-spec` skill was used to produce the formal `spec.md` artifact in addition to this explore report.

## 8. Return envelope (for orchestrator consumption)

```yaml
status: ok
executive_summary: |
  Confirmed 9 additional pre-existing TS errors across 9 test/seed files (45 distinct error sites).
  Produced a formal SDD spec at specs/pre-existing-ts/spec.md with one requirement per file and one
  Given/When/Then scenario per requirement. Recommended delivery is a fresh
  chore/fix-pre-existing-ts-errors-batch-2 branch from dev with 9 inline commits (~33 LOC, all
  type-only or test-fixture, zero runtime impact). Did not edit any source. The 4 prior
  pre-existing-ts-fix errors remain in the parallel sdd-apply Batch A.
artifacts:
  - /home/roonder/Personal-Development/roonder-portfolio-backend/openspec/changes/pre-existing-ts-fix-batch-2/specs/pre-existing-ts/spec.md
  - /home/roonder/Personal-Development/roonder-portfolio-backend/openspec/changes/pre-existing-ts-fix-batch-2/explore.md
next_recommended: inline-fresh-branch-batch-2
risks:
  - 0 runtime risk; all 9 fixes are type-only or test-fixture
  - Pick<Repository<T>, ...> subsets in the 3 seed specs are closed lists; future Repository method
    calls require editing the type signature + adding the corresponding jest.fn() entry
  - The data-source spec migrations cast assumes AppDataSource.options.migrations is always an
    array at runtime (consistent with the existing Array.isArray guard) — not a behavioral change
  - The list-comments-query spec validate() options cast-as-never is a type-only hack; future
    class-validator upgrades may legitimately add transform to ValidatorOptions
fix_count: 9
fix_loc_sum: 33
recommended_delivery_path: inline-fresh-branch
questions_for_user: []
```

---

*End of `sdd-explore` artifact for `pre-existing-ts-fix-batch-2`.*
