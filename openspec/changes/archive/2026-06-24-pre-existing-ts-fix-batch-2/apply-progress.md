# Apply Progress: pre-existing-ts-fix-batch-2

## Status
ok

## Branch state
- Branch: `fix/ts-batch-2`
- Base: `bcc7dd4` (post domain-contact archive)
- Commits added: 10 (9 type-only / test-fixture fixes + 1 lint --fix formatting)
- Total commits on branch ahead of `bcc7dd4`: 10

## TDD Cycle Evidence

| Task | RED (line/error before fix) | GREEN (tsc clean after fix) | Tests still pass |
|---|---|---|---|
| 1.1 seed-projects | 13 sites — `TS2740: Type 'FakeProjectRepo' is missing the following properties from type 'Repository<ProjectEntity>'` × 10 sites (lines 54,55,96×2,117×2,142,143,168×2) + `TS18046: 'row.slug'/'row.title'/'row.projectId' is of type 'unknown'` (lines 103,105,125) | yes | npx jest src/cli/seed-projects.spec.ts → 7/7 pass |
| 1.2 seed-reviews | 14 sites — `TS2740: Type 'Record<string, Mock<any, any, any>>' is missing the following properties from type 'Repository<ReviewEntity>'` × 14 sites (lines 40×2, 54×2, 83×2, 99×2, 112×2, 134×2, 135×2) | yes | npx jest src/cli/seed-reviews.spec.ts → 7/7 pass |
| 1.3 seed-superuser | 6 sites — `TS2345: Argument of type 'FakeUserRepo' is not assignable to parameter of type 'Repository<UserEntity>'` (lines 53, 74, 93, 110, 127, 131) | yes | npx jest src/cli/seed-superuser.spec.ts → 5/5 pass |
| 2.1 all-exceptions | 2 sites — `TS2345: Argument of type 'ConfigService<Record<string \| symbol, unknown>, false>' is not assignable to parameter of type 'ConfigService<EnvConfig, false>'` (lines 87, 193) | yes | npx jest src/common/filters/all-exceptions.filter.spec.ts → 7/7 pass |
| 2.2 data-source | 1 site — `TS18048: 'migrations' is possibly 'undefined'` (line 11) | yes | n/a (type-only) |
| 2.3 projects.controller | 3 sites — `TS2352: Conversion of type 'ProjectsController' to type 'Record<string, unknown|object>' may be a mistake` (lines 257, 276, 289) | yes | n/a (type-only) |
| 2.4 projects.service | 4 sites — `TS2339: Property 'message' does not exist on type 'Error \| ProjectResponseDto'` (line 243 ×2) + `TS2322: Type '{ count: number; }' is not assignable to type 'number'` (line 408) + `TS2339: Property 'message' does not exist on type 'void \| Error'` (line 910) | yes | npx jest src/projects/projects.service.spec.ts → 32/32 pass |
| 2.5 list-comments-query | 1 site — `TS2769: No overload matches this call. Object literal may only specify known properties, and 'transform' does not exist in type 'ValidatorOptions'` (line 19) | yes | n/a (type-only) |
| 2.6 reviews-admin.controller | 1 site — `TS2352: Conversion of type 'ReviewsAdminController' to type 'Record<string, unknown>' may be a mistake` (line 174) | yes | n/a (type-only) |

