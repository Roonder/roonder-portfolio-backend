# Proposal: Projects Domain CRUD + Global Exception Filter

## Intent

`src/projects/` is the NestJS scaffold stub: an empty `ProjectsController` with `findOne(@Param('id') id: string)` calling `service.findOne(+id)` (numeric coercion on a uuid column — a bug carried from the original scaffold), zero DTOs, zero entities, no `@UseGuards(JwtAuthGuard)`, no Swagger annotations, and the service returns string placeholders. `server_specs.md` §3.2 mandates five projects routes (2 public, 3 protected) and `database-schema.dbml` defines the `projects` and `project_urls` tables. `src/main.ts` registers no global exception filter, so any unhandled error returns Nest's default bare `500`. This change lands the full Projects domain on the auth-domain foundation, plus a new global filter so 4xx/5xx responses have a single documented shape. Read endpoints stay public for the frontend; create/update/delete are protected by the existing `JwtAuthGuard`.

## Scope

### In Scope

- `ProjectEntity` + `ProjectUrlEntity` matching DBML; `src/data-source.ts` registers both.
- DTOs: `CreateProjectDto`, `UpdateProjectDto` (`PartialType(CreateProjectDto)`), `ListProjectsQueryDto`, `ProjectUrlDto` (nested), `ProjectResponseDto` (single response shape reused across list/get/create/update).
- 5 routes per `server_specs.md` §3.2: `GET /api/v1/projects` (public, paginated, envelope-shaped), `GET /api/v1/projects/:slug` (public), `POST /api/v1/projects` (JWT), `PATCH /api/v1/projects/:id` (JWT), `DELETE /api/v1/projects/:id` (JWT).
- Public list envelope `{ data: Project[], total: number, page: number, pageSize: number }` (locked); first-slice filters `tags` (array-contains) and `isPublished` (boolean).
- `project_urls` update uses **DIFF semantics** (locked): the incoming array is the desired final set; service computes added/removed, validates intra-array uniqueness, persists only the delta. Not replace-all, not merge-by-id.
- New global `AllExceptionsFilter` in `src/common/filters/`, wired in `src/main.ts` via `app.useGlobalFilters(...)`. Body shape `{ statusCode, error, message, timestamp, path }` for 4xx; 5xx returns a sanitized generic message and logs the real error server-side. Preserves the existing 401/400 flow used by the auth domain.
- Swagger annotations (`@ApiTags('projects')`, `@ApiOperation`, `@ApiBearerAuth()` on the 3 protected routes, `@ApiResponse` for 4xx/5xx) mirroring `src/auth/auth.controller.ts`.
- Colocated `*.spec.ts` (controller, service, entities, filter) + `test/projects.e2e-spec.ts` (mint a JWT signed with the test secret for protected cases). Strict-TDD RED-first.
- Drop the `+id` numeric coercion on `:id` path params; uuid throughout.

### Out of Scope

- Full-text search on projects; cursor pagination; tag autocomplete.
- Soft delete, audit log, version history, optimistic locking.
- Image upload (Supabase pre-signed URL flow is a follow-up; `cover_image` stays an `@IsUrl` string).
- Multi-language content, i18n slugs, slug auto-generation (slug is client-supplied, uniqueness-checked in service).
- Reviews/comments work, Contact work, Auth work — not touched.
- RBAC beyond "is authenticated" (single-admin system; per auth-domain).
- Caching (HTTP cache, Redis, in-memory).
- Per-env-rate-limit / request-throttling on the public list.

## Capabilities

> Contract with sdd-spec. Source: `openspec/specs/server_specs.md` §3.2, `openspec/specs/database-schema.dbml` (tables `projects` and `project_urls`).

### New Capabilities

- `projects-domain`: `ProjectEntity` + `ProjectUrlEntity`, the 5 spec routes, envelope-shaped public list with `tags` + `isPublished` filters, slug-based public detail, id-based admin mutations, DIFF semantics on `project_urls` updates, slug-uniqueness check, transactional create, hard delete with FK cascade.
- `global-exception-filter`: single filter under `src/common/filters/`, wired in `main.ts`. Uniform 4xx body; sanitized 5xx body with server-side log. Reusable by every future domain change.

### Modified Capabilities

- `server_specs.md` §3.2: spell out the public envelope shape, the `tags` + `isPublished` filter contract, the DIFF semantics on `project_urls` updates, and the read-by-slug / write-by-id asymmetry; cross-reference `projects-domain` and `global-exception-filter` capabilities.
- `database-schema.dbml`: if the proposal commits to `text[]` for `tags` (recommended, see Open Questions), update the column type from `varchar[]` to `text[]` to match the entity. The DBML delta is shipped in `sdd-archive`.

## Approach

