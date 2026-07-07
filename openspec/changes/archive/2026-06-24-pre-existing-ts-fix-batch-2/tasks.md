# Tasks: pre-existing-ts-fix-batch-2

`pre-existing-ts` (chore) | branch `fix/ts-batch-2` (from `domain/contact` `bcc7dd4`) | PR: `domain/contact` → `dev` | TDD: ACTIVE | 9 commits (1/file) | apply: 1 linear pass

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~33 LOC (9 files; type-only or test-fixture) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR (1 unit, 9 commits) |
| Delivery strategy | ask-always |
| Chain strategy | pending (n/a single-PR) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Land 9 type-only / test-fixture fixes | PR 1 | Base `domain/contact` → `dev`; 9 commits; closed-list comment on 3 seed fakes |

## Phase 1 — Test fixture fakes (`Pick<Repository<T>, …>`)

- [x] 1.1 `src/cli/seed-projects.spec.ts` — type `makeFakeProjectRepo` as `Pick<Repository<ProjectEntity>, "findOne" | "create" | "save">` + `Partial<ProjectEntity>` captured arrays; type `makeFakeProjectUrlRepo` as `Pick<Repository<ProjectUrlEntity>, "insert">` + `Partial<ProjectUrlEntity>` arrays; drop the two `interface Fake*Repo`; add `// NOTE: keep in sync with the production Repository<T> methods this fake is asked for` above each return-type annotation. `tsc --noEmit` clean. **Scenario: fakes satisfy `Repository<T>` and row fields are typed**.
- [x] 1.2 `src/cli/seed-reviews.spec.ts` — replace the two `Record<string, jest.Mock>` returns with `Pick<Repository<ReviewEntity>, "create" | "save" | "findOne" | "insert" | "delete" | "findAndCount" | "createQueryBuilder">` and `Pick<Repository<ReviewCommentEntity>, …>`; add the closed-list comment. `tsc --noEmit` clean; `npm test` green. **Scenario: fakes satisfy `Repository<T>`**.
- [x] 1.3 `src/cli/seed-superuser.spec.ts` — type `makeFakeUserRepo` as `Pick<Repository<UserEntity>, "findOne" | "create" | "save" | "update">`; drop `interface FakeUserRepo`; add the closed-list comment. `tsc --noEmit` clean; `npm test` green. **Scenario: fake satisfies `Repository<UserEntity>`**.

## Phase 2 — Type-only spec fixes

- [x] 2.1 `src/common/filters/all-exceptions.filter.spec.ts` — add `import { EnvConfig } from "../config/env.config";` and cast `as unknown as ConfigService<EnvConfig, false>` at lines 87, 193. `tsc --noEmit` clean. **Scenario: fake `ConfigService` matches the constructor parameter**.
- [x] 2.2 `src/data-source.spec.ts` — narrow local to `const migrations = AppDataSource.options.migrations as string[];` (line 11). `tsc --noEmit` clean. **Scenario: `migrations.length` type-checks**.
- [x] 2.3 `src/projects/projects.controller.spec.ts` — insert `unknown` at lines 257, 276, 289: `as unknown as Record<string, unknown|object>` and `as unknown as Record<string, object>`. `tsc --noEmit` clean. **Scenario: prototype indexing type-checks**.
- [x] 2.4 `src/projects/projects.service.spec.ts` — append `as Error` to the two `.catch((e: Error) => e)` results at line 243; change `makeDataSourceWithTransaction` return type at line 408 to `transactionCalls: { count: number }`; append `as Error` to `service.remove(...).catch(...)` at line 910. `tsc --noEmit` clean; `npm test` green. **Scenario: 3 error sites type-check**.
- [x] 2.5 `src/reviews/dto/list-comments-query.dto.spec.ts` — cast `validate` options to `as never` (line 19). `tsc --noEmit` clean. **Scenario: `validate()` options type-check**.
- [x] 2.6 `src/reviews/reviews-admin.controller.spec.ts` — change line 174 to `… as unknown as Record<string, unknown>`. `tsc --noEmit` clean. **Scenario: prototype indexing type-checks**.

## Phase 3 — Verification

- [x] 3.1 `npx tsc --noEmit` — 0 TS errors project-wide.
- [x] 3.2 `npm test` — 100% pass, no regression.
- [x] 3.3 `npm run lint` — 0 ESLint errors.