## Per-task summary
- 1.1: `d3c5107d8ac6367c9d6c7a4ec6887965747ff1d7` — `chore(seed-projects): type test fakes as Pick<Repository<T>, ...>`
- 1.2: `e44bc8f7be276c8a8ff0125abc860323d44bc1ba` — `chore(seed-reviews): type test fakes as Pick<Repository<T>, ...>`
- 1.3: `529eb9934e0e0132ac948fc18829acaad7627d12` — `chore(seed-superuser): type test fake as Pick<Repository<UserEntity>, ...>`
- 2.1: `4eeab1080b8a5aee176138b016456d24e47990db` — `test(all-exceptions): parametrize ConfigService fake with EnvConfig`
- 2.2: `f5ace4dd918bc247c2ea7b39176d967f20e53b17` — `test(data-source): narrow migrations local to string[]`
- 2.3: `31225f874b7e36e566b3097562213138c08eaf9a` — `test(projects.controller): double-cast prototype for indexable read`
- 2.4: `7a48e4bba6ea9a3d71cbc4794911842148c99e8e` — `test(projects.service): assert .catch result as Error + fix transactionCalls return type`
- 2.5: `9a4daf2caaf8df46ebf99d715ac0e148fb186093` — `test(list-comments-query): cast validate options to bypass ValidatorOptions`
- 2.6: `5f431e1c2ee36f10e603871fbdd8abe74e6778e4` — `test(reviews-admin.controller): double-cast prototype for indexable read`
- Bonus: `deea7d5ca47167e75fc9876b854a36693cd9c072` — `chore: lint --fix formatting (apply --fix output to batch 2)` (pure prettier reformatting on 5 of the 9 files; follows the prior workstream's `chore(contact): lint --fix formatting` pattern, commit `66609e3`)

## Verification (project-wide)
- `npx tsc --noEmit`: 0 errors in any of the 9 fixed files
- 7 errors remain in 4 files owned by the prior `pre-existing-ts-fix` workstream on branch `chore/fix-pre-existing-ts-errors` (not in scope, not on this branch's base):
  - `src/reviews/reviews.controller.spec.ts:397` (TS2352, 1 site — fix in commit `a221fbc`)
  - `src/reviews/reviews.service.spec.ts:122, 419, 437` (TS2352 + TS2345 ×2, 3 sites — fix in commit `dba8115`)
  - `test/auth.e2e-spec.ts:224, 225` (TS2304 + TS2769, 2 sites — fix in commit `a8ea07e`)
  - `test/projects.e2e-spec.ts:369` (TS2352, 1 site — fix in commit `a8ea07e`)
- `npm test`: 47/47 suites pass, 471/471 tests pass (1 skipped, 0 failed)
- `npm run lint`: exit 0, 0 ESLint errors after `--fix`

## Deviations from design

1. **Larger diff than estimated.** The explore.md estimated ~33 LOC; the actual diff is 216 insertions / 91 deletions across 9 files. The increase comes from:
   - **Call-site `as unknown as Repository<T>` casts** in the 3 seed specs: 18 casts added across 12 `seedProjects` / `seedReviews` / `seedSuperuser` call sites. The `Pick<...>` return types document what the fakes implement, but the production functions expect the full `Repository<T>`, so the call-site needs the standard TS escape hatch. This was not in the explore.md (whose 13/14/6 error-site counts matched the TS2740 cascade but didn't account for the same pattern repeating at each call site).
   - **`as unknown as` on the jest-fake object construction** in seed-reviews.spec.ts and seed-superuser.spec.ts: 3 casts. The `jest.fn((dto: unknown) => ...)` return types don't satisfy the strict `Pick<Repository<T>, ...>` method signatures, so the construction object needs an `as unknown as Pick<...>` cast.
   - **3 `!` non-null assertions** in seed-projects.spec.ts test bodies (`row.slug!.length`, `row.title!.length`, `row.projectId!.length`): `Partial<ProjectEntity>` makes these fields optional, and the test bodies use `expect(typeof x).toBe("string")` which doesn't narrow `string | undefined`. The `!` is placed AFTER the `typeof` guard in the test (which proves the value is non-undefined at runtime); the `!` only satisfies the static check.

2. **EnvConfig import path.** The orchestrator's task description said `import { EnvConfig } from "../config/env.config"` but the file is at `src/common/filters/all-exceptions.filter.spec.ts` (2 levels deep), so the correct path is `../../config/env.config`. Fixed during GREEN.

3. **`config` variable type annotation.** Adding `ConfigService<EnvConfig, false>` as a cast on the `config = { get: getMock } as unknown as ...` line alone was insufficient — the `let config: ConfigService;` declarations on lines 66 and 177 also need to be `ConfigService<EnvConfig, false>` for the assignment to type-check (TS2322 going the other way). The orchestrator's spec only mentioned the cast change; both `let` declarations had to be updated.

4. **10th commit for lint --fix.** `npm run lint` runs `eslint --fix`, which auto-applies prettier reformatting to 5 of the 9 files. To leave the working tree clean and follow the prior workstream's pattern (commit `66609e3 chore(contact): lint --fix formatting...`), the formatting is committed as a 10th `chore: lint --fix formatting` commit. The user can squash it into the 9 fix commits during review if a strict 9-commit count is preferred.

## Issues found
None — every RED error had a clean GREEN fix, and all 4 test-fixture specs (1.1, 1.2, 1.3, 2.4) pass `npx jest` after the type changes.

## Relevant Files
- `src/cli/seed-projects.spec.ts` — Task 1.1
- `src/cli/seed-reviews.spec.ts` — Task 1.2
- `src/cli/seed-superuser.spec.ts` — Task 1.3
- `src/common/filters/all-exceptions.filter.spec.ts` — Task 2.1
- `src/data-source.spec.ts` — Task 2.2
- `src/projects/projects.controller.spec.ts` — Task 2.3
- `src/projects/projects.service.spec.ts` — Task 2.4
- `src/reviews/dto/list-comments-query.dto.spec.ts` — Task 2.5
- `src/reviews/reviews-admin.controller.spec.ts` — Task 2.6
