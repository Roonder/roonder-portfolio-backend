# Pre-existing TS Build Errors — Batch 2

**Change**: `pre-existing-ts-fix-batch-2` | **Domain**: `pre-existing-ts` (chore) | **Dev commit**: `2f9c4eb`
**Prior report**: `openspec/changes/pre-existing-ts-fix/explore.md` §6

## Purpose

Remove 9 additional pre-existing TypeScript build errors that block `npx tsc --noEmit` on `dev` and were observed but out of scope of the prior `pre-existing-ts-fix` workstream. All 9 fixes are `type-only` or `test-fixture`-only; no production source is modified. Per-file root-cause analysis and exact `Pick<...>` type signatures live in `explore.md` (this folder); the spec states the contract.

## Requirements

### Requirement: Fix `src/cli/seed-projects.spec.ts` fake repos

The system SHALL type the test fakes' `repo` field as a `Pick<Repository<T>, ...>` of the methods the spec actually exercises, SHALL type the captured call arrays as `Partial<T>` of the entity, and SHALL remove the local `interface FakeProjectRepo` / `interface FakeProjectUrlRepo` declarations.

#### Scenario: fakes satisfy `Repository<T>` and row fields are typed

- GIVEN the fakes are typed as above
- WHEN `tsc` checks the 5 `seedProjects(...)` call sites and the `row.slug` / `row.title` / `row.projectId` reads
- THEN no `TS2740` (10 sites) and no `TS18046` (3 sites) are reported

### Requirement: Fix `src/cli/seed-reviews.spec.ts` `Record<string, jest.Mock>` fakes

The system SHALL replace the `Record<string, jest.Mock>` return-type of the two `makeFake...Repo` helpers with `Pick<Repository<T>, ...>` subsets (per `explore.md`).

#### Scenario: fakes satisfy `Repository<T>`

- GIVEN the return types use `Pick<...>` subsets
- WHEN `tsc` checks the 7 `seedReviews(...)` call sites
- THEN no `TS2740` (14 sites) is reported

### Requirement: Fix `src/cli/seed-superuser.spec.ts` `FakeUserRepo`

The system SHALL type the `repo` return of `makeFakeUserRepo` as a `Pick<Repository<UserEntity>, ...>` subset and SHALL remove the `interface FakeUserRepo` declaration.

#### Scenario: fake satisfies `Repository<UserEntity>`

- GIVEN the fake is typed as the `Pick<...>` subset
- WHEN `tsc` checks the 6 `seedSuperuser(...)` call sites
- THEN no `TS2345` is reported

### Requirement: Fix `src/common/filters/all-exceptions.filter.spec.ts` `ConfigService` generic

The system SHALL import `EnvConfig` from `../config/env.config` and SHALL change the two `as unknown as ConfigService` casts to `as unknown as ConfigService<EnvConfig, false>`.

#### Scenario: fake `ConfigService` matches the constructor parameter

- GIVEN the cast uses the `EnvConfig` generic parameter
- WHEN `tsc` checks `new AllExceptionsFilter(host, config)` at lines 87 and 193
- THEN no `TS2345` is reported

### Requirement: Fix `src/data-source.spec.ts` `migrations.length`

The system SHALL add a type assertion narrowing `AppDataSource.options.migrations` to `string[]` on the local binding, preserving the runtime `Array.isArray(migrations)` guard.

#### Scenario: `migrations.length` type-checks

- GIVEN the local `migrations` is asserted to `string[]`
- WHEN `tsc` checks `expect(migrations.length).toBeGreaterThan(0)` at line 11
- THEN no `TS18048` is reported

### Requirement: Fix `src/projects/projects.controller.spec.ts` `Record<string, ...>` prototype casts

The system SHALL insert `unknown` as an intermediate cast on the three `ProjectsController.prototype as Record<string, unknown|object>` sites at lines 257, 276, 289.

#### Scenario: prototype indexing type-checks

- GIVEN the casts read `as unknown as Record<string, ...>`
- WHEN `tsc` checks the `proto[m]` indexing at the 3 sites
- THEN no `TS2352` is reported

### Requirement: Fix `src/projects/projects.service.spec.ts` error-union and counter-shape

The system SHALL: (a) add `as Error` to the two `findOneBySlug(...).catch((e: Error) => e)` results at line 243; (b) change the `transactionCalls: number` return-type annotation on `makeDataSourceWithTransaction` to `transactionCalls: { count: number }` (line 408); (c) add `as Error` to the `service.remove(...).catch(...)` result at line 910.

#### Scenario: 3 error sites type-check

- GIVEN the assertions and the `{ count: number }` return-type fix
- WHEN `tsc` checks the 3 sites (lines 243, 408, 910)
- THEN no `TS2339` (lines 243, 910) and no `TS2322` (line 408) is reported

### Requirement: Fix `src/reviews/dto/list-comments-query.dto.spec.ts` `validate` options

The system SHALL cast the second argument of `validate(dto, { transform, transformOptions })` so the `{ transform, transformOptions }` keys bypass `ValidatorOptions`'s type check. The runtime options MUST be unchanged.

#### Scenario: `validate()` options type-check

- GIVEN the options are cast (e.g. `as never` or `as unknown as Parameters<typeof validate>[1]`)
- WHEN `tsc` checks the `await validate(...)` call at line 19
- THEN no `TS2769` is reported

### Requirement: Fix `src/reviews/reviews-admin.controller.spec.ts` `Record<string, unknown>` cast

The system SHALL insert `unknown` as an intermediate cast on the `ReviewsAdminController.prototype as Record<string, unknown>` site at line 174.

#### Scenario: prototype indexing type-checks

- GIVEN the cast reads `as unknown as Record<string, unknown>`
- WHEN `tsc` checks the `proto["..."]` indexing at line 174
- THEN no `TS2352` is reported

## Out of scope

- Any change to **production source** files. All 9 fixes are test-side only.
- Migrating `seedProjects` / `seedReviews` / `seedSuperuser` from `Repository<T>` to a narrower port interface (would touch production code).
- The 4 errors already fixed by `pre-existing-ts-fix` (in `chore/fix-pre-existing-ts-errors`).
- The `domain/contact` workstream.
