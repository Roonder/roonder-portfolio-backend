# Fix plan: pre-existing TypeScript build errors

**Project**: `roonder-portfolio-backend`
**Date**: 2026-06-23
**Phase**: `sdd-explore`
**Change folder**: `openspec/changes/pre-existing-ts-fix/`
**Author**: `sdd-explore` executor

---

## 1. Confirmation that errors are pre-existing on `dev`

The four error clusters reported in the brief were verified against the `dev` HEAD commit (`2f9c4eb`, `Merge pull request #4 from Roonder/domain/auth-retry`). All four files exist on `dev` and contain the same problematic patterns.

**Verification method**: read-only. Because the orchestrator placed the executor on `domain/contact` (where the parallel `sdd-apply` is making changes), I did **not** run `npm run build` and did **not** `git checkout dev`. Instead, I used `git show dev:<path>` to read each failing file at the dev commit, and cross-checked that the `domain/contact` branch only adds two environment-variable lines (`RESEND_FROM_ADDRESS`, `RESEND_TO_ADDRESS`) at the top of the three test files (auth, projects, controller.spec), which shifts line numbers by `+2` but does not alter the patterns.

I also ran `npx tsc --noEmit` against the working tree to confirm the four reported errors reproduce exactly. The output below is the **working tree** tsc output, showing the same errors the user reported (line numbers match `domain/contact`, not `dev` — the `dev` line numbers are `–2` for the three test files and unchanged for `reviews.service.spec.ts`).

```text
src/reviews/reviews.controller.spec.ts(397,17): error TS2352: Conversion of type 'ReviewsController' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'ReviewsController'.

src/reviews/reviews.service.spec.ts(122,17): error TS2352: Conversion of type 'ReviewsService' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Index signature for type 'string' is missing in type 'ReviewsService'.

src/reviews/reviews.service.spec.ts(419,21): error TS2345: Argument of type '{ id: string; isApproved: true; authorName: string; authorRole: null; content: string; rating: number; createdAt: Date; }' is not assignable to parameter of type 'ReviewEntity'.
  Property 'comments' is missing in type '{ id: string; isApproved: true; authorName: string; authorRole: null; content: string; rating: number; createdAt: Date; }' but required in type 'ReviewEntity'.

src/reviews/reviews.service.spec.ts(437,21): error TS2345: Argument of type '{ id: string; isApproved: false; authorName: string; authorRole: null; content: string; rating: number; createdAt: Date; }' is not assignable to parameter of type 'ReviewEntity'.
  Property 'comments' is missing in type '{ id: string; isApproved: false; authorName: string; authorRole: null; content: string; rating: number; createdAt: Date; }' but required in type 'ReviewEntity'.

test/auth.e2e-spec.ts(224,46): error TS2304: Cannot find name 'EnvConfig'.

test/auth.e2e-spec.ts(225,36): error TS2769: No overload matches this call.
  Overload 1 of 4, '(propertyPath: never, options: ConfigGetOptions): string | undefined', gave the following error.
    Argument of type '"FRONTEND_URL"' is not assignable to parameter of type 'never'.

test/projects.e2e-spec.ts(369,14): error TS2352: Conversion of type 'T' to type 'ProjectRow | ProjectUrlRow' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
  Type '{ id?: string | undefined; }' is not comparable to type 'ProjectRow | ProjectUrlRow'.
```

| File (dev path) | Line on `dev` | Line on `domain/contact` | Error pattern |
|---|---|---|---|
| `src/reviews/reviews.controller.spec.ts` | 395 | 397 | `Record<string, unknown>` cast |
| `src/reviews/reviews.service.spec.ts` | 122 | 122 | `Record<string, unknown>` cast |
| `src/reviews/reviews.service.spec.ts` | 419, 437 | 419, 437 | `toReviewResponse({...TOGGLE_BASE_ROW, ...})` missing `comments` |
| `test/auth.e2e-spec.ts` | 222, 223 | 224, 225 | `EnvConfig` not imported |
| `test/projects.e2e-spec.ts` | 367 | 369 | `T as ProjectRow \| ProjectUrlRow` cast |

