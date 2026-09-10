# Apply Progress — Batch A: `domain-contact`

## Status: **ok**

Branch `domain/contact` is up to date with 10 new work-unit commits
landing the contact domain's internal surface. All quality gates are
green for the contact scope; the pre-existing TypeScript errors in
`src/reviews/*` and the e2e files remain untouched (they predate
`domain/contact`).

## Per-task summary

| Task ID | Title | Commit | Result |
|--------:|-------|--------|--------|
| 2.3 | Add `SentEmailEntity` + enums (in-flight) | `ed2469f` | ok — entity was already in the working tree from the previous batch; confirmed GREEN (8 metadata assertions); committed verbatim. |
| 2.4 | Register both entities in `AppDataSource` | `a429009` | ok — no test (the contract is `typeorm schema:log` + e2e); `tsc` confirmed 0 new errors. |
| 3.1 | `CreateContactDto` (4 fields, strict validation) | `a0c06a5` | ok — RED→GREEN→REFACTOR: 14 DTO validation scenarios; 1 inline `Matches(/\S/)` regex added to reject whitespace-only messages (the spec scenario "rejects whitespace-only message"). |
| 3.2 | `UpdateContactStatusDto` + drop broken `update-contact.dto.ts` stub | `455e509` | ok — RED→GREEN→REFACTOR: 7 scenarios; `CONTACT_STATUS` const object + `ContactStatus` type extracted; deleted the broken `PartialType` stub; the deletion cascaded to also remove the unused `update` method from the scaffold `contact.service.ts` + the unused `Patch`/`UpdateContactDto` import from the scaffold `contact.controller.ts` (the dead code referenced the deleted file). |
| 3.3 | `ListContactsQueryDto` (page + pageSize) | `c6445af` | ok — RED→GREEN→REFACTOR: 6 scenarios mirroring the reviews precedent. |
| 3.4 | Response DTOs (`ContactResponseDto`, `ListContactsResponseDto`, `ListContactsResult`) | `9c7a87c` | ok — no separate spec (the response shape is locked by the controller spec in T6.2 / the e2e in T11.1). |
| 5.1 | `contact.mapper.ts` (`toContactResponse` pure function) | `66ebbd9` | ok — RED→GREEN→REFACTOR: 6 scenarios including the destructive-change assertion ("no `emailSentLog` field"). |
| 4.1 | `ContactCreatedEvent` (the async event payload) | `be6222b` | ok — no separate spec (data class only; the listener spec in T8.1 covers behavior). |
| 4.2 + 4.3 | `ContactService.create` + `findAllForAdmin` + `updateStatus` (REPLACE smoke spec) | `9892b89` | ok — RED→GREEN→REFACTOR: 12 behavioral scenarios (5 for `create`, 4 for `findAllForAdmin`, 3 for `updateStatus`). The smoke `toBeDefined()` test is GONE. The `SentEmailEntity` repo is forward-injected but unused (the email pipeline lands in T7.4). The `EventEmitter2` is injected and the `contact.created` event is emitted after persistence (the listener lands in T8.1). |
| n/a (chore) | Lint fixes + integration test fakes | `fb5af18` | ok — `npm run lint` was failing on 18 errors I introduced in the service spec + controller stub; ESLint `--fix` auto-formatted the new files; the `TestFakesModule` in `main.spec.ts` + `app.module.spec.ts` was extended with `ContactEntity` + `SentEmailEntity` repo fakes + a no-op `EventEmitter2` to keep the existing full-app-composition integration tests green after T4.2 expanded the `ContactService` constructor. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.3 | `src/contact/entities/sent-email.entity.spec.ts` | Unit (static metadata) | N/A (in-flight) | ✅ Verified pre-commit (8/8 passing) | ✅ Already GREEN | ✅ 8 cases | ✅ Clean (prettier applied via `lint --fix`) |
| 2.4 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| 3.1 | `src/contact/dto/create-contact.dto.spec.ts` | Unit | N/A (new) | ✅ 14/14 failed | ✅ 14/14 passed | ✅ 14 cases (happy + 13 edge) | ✅ Inline `Matches(/\S/)` to satisfy whitespace-only rejection |
| 3.2 | `src/contact/dto/update-contact-status.dto.spec.ts` | Unit | N/A (new) | ✅ Module-not-found | ✅ 7/7 passed | ✅ 7 cases | ✅ `CONTACT_STATUS` const object extracted |
| 3.3 | `src/contact/dto/list-contacts-query.dto.spec.ts` | Unit | N/A (new) | ✅ Module-not-found | ✅ 6/6 passed | ✅ 6 cases | ✅ 2 unneeded `async` removed (lint) |
| 3.4 | n/a (response DTOs, no spec) | n/a | n/a | n/a | n/a | n/a | n/a |
| 5.1 | `src/contact/contact-response.mapper.spec.ts` | Unit | N/A (new) | ✅ Module-not-found | ✅ 6/6 passed | ✅ 6 cases | ✅ Used `ReturnType<typeof toContactResponse>` shape |
| 4.1 | n/a (event data class) | n/a | n/a | n/a | n/a | n/a | n/a |
| 4.2 + 4.3 | `src/contact/contact.service.spec.ts` (REPLACES smoke) | Unit (DI fakes) | N/A (replaces smoke) | ✅ 12/12 failed (smoke `toBeDefined` → behavioral) | ✅ 12/12 passed | ✅ 12 cases (5 create + 4 findAll + 3 update) | ✅ `CONTACT_STATUS` const used; mock factories typed |
| Cleanup | (lint + integration fakes) | n/a | n/a | n/a | n/a | n/a | ✅ Auto-fix + minimal fakes |

