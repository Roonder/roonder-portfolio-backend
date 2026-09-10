# projects-domain

This is a NEW cross-cutting capability. It owns the `ProjectEntity` and
`ProjectUrlEntity` TypeORM entities (mirroring `projects` and
`project_urls` in `openspec/specs/database-schema.dbml`), the five
`/api/v1/projects` routes mandated by `server_specs.md` §3.2, and the
DIFF semantics on `project_urls` updates. Full semantics of the global
`/api/v1` prefix, the global `ValidationPipe`, CORS, and Swagger bearer
auth live in the `api-bootstrap` capability spec
(`openspec/specs/api-bootstrap/spec.md`); the `JwtAuthGuard` contract
lives in the `auth-domain` capability spec
(`openspec/specs/auth-domain/spec.md`).

The public read surface (`GET /api/v1/projects` and
`GET /api/v1/projects/:slug`) is anonymous. The write surface
(`POST`, `PATCH`, `DELETE`) requires a valid access token in
`Authorization: Bearer ...` and is enforced by the existing
`JwtAuthGuard` per the `auth-domain` Requirement: JwtAuthGuard
(method-level, never global).

## ADDED Requirements

### Requirement: Project and ProjectUrl Entities

The system MUST persist projects in the `projects` table and related
URLs in the `project_urls` table, both defined in
`openspec/specs/database-schema.dbml`. The TypeORM `ProjectEntity` MUST
expose `id` (uuid), `title` (varchar), `slug` (varchar, unique), `description`
(text), `content` (text, nullable), `coverImage` (varchar, nullable), `tags`
(text array), `isPublished` (boolean, default `false`), `createdAt`
(timestamp), and `updatedAt` (timestamp). The `ProjectUrlEntity` MUST
expose `id` (uuid), `projectId` (uuid FK → `projects.id` with
`onDelete: 'CASCADE'`), `title` (varchar), `url` (varchar), `createdAt`
(timestamp), and `updatedAt` (timestamp). The `ProjectEntity` MUST
declare a one-to-many relation to `ProjectUrlEntity` via the
`projectId` column. `ProjectEntity` and `ProjectUrlEntity` MUST be
registered in the shared TypeORM `AppDataSource` (`src/data-source.ts`)
`entities` array AND in `ProjectsModule.imports` via
`TypeOrmModule.forFeature([...])`.

#### Scenario: ProjectEntity columns match the database schema

- GIVEN the `ProjectEntity` is loaded
- WHEN the TypeORM metadata is inspected
- THEN the entity declares `id`, `title`, `slug`, `description`, `content`,
  `coverImage`, `tags`, `isPublished`, `createdAt`, `updatedAt`
- AND `slug` is marked `unique: true`
- AND `isPublished` defaults to `false`

#### Scenario: ProjectUrlEntity columns match the database schema

- GIVEN the `ProjectUrlEntity` is loaded
- WHEN the TypeORM metadata is inspected
- THEN the entity declares `id`, `projectId`, `title`, `url`, `createdAt`,
  `updatedAt`
- AND `projectId` references `projects.id`
- AND the FK is configured with `onDelete: 'CASCADE'`

#### Scenario: One-to-many relation between Project and ProjectUrl

- GIVEN the `ProjectEntity` metadata is inspected
- WHEN the relations are walked
- THEN `ProjectEntity` declares a one-to-many relation to `ProjectUrlEntity`
  keyed on `ProjectEntity.id = ProjectUrlEntity.projectId`

#### Scenario: DataSource and ProjectsModule register both entities

- GIVEN `src/data-source.ts` is loaded
- WHEN the `entities` array of `AppDataSource` is inspected
- THEN it includes `ProjectEntity` and `ProjectUrlEntity`
- AND `ProjectsModule.imports` includes
  `TypeOrmModule.forFeature([ProjectEntity, ProjectUrlEntity])`

### Requirement: Public Project List