RED-first TDD on `domain/projects`, delivered as **chained PRs** to stay under the 400-line review budget (~670 LOC total). Ordering chosen so each chain is self-contained and `npm test` + `npm run test:e2e` stay green between chains.

1. **Chain 1 — Foundation (entities, DataSource, exception filter).** `ProjectEntity`, `ProjectUrlEntity`, entity-metadata specs (mirror `src/auth/entities/user.entity.spec.ts`), `src/data-source.ts` registration, `AllExceptionsFilter` + filter unit spec, `app.useGlobalFilters(new AllExceptionsFilter())` in `main.ts`. The filter lands first so every later chain's tests rely on a consistent error shape. ~200 LOC.
2. **Chain 2 — DTOs + service + controller.** All 5 DTOs, `ProjectsService` (TypeORM CRUD, slug uniqueness, transactional nested `project_urls` save, DIFF semantics on update, envelope list, `tags` array-contains filter via Postgres `@>` operator), `ProjectsController` with `@ApiTags('projects')` / `@UseGuards(JwtAuthGuard)` / Swagger annotations. Updated unit specs. ~300 LOC.
3. **Chain 3 — E2E test.** `test/projects.e2e-spec.ts` covering: public list (200 + envelope shape, only-published default, `?tags=` + `?isPublished=true` filters, `?page` + `?pageSize` pagination, 400 on bad query types per ADR-2), public detail by slug (200 + 404 for both not-found and not-published), protected create (201 + 400 validation + 401 no token + 409 duplicate slug), protected update (200 + 401 + 404 + DIFF semantics on `project_urls`), protected delete (204 + 401 + 404), filter shape (4xx body has `{ statusCode, error, message, timestamp, path }`; 5xx body has sanitized message and no stack). ~150 LOC.
4. **Chain 4 — README.** Add the Projects endpoints table; add a short "Error response shape" subsection that documents the new filter convention for the next domain change. ~20 LOC.