**Test summary**:
- Total tests in `src/contact/`: **64 passing** across 8 specs
- Total tests in the whole suite: **394 passing, 1 skipped** (41 suites all green)
- Layers used: Unit (8 specs); no integration / no E2E in this batch
- Pure functions created: 1 (`toContactResponse`)
- Approval tests: 0 (no refactor of existing behavior in this batch)

## Final commit count

- **5 pre-existing** on `domain/contact` (carried in from previous batches)
- **10 NEW work-unit commits** in Batch A (10 task IDs)
- **+1 cleanup commit** (lint fixes + test fakes; counts toward "new commits in batch")
- **15 total on `domain/contact`** (verified via `git log dev..HEAD --oneline`)

## Quality gate results

### `npm test` — **PASS** (391 → 394 passing)

- 41 / 41 suites green
- 394 tests passing, 1 skipped, 0 failing
- All 8 contact specs green: `contact.service.spec.ts` (12), `contact.controller.spec.ts` (1), `entities/contact.entity.spec.ts` (10), `entities/sent-email.entity.spec.ts` (8), `dto/create-contact.dto.spec.ts` (14), `dto/update-contact-status.dto.spec.ts` (7), `dto/list-contacts-query.dto.spec.ts` (6), `contact-response.mapper.spec.ts` (6)
- 0 NEW failures introduced (the 2 pre-existing `app.module.spec.ts` + `main.spec.ts` failures caused by T4.2's expanded `ContactService` constructor were fixed in the cleanup commit by extending `TestFakesModule`)

### `npm run lint` — **PASS** (exit 0)

- 0 errors after the cleanup commit
- 18 errors I introduced in T4.2 were fixed by ESLint `--fix` + a small spec rewrite (typed the `EventEmitter2` mock return; removed 2 unneeded `async` keywords)

### `npm run build` — **PASS** (exit 0)

- `nest build` succeeds (the `swc`-based build does NOT type-check, so the pre-existing `tsc` errors in `src/reviews/*` do not block the build)

### `npx tsc --noEmit -p tsconfig.json` — **9 pre-existing errors, 0 new errors**

- **PRE-EXISTING (9 errors, NOT in my scope, NOT touched)**:
  - `src/reviews/dto/list-comments-query.dto.spec.ts(19,24)`: no-overload-match
  - `src/reviews/reviews-admin.controller.spec.ts(174,17)`: type-cast
  - `src/reviews/reviews.controller.spec.ts(397,17)`: type-cast
  - `src/reviews/reviews.service.spec.ts(122,17)`: type-cast
  - `src/reviews/reviews.service.spec.ts(419,21)`: missing-`comments`-property
  - `src/reviews/reviews.service.spec.ts(437,21)`: missing-`comments`-property
  - `test/auth.e2e-spec.ts(224,46)`: missing `EnvConfig` import
  - `test/auth.e2e-spec.ts(225,36)`: no-overload-match
  - `test/projects.e2e-spec.ts(369,14)`: type-cast
- **NEW (0)**: verified via `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "(src/contact|test/contact)"` → 0 hits

## In-flight files handling

- `src/contact/entities/sent-email.entity.ts` + `sent-email.entity.spec.ts` were the in-flight pair from the previous batch's context exhaustion.
- The files were already in GREEN state (8 metadata assertions passing, no `toBeDefined` smoke); the entity's columns, enums, and snake-case mapping exactly matched the design's `§5.1` table.
- Action: **committed verbatim as task 2.3** (`ed2469f`). The 8 metadata tests are real behavioral assertions (none are trivial `toBeDefined` or empty-collection traps).

## `.env.example` status

The file was created by the previous batch's T1.1 commit (`8a87282`) and already contains:
- `RESEND_API_KEY=re_test`
- `# REEMPLAZAR CUANDO SE COMPRE EL DOMINIO` comment + `RESEND_FROM_ADDRESS="Roonder Portfolio <hello@yourdomain.com>"`
- `RESEND_TO_ADDRESS=you@personal.com`
- The 3 reviews throttler vars + 3 contact throttler vars

**Status: complete.** No changes needed in Batch A.

## New dependencies added to `package.json`

- **None.** `@nestjs/event-emitter` (committed in T0.2 = `66cbf65` by the previous batch), `@nestjs/throttler`, `resend` were all already present.

## Risks for Batch B

- **The `ContactController` scaffold is currently only `@Post() create()`** with NO `@ThrottledContactWrite()` decorator and NO `@ApiOperation` / `@ApiResponse` metadata. Task 6.2 (Batch B) will REPLACE this stub; if T6.2 doesn't land, the public POST is unthrottled and un-documented.
- **The `ContactService` constructor is already locked at 3 dependencies** (ContactEntity repo, SentEmailEntity repo, EventEmitter2). Task 9.1 (Batch B, ContactModule) MUST register the 2 repository tokens via `TypeOrmModule.forFeature([ContactEntity, SentEmailEntity])` and add `EventEmitterModule` to its imports, otherwise the production app will fail to bootstrap.
- **The `ContactCreatedEvent` is emitted but has no listener.** T8.1 (Batch B) will add `ContactEmailListener`. Until then, events fire into the void (no emails are sent).
- **The `ContactService.sentEmails` repo is forward-injected but unused** in this batch. T7.4 (Batch B, EmailService) will use it. The injection is the contract for the upcoming constructor expansion.
- **The smoke `ContactController` test (`contact.controller.spec.ts`) is a `toBeDefined()` placeholder.** T6.2 (Batch B) will REPLACE it with HTTP-shape supertest scenarios.
- **The 9 pre-existing `tsc` errors** block `npx tsc --noEmit` but NOT `npm run build` (which uses swc). A separate `pre-existing-ts-fix` change is in flight (untracked in this working tree) and will land in a future batch — Batch B's verify step should still document the 9 errors as pre-existing even after Batch B lands, unless the parallel fix lands first.
- **The `data-source.ts` now has 7 entities** (was 5); the migration glob still covers the new migration. `typeorm schema:log` against a live Postgres (per the migration's header) is still on the `sdd-verify` checklist.

## Open questions for Batch B

- None blocking. All 7 preflight decisions remain locked (per `proposal §6`). The user's locked delivery strategy (`single-pr` by user action) remains intact — Batch B should land the remaining 12 tasks as additional work-unit commits on the same branch.