The system MUST expose `GET /api/v1/projects` (public, no auth
required). On success the response MUST be `200 OK` with a JSON
envelope of the shape `{ data: Project[], total: number, page: number,
pageSize: number }`. The list MUST default to `isPublished = true` only.
The endpoint MUST support two query filters in this slice: `tags` (array
of strings, applies an array-contains match — a project matches if
EVERY requested tag is present in `project.tags`) and `isPublished`
(boolean). The endpoint MUST support `page` (default `1`, integer ≥ 1)
and `pageSize` (default `20`, integer ≥ 1, capped at `100`) query
params. `pageSize > 100` MUST be silently capped at `100` (NOT rejected).

#### Scenario: Default list returns the published envelope

- GIVEN the `projects` table contains a mix of published and unpublished projects
- WHEN a client sends `GET /api/v1/projects` with no query params
- THEN the response is `200 OK`
- AND the body shape is `{ data: Project[], total: number, page: 1, pageSize: 20 }`
- AND `data` contains ONLY projects with `isPublished = true`
- AND `total` equals the count of `data` rows

#### Scenario: List filters by tags using array-contains

- GIVEN the `projects` table contains projects tagged `['react', 'nestjs']`,
  `['react']`, and `['nestjs']`
- WHEN a client sends `GET /api/v1/projects?tags=react&tags=nestjs`
- THEN the response is `200 OK`
- AND `data` contains ONLY the project tagged `['react', 'nestjs']`
- AND projects tagged with only one of the two tags are NOT in `data`

#### Scenario: List filters by isPublished override

- GIVEN the `projects` table contains both published and unpublished projects
- WHEN a client sends `GET /api/v1/projects?isPublished=false`
- THEN the response is `200 OK`
- AND `data` contains ONLY projects with `isPublished = false`

#### Scenario: List defaults to isPublished=true only

- GIVEN the `projects` table contains projects with `isPublished = false` and
  `isPublished = true`
- WHEN a client sends `GET /api/v1/projects` with no `isPublished` query param
- THEN the response is `200 OK`
- AND `data` contains ONLY projects with `isPublished = true`
- AND unpublished projects are NOT in `data`

#### Scenario: Pagination with page and pageSize

- GIVEN the `projects` table contains 25 published projects
- WHEN a client sends `GET /api/v1/projects?page=2&pageSize=10`
- THEN the response is `200 OK`
- AND `data` contains 10 projects
- AND `page = 2`
- AND `pageSize = 10`
- AND `total = 25`

#### Scenario: pageSize is capped at 100

- GIVEN the `projects` table contains at least 200 published projects
- WHEN a client sends `GET /api/v1/projects?pageSize=500`
- THEN the response is `200 OK`
- AND `pageSize = 100` (silently capped, NOT rejected with 400)
- AND `data` contains at most 100 projects

### Requirement: Public Project Detail by Slug

The system MUST expose `GET /api/v1/projects/:slug` (public, no auth
required). The `:slug` parameter is the project's unique slug string
(NOT the internal uuid). The endpoint MUST return `200 OK` with the
project body when the project exists AND `isPublished = true`. The
endpoint MUST return `404 Not Found` in BOTH of these cases: (a) no
project with the given slug exists, (b) a project with the given slug
exists but has `isPublished = false`. The 404 body MUST NOT distinguish
between the two cases — anonymous callers MUST NOT be able to detect
the existence of unpublished projects.

#### Scenario: Published project is returned by slug

- GIVEN a project exists with `slug = 'portfolio-app'` and
  `isPublished = true`
- WHEN a client sends `GET /api/v1/projects/portfolio-app`
- THEN the response is `200 OK`
- AND the body contains the project (`id`, `title`, `slug`,
  `description`, `content`, `coverImage`, `tags`, `isPublished`,
  `urls`, timestamps)

#### Scenario: Non-existent slug returns 404