All four patterns exist on `dev` and are independent of the `domain/contact` workstream.

---

## 2. Per-error analysis

### 2.1 `src/reviews/reviews.service.spec.ts` — `Record<string, unknown>` cast

- **File path**: `src/reviews/reviews.service.spec.ts`
- **Line**: 122 (unchanged between dev and `domain/contact`)
- **Error message**:
  `TS2352: Conversion of type 'ReviewsService' to type 'Record<string, unknown>' may be a mistake because neither type sufficiently overlaps with the other. Index signature for type 'string' is missing in type 'ReviewsService'.`
- **Root cause**: The test inspects the service's prototype methods by name (`proto["findAllApproved"]`, `proto["findAllForAdmin"]`). It casts the prototype to `Record<string, unknown>` so it can index by a string key. TypeScript 5.7+ blocks this single-step cast between an interface (no index signature) and a `Record<string, unknown>`. The test only needs to read a method by name, not assign one, but the type system can't see the read-only intent.
- **Proposed fix**: Insert `unknown` as an intermediate cast — the canonical TypeScript escape hatch for "I know the runtime shape is fine, I just want to index by string." This is a 1-character-of-meaning change, the existing project convention, and the literal suggestion in the compiler's error message.

  ```ts
  // line 122
  // BEFORE
  const proto = ReviewsService.prototype as Record<string, unknown>;

  // AFTER
  const proto = ReviewsService.prototype as unknown as Record<string, unknown>;
  ```
- **Estimated LOC**: 1 line changed.
- **Risk**: **`type-only`** — the runtime behavior is identical; the test still reads `proto["findAllApproved"]` etc. at runtime, the same as before. The cast only relaxes the compile-time check.

---

### 2.2 `src/reviews/reviews.service.spec.ts` — `toReviewResponse` argument missing `comments`

- **File path**: `src/reviews/reviews.service.spec.ts`
- **Lines**: 419, 437 (unchanged between dev and `domain/contact`)
- **Error message**:
  `TS2345: Argument of type '{ id: string; isApproved: true; authorName: string; authorRole: null; content: string; rating: number; createdAt: Date; }' is not assignable to parameter of type 'ReviewEntity'. Property 'comments' is missing in type '...' but required in type 'ReviewEntity'.`
- **Root cause**: Two `toggleApproval` tests spread `TOGGLE_BASE_ROW` (lines 419 and 437) into the argument to `toReviewResponse`. `TOGGLE_BASE_ROW` (declared at lines 344–352) is a hand-written object literal that does **not** include the `comments: ReviewCommentEntity[]` field that `ReviewEntity` requires. The runtime behavior is fine because `toReviewResponse` defaults `comments` to `[]` via `row.comments ?? []` (see `src/reviews/review-response.mapper.ts`), but the type checker can't see that — it only sees that the literal passed to a `ReviewEntity`-typed parameter is missing a required field.
- **Proposed fix**: Add `comments: []` to `TOGGLE_BASE_ROW`. This fixes **both** line 419 and line 437 in a single edit (both spread `TOGGLE_BASE_ROW`). The empty array literal is typed as `never[]` by TypeScript, which is assignable to `ReviewCommentEntity[]`.

  ```ts
  // lines 344–352
  // BEFORE
  const TOGGLE_BASE_ROW = {
      id: "r-toggle-1",
      authorName: "Maria",
      authorRole: null,
      content: "Great work on the dashboard redesign",
      rating: 5,
      isApproved: false,
      createdAt: new Date("2026-06-19T10:00:00.000Z"),
  };

  // AFTER
  const TOGGLE_BASE_ROW = {
      id: "r-toggle-1",
      authorName: "Maria",
      authorRole: null,
      content: "Great work on the dashboard redesign",
      rating: 5,
      isApproved: false,
      createdAt: new Date("2026-06-19T10:00:00.000Z"),
      comments: [] as ReviewCommentEntity[],
  };
  ```