**Public read-side defaults** (proposal locks): `isPublished` defaults to `true` on the public list (only published). Public detail (`GET :slug`) returns 404 for both "not found" and "exists but not published" — do not leak the existence of unpublished projects. Protected create/update accepts any `isPublished` value. `content` soft-capped at `@MaxLength(50_000)` (50 KB of Markdown). `tags` normalized via `@Transform(({ value }) => value.map(v => v.trim().toLowerCase()).filter(Boolean))`; empty/duplicate tags silently dropped. `cover_image` validated with `@IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @IsOptional()`. `project_urls` FK uses `onDelete: 'CASCADE'` so a project delete cleans up child rows. Slug-uniqueness pre-check in service throws `ConflictException`; on the rare race, also catch `QueryFailedError` (Postgres `23505`) and re-throw `ConflictException` — never rely solely on the DB error. No soft delete (`deleted_at` not in DBML).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/projects/entities/project.entity.ts` | Replaced | TypeORM `@Entity('projects')` matching DBML; `@OneToMany` to `ProjectUrlEntity`. |
| `src/projects/entities/project-url.entity.ts` | New | TypeORM `@Entity('project_urls')`; `@ManyToOne` to `ProjectEntity` with `onDelete: 'CASCADE'`. |
| `src/projects/entities/{project,project-url}.entity.spec.ts` | New | Entity-metadata assertions (mirror `src/auth/entities/user.entity.spec.ts`). |
| `src/projects/dto/create-project.dto.ts` | Replaced | Full body: `title`, `slug`, `description`, `content?`, `coverImage?`, `tags?`, `isPublished?`, `urls?: ProjectUrlDto[]`. |
| `src/projects/dto/update-project.dto.ts` | Replaced | `PartialType(CreateProjectDto)`; every field optional; `urls` keeps DIFF semantics. |
| `src/projects/dto/list-projects-query.dto.ts` | New | `page?`, `pageSize?`, `tags?` (csv or repeated), `isPublished?`. Uses `@Type(() => Number)` per ADR-2. |
| `src/projects/dto/project-url.dto.ts` | New | Nested `{ title: string; url: string }`. |
| `src/projects/dto/project-response.dto.ts` | New | Single response shape with `@ApiProperty`; reused by list/get/create/update. |
| `src/projects/projects.controller.ts` | Replaced | 5 routes; `@ApiTags('projects')`; `@UseGuards(JwtAuthGuard)` on the 3 write methods; `@ApiBearerAuth()` on those; `@ApiOperation` + `@ApiResponse` everywhere. |
| `src/projects/projects.service.ts` | Replaced | TypeORM-backed CRUD; slug uniqueness; DIFF `project_urls` update; transactional create; envelope list. |
| `src/projects/projects.controller.spec.ts` | Replaced | HTTP-shape + guard + Swagger-route assertions (mirror `src/auth/auth.controller.spec.ts`). |
| `src/projects/projects.service.spec.ts` | Replaced | Service behavior: slug uniqueness, DIFF semantics, list filter, pagination math. |
| `src/projects/projects.module.ts` | Modified | Add `TypeOrmModule.forFeature([ProjectEntity, ProjectUrlEntity])` (mirror `src/auth/auth.module.ts:16`). |
| `src/common/filters/all-exceptions.filter.ts` | New | `@Catch()` global filter; 4xx passthrough + 5xx sanitization + server-side log. |
| `src/common/filters/all-exceptions.filter.spec.ts` | New | Unit spec: HttpException path + raw Error path + log assertion. |
| `src/main.ts` | Modified | `app.useGlobalFilters(new AllExceptionsFilter())` after the existing `useGlobalPipes` / `enableCors` calls. |
| `src/data-source.ts` | Modified | Add `ProjectEntity, ProjectUrlEntity` to the `entities` array. |
| `test/projects.e2e-spec.ts` | New | Full HTTP coverage of the 5 routes + filter shape. |
| `openspec/specs/server_specs.md` | Modified | §3.2 gains envelope shape, filter contract, DIFF semantics, read-by-slug / write-by-id asymmetry. |
| `openspec/specs/database-schema.dbml` | Possibly modified | If `tags` is committed as `text[]` (recommended). |
| `README.md` | Modified | Projects endpoints table; new "Error response shape" subsection. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| New global filter leaks the stack in 5xx or breaks the existing auth 401/400 shape. | Med | Filter unit spec asserts both HttpException and raw Error paths; `test/bootstrap.e2e-spec.ts` sanity-checks the `forbidNonWhitelisted` 400 body still has the expected envelope; the filter is added in Chain 1 so any auth-domain regression is caught before later chains land. |
| Tests that build a `Test.createTestingModule` for `ProjectsModule` forget to provide fake `getRepositoryToken(ProjectEntity)` / `getRepositoryToken(ProjectUrlEntity)` and fail with "Nest can't resolve dependencies". | Med | Apply agent MUST add fakes for both entities in every test module that instantiates `ProjectsModule` (pattern: `src/app.module.spec.ts:65-86`). |
| `tags` Postgres `varchar[]` vs. TypeORM `type: 'text', array: true` mismatch with the DBML. | Low | Proposal commits to `text[]` on the entity + DBML update at archive (see Open Questions). If the user objects, entity stays `varchar[]` and the DBML is untouched. |
| Chained-PRs delivery: a foundation-only Chain 1 sits in review while Chains 2–4 are still being written. Looks like a stall. | Med | Rollback Plan + Success Criteria make the chain ordering explicit. Orchestrator confirms the delivery mode with the user before apply starts. |
| The stub `+id` numeric coercion on `:id` is copied into a future write method by a contributor who pattern-matches on the stub. | Low | Stub controller is fully replaced in Chain 2; pre-existing stub `.spec.ts` smoke tests are replaced at the same time. Add a one-line comment on `:id` params in the new controller warning that `:id` is a uuid, not a number. |
| `project_urls` DIFF semantics race: a concurrent `PATCH` from another admin between the read and the write can lose data. | Low | Wrap the diff+apply in a `manager.transaction` with `SERIALIZABLE` isolation (or rely on the FK + an explicit `updated_at` re-check inside the transaction). Document the choice in design. |
| `forbidNonWhitelisted: true` on a DTO that ships `urls: ProjectUrlDto[]` rejects legitimate partial updates if the client forgets to send the field. | Low | `@IsOptional()` on every field of `UpdateProjectDto`; DIFF semantics treat "field absent" as "no change" (not "set to empty array"). Unit spec covers the absent-field case. |
| Pre-existing 8 unused-DTO-param lint errors in `src/{auth,contact,projects,reviews}/*.service.ts` linger. | Low | The projects service is rewritten with real DTO usage, so its 2 errors resolve. Auth/Reviews/Contact stay untouched — flagged in the verify report so the next domain change knows. |

## Rollback Plan

`src/data-source.ts` still has `synchronize: false`; no DB migration is shipped, so the schema in any environment is unaffected by this change. The new routes are additive — no existing endpoint is renamed or removed. To revert: `git revert <merge-sha>` (or the per-chain `git revert <sha>` for partial rollback); the projects routes disappear and the stub controller is restored. The global filter is wired in `main.ts` and can be reverted by removing the single `useGlobalFilters` call without affecting the rest of the bootstrap. Per the explore, the static guard-rail in `src/app.module.spec.ts:143-156` MUST stay green — `JwtAuthGuard` is per-controller only, never global; this change does not register it as `APP_GUARD`. Chained-PRs rollback: if Chain 1 lands and the user wants to stop, revert only that merge — Chains 2–4 never went out, and the bootstrap is still consistent (the filter is generic enough that it improves auth even without projects shipped).

## Dependencies

- **Reuse**: `@nestjs/typeorm`, `@nestjs/swagger`, `class-validator`, `class-transformer`, `typeorm`, `pg` — all already installed. `JwtAuthGuard` (from `src/auth/guards/jwt-auth.guard.ts`) — reused via `@UseGuards`.
- **No new packages** required.

## Success Criteria

- [ ] `npm run build` passes.
- [ ] `npm test` passes (unit specs added for controller, service, both entities, and the filter).
- [ ] `npm run test:e2e` passes (bootstrap suite + new `test/projects.e2e-spec.ts`).
- [ ] `GET /api/v1/projects` (public) → 200 with envelope `{ data, total, page, pageSize }`; defaults to `isPublished=true`; `?tags=react,nestjs` filters; `?page=2&pageSize=5` paginates.
- [ ] `GET /api/v1/projects/:slug` (public) → 200 with the project; 404 for both "not found" and "exists but not published".
- [ ] `POST /api/v1/projects` without `Authorization` → 401; with a valid bearer → 201 + project; duplicate `slug` → 409; bad body → 400 (envelope shape).
- [ ] `PATCH /api/v1/projects/:id` without `Authorization` → 401; with bearer → 200; sending `urls` triggers DIFF semantics (verify added/removed rows in a unit spec).
- [ ] `DELETE /api/v1/projects/:id` without `Authorization` → 401; with bearer → 204; cascade deletes child `project_urls` rows.
- [ ] Any `HttpException` → response body matches `{ statusCode, error, message, timestamp, path }`.
- [ ] Any raw `Error` (forced via a test that throws) → 500 with sanitized generic message; full error logged server-side; no stack in the body.
- [ ] Swagger UI at `/api/v1/docs` lists `Projects` tag with the 5 routes; the 3 write routes show the bearer padlock.
- [ ] `src/data-source.ts` lists `ProjectEntity, ProjectUrlEntity`; `npm run build` resolves both entities.
- [ ] `server_specs.md` §3.2 reflects the envelope, filters, DIFF semantics, and read-by-slug / write-by-id asymmetry.
- [ ] `README.md` has the Projects endpoints table and the "Error response shape" subsection.

## Open Questions for Spec/Design

1. **`tags` column type** — DBML has `varchar[]`; the entity wants `text[]` for tags (Postgres treats `varchar[]` as length-constrained arrays which is rarely what you want for tags, and TypeORM has no first-class `varchar[]` mapping — only `text[]` with `array: true` is the conventional choice). The proposal commits to `text[]` on the entity and a DBML update at archive time. If the user prefers strict DBML fidelity, the entity uses `type: 'varchar', array: true` and the DBML is untouched. **Recommendation: `text[]` + DBML update.**
2. **Chained PRs vs. single PR** — total ~670 LOC is well above the 400-line review budget. The proposal recommends 4 chained PRs as the default delivery mode (Chain 1 ≈ 200, Chain 2 ≈ 300, Chain 3 ≈ 150, Chain 4 ≈ 20). Confirm with the user before apply.
3. **Admin get-by-id route path** — `server_specs.md` only mandates slug-based public read. The proposal accepts adding a `GET /api/v1/admin/projects/:id` behind `JwtAuthGuard` for unpublished previews, but the path and the spec wording are TBD in design. **Recommendation: `GET /api/v1/admin/projects/:id`, listed in the same `projects-domain` capability spec, explicitly admin-only.**
4. **Diff `project_urls` uniqueness check** — should the service reject an incoming `urls` array with duplicate `(title, url)` pairs as 400 (validation), or 409 (conflict)? **Recommendation: 400 — duplicates are a client error caught at the DTO layer via `@ArrayUnique(({title, url}) => title + '|' + url)` on `ProjectUrlDto[]`.**
5. **`project_urls` empty array on update** — does sending `urls: []` mean "remove all" (DIFF semantics) or "no change" (field absent = no change)? **Recommendation: explicit empty array = remove all; field absent = no change. Document in the capability spec to remove ambiguity.**
6. **Content sanitization** — the spec stores raw Markdown/HTML in `content`. Should the service strip `<script>` tags, or is that the frontend's job? **Recommendation: backend stores as-is; sanitization is the frontend's responsibility (and the user's, when they edit Markdown). Out of scope for this change.**

The spec/design phases do NOT need to re-litigate public-vs-protected split, the envelope shape, the DIFF semantics, the `JwtAuthGuard` reuse, or the filter shape — those are locked.