- GIVEN no project exists with `slug = 'does-not-exist'`
- WHEN a client sends `GET /api/v1/projects/does-not-exist`
- THEN the response is `404 Not Found`
- AND the body does NOT contain any project field

#### Scenario: Unpublished project returns 404 (no existence leak)

- GIVEN a project exists with `slug = 'draft-idea'` and
  `isPublished = false`
- WHEN a client sends `GET /api/v1/projects/draft-idea`
- THEN the response is `404 Not Found`
- AND the 404 body shape is identical to the "non-existent slug" 404
  body (no field reveals that the project exists)

### Requirement: Admin Project Create

The system MUST expose `POST /api/v1/projects` (Protected — requires a
valid `Authorization: Bearer ...` access token per the
`auth-domain` Requirement: JwtAuthGuard). The request body MUST be
validated by the global `ValidationPipe` against a `CreateProjectDto`
that declares: `title` (string, non-empty), `slug` (string, non-empty,
uniqueness-checked by the service), `description` (string, non-empty),
`content` (string, optional), `coverImage` (URL with `http` or `https`
protocol, optional), `tags` (array of non-empty strings, normalized
via trim + lowercase + dedupe, optional), `isPublished` (boolean,
optional), and `urls` (array of `ProjectUrlDto`, optional, must reject
intra-array duplicates at DTO validation). On success the response
MUST be `201 Created` with the project body. The service MUST check
`slug` uniqueness BEFORE insert; if a project with the same slug
already exists, the response MUST be `409 Conflict`. The service MUST
also catch the Postgres `23505` unique-violation race that beats the
pre-check and re-throw `ConflictException` (do NOT rely solely on the
DB error). The project and its initial `urls` MUST be persisted in a
single transaction (`manager.transaction`) so partial writes are
impossible.

#### Scenario: Valid bearer + valid body persists a project

- GIVEN the `JwtAuthGuard` is applied to `POST /api/v1/projects`
- WHEN a client sends `POST /api/v1/projects` with
  `Authorization: Bearer <valid>` and a valid body
  (including `slug = 'portfolio-app'`)
- THEN the response is `201 Created`
- AND the body contains the new project
- AND a row is inserted in `projects` with the supplied fields
- AND any supplied `urls` rows are inserted in `project_urls` linked by
  `project_id` in the SAME transaction

#### Scenario: Missing bearer returns 401

- GIVEN no `Authorization` header is sent
- WHEN a client sends `POST /api/v1/projects` with a valid body
- THEN the response is `401 Unauthorized`
- AND the controller method is not invoked
- AND no row is inserted in `projects` or `project_urls`

#### Scenario: Invalid bearer returns 401

- GIVEN an access token whose signature does not verify against
  `JWT_SECRET` (or which is expired)
- WHEN a client sends `POST /api/v1/projects` with that bearer
- THEN the response is `401 Unauthorized`
- AND no row is inserted

#### Scenario: Duplicate slug returns 409

- GIVEN a project already exists with `slug = 'portfolio-app'`
- WHEN a client sends `POST /api/v1/projects` with
  `Authorization: Bearer <valid>` and a body whose `slug = 'portfolio-app'`
- THEN the response is `409 Conflict`
- AND no new row is inserted in `projects` or `project_urls`

#### Scenario: Malformed body returns 400 (forbidNonWhitelisted)

- GIVEN the global `ValidationPipe` is configured with
  `forbidNonWhitelisted: true`
- WHEN a client sends `POST /api/v1/projects` with
  `Authorization: Bearer <valid>` and a body containing a field not
  declared on `CreateProjectDto` (e.g. `{ ..., isAdmin: true }`)
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked

### Requirement: Admin Project Update with project_urls DIFF Semantics