- **Estimated LOC**: 1 line added.
- **Risk**: **`test-fixture`** — the empty array matches the runtime behavior the mapper already implements (`row.comments ?? []`). No change to the test's expected output, no change to the service's behavior.

  > **Variant without `as ReviewCommentEntity[]`**: just `comments: []` would also satisfy the type checker (the empty tuple is `never[]`, which is assignable to `ReviewCommentEntity[]`). The explicit `as ReviewCommentEntity[]` is preferred because the same `TOGGLE_BASE_ROW` is consumed in a `findOne.mockResolvedValueOnce({...TOGGLE_BASE_ROW, ...})` site (line 458 on dev), where the type is then exposed through a repository interface; the explicit assertion makes the test fixture's intent self-documenting.

---

### 2.3 `src/reviews/reviews.controller.spec.ts` — `Record<string, unknown>` cast

- **File path**: `src/reviews/reviews.controller.spec.ts`
- **Line**: 395 (dev) / 397 (`domain/contact`)
- **Error message**:
  `TS2352: Conversion of type 'ReviewsController' to type 'Record<string, unknown>' may be a mistake ... Index signature for type 'string' is missing in type 'ReviewsController'.`
- **Root cause**: Identical pattern to 2.1 — the test inspects controller prototype methods by name.
- **Proposed fix**:

  ```ts
  // line 395 (dev) / 397 (domain/contact)
  // BEFORE
  const proto = ReviewsController.prototype as Record<string, unknown>;

  // AFTER
  const proto = ReviewsController.prototype as unknown as Record<string, unknown>;
  ```
- **Estimated LOC**: 1 line changed.
- **Risk**: **`type-only`** — same as 2.1.

---

### 2.4 `test/auth.e2e-spec.ts` — `EnvConfig` not imported

- **File path**: `test/auth.e2e-spec.ts`
- **Line**: 222, 223 (dev) / 224, 225 (`domain/contact`)
- **Error messages**:
  - `TS2304: Cannot find name 'EnvConfig'.`
  - `TS2769: No overload matches this call. Overload 1 of 4, '(propertyPath: never, options: ConfigGetOptions): string | undefined', gave the following error. Argument of type '"FRONTEND_URL"' is not assignable to parameter of type 'never'.`
- **Root cause**: The test reads `app.get(ConfigService<EnvConfig>)` and then calls `configService.get("FRONTEND_URL", { infer: true })` to fetch the frontend URL for CORS. The `EnvConfig` type parameter constrains `ConfigService.get` so the key `"FRONTEND_URL"` is type-checked against the env interface. The test **imports** `ENV_CONFIG` (the Joi schema) but does **not** import `EnvConfig` (the interface) from `../src/config/env.config`. As a result, `ConfigService` defaults its key type to `never`, and `get("FRONTEND_URL", ...)` fails because string literals don't match `never`.

  This is a **regression** from the test file's authoring: at some point the test was copy-pasted from `test/projects.e2e-spec.ts` (line 59 on dev) where the same import reads `import { ENV_CONFIG, EnvConfig } from "../src/config/env.config";` — that one is correct.
- **Proposed fix**: Add the missing identifier to the existing import on line 45 (dev) / 47 (`domain/contact`).

  ```ts
  // line 45 (dev) / 47 (domain/contact)
  // BEFORE
  import { ENV_CONFIG } from "../src/config/env.config";

  // AFTER
  import { ENV_CONFIG, EnvConfig } from "../src/config/env.config";
  ```
- **Estimated LOC**: 1 line changed.
- **Risk**: **`type-only`** — adding an import that is already in scope at type level. The runtime value `ENV_CONFIG` is already used at `ConfigModule.forRoot({ validationSchema: ENV_CONFIG })`, so its import is not new; the change only adds the type-only `EnvConfig` import. This matches the existing convention in `test/projects.e2e-spec.ts` (line 59 on dev) which uses the same non-`type` import form.

  > **Alternative considered**: `import { ENV_CONFIG, type EnvConfig } from "../src/config/env.config";` — more explicit (`EnvConfig` is an interface, not a value) but breaks consistency with the rest of the project. The convention in `test/projects.e2e-spec.ts` and `src/config/env.config.spec.ts` is the non-`type` form.