The system MUST expose `PATCH /api/v1/projects/:id` (Protected —
requires a valid `Authorization: Bearer ...` access token per the
`auth-domain` Requirement: JwtAuthGuard). The `:id` parameter is the
project's internal uuid (NOT a numeric coercion). The request body MUST
be validated by the global `ValidationPipe` against an
`UpdateProjectDto` where every field is optional. When the `urls` field
is included, the service MUST apply **DIFF semantics**: the incoming
`urls` array represents the desired final set of `project_urls` rows for
the project. The service MUST compute the diff (rows to insert, rows to
delete) and apply ONLY the delta inside a single `manager.transaction`.
The DIFF MUST tolerate an empty incoming array (which means "remove all
rows for this project"). When the `urls` field is OMITTED from the body,
the existing `project_urls` rows MUST be left unchanged (field absent =
no change). The service MUST also re-check `slug` uniqueness on update
and respond `409 Conflict` on collision (same race-catch as create).
The endpoint MUST respond `404 Not Found` when no project matches the
`:id`.

#### Scenario: urls DIFF inserts added rows inside a transaction

- GIVEN a project exists with `:id = P` and zero `project_urls` rows
- WHEN a client sends `PATCH /api/v1/projects/P` with
  `Authorization: Bearer <valid>` and body
  `{ "urls": [{ "title": "Live", "url": "https://live.example.com" }] }`
- THEN the response is `200 OK`
- AND the response body reflects the updated project
- AND exactly one new row exists in `project_urls` linked to `P` with
  the supplied `title` and `url`
- AND the insert happened in a single `manager.transaction` (no
  intermediate state visible to other readers)

#### Scenario: urls DIFF removes deleted rows inside a transaction

- GIVEN a project exists with `:id = P` and TWO `project_urls` rows
  (`{title: 'A', url: 'https://a'}` and `{title: 'B', url: 'https://b'}`)
- WHEN a client sends `PATCH /api/v1/projects/P` with
  `Authorization: Bearer <valid>` and body
  `{ "urls": [{ "title": "A", "url": "https://a" }] }`
- THEN the response is `200 OK`
- AND the `B` row is deleted
- AND the `A` row is preserved (matched on `(title, url)` pair)
- AND the diff+apply happened in a single `manager.transaction`

#### Scenario: urls empty array removes all project_urls

- GIVEN a project exists with `:id = P` and two `project_urls` rows
- WHEN a client sends `PATCH /api/v1/projects/P` with
  `Authorization: Bearer <valid>` and body `{ "urls": [] }`
- THEN the response is `200 OK`
- AND the project row is preserved
- AND ZERO rows remain in `project_urls` linked to `P`

#### Scenario: urls field absent leaves project_urls unchanged

- GIVEN a project exists with `:id = P` and two `project_urls` rows
- WHEN a client sends `PATCH /api/v1/projects/P` with
  `Authorization: Bearer <valid>` and body `{ "title": "New Title" }`
  (no `urls` key)
- THEN the response is `200 OK`
- AND the `title` column is updated to `'New Title'`
- AND the existing `project_urls` rows are unchanged in count and content

#### Scenario: Two urls sharing the same `url` value are rejected at DTO validation

- GIVEN the `UpdateProjectDto.urls` array is validated by
  `class-validator`
- WHEN a client sends `PATCH /api/v1/projects/P` with
  `Authorization: Bearer <valid>` and body
  `{ "urls": [{ "title": "First", "url": "https://x" }, { "title": "Second", "url": "https://x" }] }`
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked
- AND no row in `project_urls` is mutated

#### Scenario: Missing bearer returns 401

- GIVEN no `Authorization` header is sent
- WHEN a client sends `PATCH /api/v1/projects/P` with a valid body
- THEN the response is `401 Unauthorized`
- AND the controller method is not invoked

#### Scenario: Unknown id returns 404

- GIVEN no project exists with `id = P`
- WHEN a client sends `PATCH /api/v1/projects/P` with
  `Authorization: Bearer <valid>` and a valid body
- THEN the response is `404 Not Found`
- AND no row in `projects` or `project_urls` is mutated

#### Scenario: Slug collision on update returns 409

- GIVEN project `P1` has `slug = 'old'`
- AND project `P2` has `slug = 'taken'`
- WHEN a client sends `PATCH /api/v1/projects/P1` with
  `Authorization: Bearer <valid>` and body `{ "slug": "taken" }`
- THEN the response is `409 Conflict`
- AND `P1.slug` is unchanged

### Requirement: Admin Project Delete with Cascade

The system MUST expose `DELETE /api/v1/projects/:id` (Protected —
requires a valid `Authorization: Bearer ...` access token per the
`auth-domain` Requirement: JwtAuthGuard). The `:id` parameter is the
project's internal uuid. On success the response MUST be `204 No
Content`. The hard delete MUST cascade: every `project_urls` row whose
`project_id` matches `:id` MUST be removed in the same operation (via
the `onDelete: 'CASCADE'` FK to `projects.id`). The endpoint MUST
respond `404 Not Found` when no project matches the `:id`. There is NO
soft-delete (`deleted_at`); the DBML has no such column.

#### Scenario: Valid bearer + known id deletes project and child urls

- GIVEN a project exists with `:id = P` and two `project_urls` rows
  linked to `P`
- WHEN a client sends `DELETE /api/v1/projects/P` with
  `Authorization: Bearer <valid>`
- THEN the response is `204 No Content` with an empty body
- AND no row exists in `projects` with `id = P`
- AND no row exists in `project_urls` with `project_id = P`

#### Scenario: Missing bearer returns 401

- GIVEN no `Authorization` header is sent
- WHEN a client sends `DELETE /api/v1/projects/P`
- THEN the response is `401 Unauthorized`
- AND the project and its `project_urls` rows are unchanged

#### Scenario: Unknown id returns 404

- GIVEN no project exists with `id = P`
- WHEN a client sends `DELETE /api/v1/projects/P` with
  `Authorization: Bearer <valid>`
- THEN the response is `404 Not Found`
- AND no row in `projects` or `project_urls` is mutated

### Requirement: Swagger Documentation for Projects

The system MUST annotate the projects controller so the OpenAPI
document at `/api/v1/docs` lists all five routes under the `projects`
tag and shows the bearer padlock on the three protected routes. The
controller MUST carry `@ApiTags('projects')` at the class level. Each
route handler MUST carry `@ApiOperation({ summary: '...' })` and
`@ApiResponse` for the documented 4xx/5xx outcomes. The three protected
handlers (`POST`, `PATCH`, `DELETE`) MUST additionally carry
`@ApiBearerAuth()` so the Swagger UI shows the lock icon and the
endpoint can be exercised with a bearer token in the Authorize dialog.

#### Scenario: Swagger lists the projects tag with all five routes

- GIVEN the application is running
- WHEN a client sends `GET /api/v1/docs-json`
- THEN the JSON body's `paths` object contains
  `/projects`, `/projects/{slug}`, `/projects` (POST),
  `/projects/{id}` (PATCH), and `/projects/{id}` (DELETE)
- AND the `tags` array of each path includes `'projects'`

#### Scenario: Protected routes advertise bearer auth

- GIVEN the application is running
- WHEN a client sends `GET /api/v1/docs-json`
- THEN the `POST /projects`, `PATCH /projects/{id}`, and
  `DELETE /projects/{id}` operations each include a `security` entry
  referencing the bearer security scheme registered via `addBearerAuth()`
  (per `api-bootstrap` Requirement: Swagger API Documentation)
- AND the public `GET /projects` and `GET /projects/{slug}` operations
  do NOT advertise bearer auth

## MODIFIED Requirements

_None. No existing requirements in `openspec/specs/server_specs.md`,
`openspec/specs/api-bootstrap/spec.md`, or `openspec/specs/auth-domain/spec.md`
are modified by this change. The `projects` and `project_urls` tables
are unchanged in the DBML; the `projects-domain` capability is fully
self-contained._

## REMOVED Requirements

_None._