---

### 2.5 `test/projects.e2e-spec.ts` — generic T cast

- **File path**: `test/projects.e2e-spec.ts`
- **Line**: 367 (dev) / 369 (`domain/contact`)
- **Error message**:
  `TS2352: Conversion of type 'T' to type 'ProjectRow | ProjectUrlRow' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first. Type '{ id?: string | undefined; }' is not comparable to type 'ProjectRow | ProjectUrlRow'.`
- **Root cause**: The in-memory `Repository` fake's `save` method is generic: `async <T extends { id?: string }>(row: T): Promise<T>`. Inside the function, the test needs to discriminate between `ProjectRow` and `ProjectUrlRow` (it uses `"projectId" in r` to branch). The current cast `row as ProjectRow | ProjectUrlRow` is rejected by TS 5.7+ because the generic constraint `{ id?: string }` is structurally a strict subset that does not "sufficiently overlap" with the union. The test is intentionally polymorphic — it's a fake that imitates a TypeORM `Repository<Entity | OtherEntity>`.
- **Proposed fix**: Insert `unknown` as an intermediate cast. This is the canonical TS escape hatch when the cast is intentional and the runtime discriminator (`"projectId" in r`) is doing the actual type narrowing.

  ```ts
  // line 367 (dev) / 369 (domain/contact)
  // BEFORE
  const r = row as ProjectRow | ProjectUrlRow;

  // AFTER
  const r = row as unknown as ProjectRow | ProjectUrlRow;
  ```
- **Estimated LOC**: 1 line changed.
- **Risk**: **`type-only`** — the discriminator `if ("projectId" in r) { ... } else { ... }` narrows `r` at runtime; the cast only relaxes the compile-time check so the discriminator can take over.

---

## 3. Grouped fix plan

All five edits are **type-only** or **test-fixture-only** and can be applied in any order. They do not share files (except the two errors in `reviews.service.spec.ts`, which share the same `TOGGLE_BASE_ROW` fixture). The minimal diff is:

| Order | File | Lines | Nature | LOC |
|---|---|---|---|---|
| 1 | `src/reviews/reviews.service.spec.ts` | add `comments: [] as ReviewCommentEntity[]` to `TOGGLE_BASE_ROW` (line ~352) | test-fixture | +1 |
| 2 | `src/reviews/reviews.service.spec.ts` | line 122 — double-cast via `unknown` | type-only | 1 |
| 3 | `src/reviews/reviews.controller.spec.ts` | line 395 (dev) — double-cast via `unknown` | type-only | 1 |
| 4 | `test/auth.e2e-spec.ts` | line 45 (dev) — add `EnvConfig` to import | type-only | 1 |
| 5 | `test/projects.e2e-spec.ts` | line 367 (dev) — double-cast via `unknown` | type-only | 1 |

Steps 1 and 2 share a file. Both can land in the **same commit** (one logical "make reviews tests type-check" change). The remaining three can each be their own commit, or all three can be batched into a single "fix pre-existing test type errors" commit. Recommended commit shape:

- **Commit 1**: `test(reviews): fix pre-existing TS errors in reviews spec (proto cast + missing comments)` — touches `src/reviews/reviews.service.spec.ts` only (steps 1 + 2).
- **Commit 2**: `test(reviews): fix pre-existing TS error in reviews controller spec (proto cast)` — touches `src/reviews/reviews.controller.spec.ts` (step 3).
- **Commit 3**: `test(e2e): fix pre-existing TS errors in auth + projects e2e (EnvConfig import + generic cast)` — touches `test/auth.e2e-spec.ts` and `test/projects.e2e-spec.ts` (steps 4 + 5).

This is 3 commits, 5 line-level changes, 5 distinct fixes across 4 files. The PR review budget is trivial (~5 changed lines + comments).

---

## 4. Total LOC estimate

| Metric | Value |
|---|---|
| Distinct fixes | 5 |
| Files touched | 4 |
| Lines added | 1 |
| Lines modified | 4 |
| **Net LOC change** | **+5** |
| Commits (recommended) | 3 |
| Approximate PR additions+ deletions | 5 (well under the 400-line review budget) |

---

## 5. Recommended delivery path

**Recommended: Option A — inline commits on a fresh `chore/fix-pre-existing-ts-errors` branch cut from `dev`.**

Rationale:
- The user explicitly framed this as a **separate workstream**: *"patched in their own workstream"*. A separate branch makes the deliverable trivially mergeable into `dev` (or into `domain/contact` if the user wants the contact branch to also pick it up) without mixing concerns.
- All five changes are tiny, unrelated, and pre-existing. A `sdd-propose` → `sdd-spec` → `sdd-design` → `sdd-tasks` flow would add ceremony that is not commensurate with the work. The `sdd-explore` artifact is the right ceiling of ceremony.
- The user stated: *"The user prefers minimal ceremony, so lean toward 'inline commits' unless there is cross-file coordination that benefits from a change folder."* There is no cross-file coordination here — the four files do not interact, they just happen to fail the same build together.

**Branch name**: `chore/fix-pre-existing-ts-errors` (or `chore/fix-dev-build-errors`).

**Cut point**: `dev` HEAD (currently `2f9c4eb`). The branch should **not** include the `domain/contact` work — that's a separate parallel workstream.

**Merge target**: `dev` (the natural home for "make `dev` build cleanly"). If `domain/contact` is still open when this lands, the user can decide whether to also rebase `domain/contact` onto the new `dev` (likely yes, since the contact branch is downstream of dev and `npm run build` is the gate).

**Why not Option B (inline on `domain/contact`)**:
- Mixes two unrelated concerns on one branch (contact-domain logic + test-fixture type fixes).
- Forces a `git rebase` on the contact branch later if the user wants the contact change to land on a clean `dev`.
- The 400-line review budget is irrelevant here (~5 lines), but Option B still produces a noisier PR diff for reviewers who care about contact-domain review specifically.

**Why not Option C (full SDD change)**:
- Total work is 5 line changes. A full proposal/spec/design/tasks cycle would be ~10x the work being specified.
- The change is mechanical, not architectural. There are no new requirements, no scenarios, no design decisions, no sequencing.
- The `sdd-explore` artifact (this file) **is** the change folder; promoting it to a full SDD change would just create ceremony.

---

## 6. Out of scope

While running `npx tsc --noEmit` against the working tree to confirm the four reported errors, I observed **additional pre-existing TypeScript errors on `dev`** that were not in the user's brief. I am explicitly **not** addressing these in this fix plan because the user asked for a plan scoped to the four reported files. They are listed below for awareness and can be picked up in a follow-up workstream if desired.

| File | Lines on dev | Error pattern |
|---|---|---|
| `src/cli/seed-projects.spec.ts` | 54, 55, 96, 103, 105, 117, 125, 142, 143, 168 | `FakeProjectRepo` / `FakeProjectUrlRepo` fakes missing 36+ `Repository<T>` members; `row.slug` etc. typed as `unknown` |
| `src/cli/seed-reviews.spec.ts` | 40, 54, 83, 99, 112, 134, 135 | `Record<string, Mock<...>>` fakes missing 39+ `Repository<T>` members |
| `src/cli/seed-superuser.spec.ts` | 53, 74, 93, 110, 127, 131 | `FakeUserRepo` missing 35+ `Repository<T>` members |
| `src/common/filters/all-exceptions.filter.spec.ts` | 87, 193 | `ConfigService<Record<string\|symbol, unknown>, false>` not assignable to `ConfigService<EnvConfig, false>` |
| `src/data-source.spec.ts` | 11 | `migrations is possibly 'undefined'` |
| `src/projects/projects.controller.spec.ts` | 257, 276, 289 | Same `as Record<string, unknown>` / `as Record<string, object>` cast pattern as 2.1 / 2.3 (3 sites) |
| `src/projects/projects.service.spec.ts` | 243, 408, 910 | `.message` on `Error \| ProjectResponseDto` / `void \| Error`; `{ count: number }` not assignable to `number` |
| `src/reviews/dto/list-comments-query.dto.spec.ts` | 19 | `transform` not in `ValidatorOptions` overload — likely a class-validator API drift |
| `src/reviews/reviews-admin.controller.spec.ts` | 174 | Same `as Record<string, unknown>` pattern (line 174 on dev) |

Common patterns observed:
- **Fakes as `Record<string, jest.Mock>`** vs. `Repository<T>`: this is a long-standing issue with the test fakes for the seed scripts. The seed specs need the fakes typed as `Pick<Repository<T>, "save" | "find" | ...>` or use `Partial<Repository<T>>` plus a type assertion, mirroring what the unit-suite fakes do. This is a **larger refactor** than the four files in scope.
- **`Record<string, unknown>` prototype cast** is a pattern used in at least 3 other spec files (`projects.controller.spec.ts`, `reviews-admin.controller.spec.ts`, plus the two in scope). All of them would benefit from the same `as unknown as` escape hatch.
- **`EnvConfig`-typed ConfigService in `all-exceptions.filter.spec.ts`**: the spec uses `as unknown as ConfigService` to drop the type parameter; this loses the type-check on `config.get(...)` calls and is the source of the errors. A cleaner fix is to type the fake as `Pick<ConfigService<EnvConfig>, "get">` or similar.

These are noted here for transparency. They are **not** part of this fix plan and would each warrant their own workstream.

---

## 7. Skill resolution

`paths-injected` — the orchestrator pre-injected the three skill files in the launch prompt:
- `~/.config/opencode/skills/sdd-explore/SKILL.md`
- `~/.config/opencode/skills/_shared/SKILL.md`
- `~/.config/opencode/skills/typescript/SKILL.md`

All three were read before this artifact was written. The shared skill resolver (`_shared/sdd-phase-common.md`, `openspec-convention.md`) was also loaded to confirm the OpenSpec artifact path and naming convention.

---

## 8. Return envelope (for orchestrator consumption)

```yaml
status: ok
executive_summary: |
  Verified all 4 reported TypeScript build errors are pre-existing on dev (commit 2f9c4eb),
  not introduced by domain/contact. Devised 5 minimal line-level fixes across 4 files — all
  type-only or test-fixture, zero runtime impact. Recommended delivery is a fresh
  chore/fix-pre-existing-ts-errors branch from dev with 3 inline commits (~5 changed lines,
  trivially mergeable). Did not edit any source. Out-of-scope: 9 additional pre-existing
  errors in seed-* spec files and other test fakes were observed but are not part of this
  plan.
artifacts:
  - /home/roonder/Personal-Development/roonder-portfolio-backend/openspec/changes/pre-existing-ts-fix/explore.md
next_recommended: inline-commits-on-fresh-branch
risks:
  - 0 runtime risk; all fixes are type-only or test-fixture
  - 1 minor test-fixture risk: adding `comments: [] as ReviewCommentEntity[]` to TOGGLE_BASE_ROW
    matches the runtime behavior the mapper already implements, but a future contributor
    changing the mapper to require non-empty comments would need to update this fixture
  - 9 additional pre-existing TS errors exist in the same build (seed-* specs,
    all-exceptions.filter.spec, projects.controller.spec, projects.service.spec,
    list-comments-query.dto.spec, data-source.spec, reviews-admin.controller.spec)
    and are NOT addressed by this plan
skill_resolution: paths-injected
fix_count: 5
fix_loc_sum: 5
recommended_delivery_path: inline-fresh-branch
questions_for_user:
  - The 9 additional pre-existing TS errors are out of scope for this plan. Do you want a
    follow-up exploration for those (likely a separate fix plan), or are they already
    tracked elsewhere?
  - The 3 commits I propose (reviews spec, reviews controller spec, e2e suite) are
    grouped for atomicity. If you'd prefer 4 commits (one per file), or 1 single commit,
    say so and I'll adjust the work-unit plan in the apply phase.
```

---

*End of `sdd-explore` artifact for `pre-existing-ts-fix`.*
