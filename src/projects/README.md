# `src/projects` — projects domain

The `projects` domain owns the public portfolio and the admin write
surface. It is the only domain in this codebase that exposes a
**public** read API (everything else — `auth`, `reviews`, `contact` —
is either fully admin-gated or write-only public). It is also the
canonical example of the **DIFF semantics** pattern that a future
domain can copy.

| Surface | Caller | Auth |
| ------- | ------ | ---- |
| Read (list + detail) | The public portfolio frontend, the public read e2e | None (anonymous) |
| Write (create / update / delete) | A single admin (the superuser row) | `Authorization: Bearer <jwt>` |

---

## Route table

All routes are mounted under the global `/api/v1` prefix
(`src/main.ts` → `app.setGlobalPrefix('api/v1')`). The paths below
are shown WITHOUT the prefix; the wire paths are `/api/v1/projects`,
`/api/v1/projects/:slug`, etc.

| Method | Path (post-prefix) | Auth | Body / Query | Success | Other 4xx |
| ------ | ------------------ | ---- | ------------ | ------- | --------- |
| `GET`    | `/projects`        | Public | Query: `page?`, `pageSize?`, `tags?`, `isPublished?` | `200 OK` + envelope `{ data, total, page, pageSize }` | `400` (bad query) |
| `GET`    | `/projects/:slug`  | Public | — | `200 OK` + `ProjectResponseDto` | `404` (missing OR unpublished; **same body**) |
| `POST`   | `/projects`        | JWT (`@UseGuards(JwtAuthGuard)`) | Body: `CreateProjectDto` | `201 Created` + `ProjectResponseDto` | `400`, `401`, `409` |
| `PATCH`  | `/projects/:id`    | JWT | Body: `UpdateProjectDto` | `200 OK` + `ProjectResponseDto` | `400`, `401`, `404`, `409` |
| `DELETE` | `/projects/:id`    | JWT | — | `204 No Content` | `400`, `401`, `404` |

`:slug` is the project's public identifier (kebab-case, unique).
`:id` is the project's internal uuid — `ParseUUIDPipe` rejects
non-uuid values with a 400 before the controller runs.

The full OpenAPI document is at `GET /api/v1/docs-json` (Swagger UI
at `/api/v1/docs`); the three protected routes advertise a bearer
padlock via `@ApiBearerAuth()`.

---

## DTOs at a glance

Every DTO lives in `src/projects/dto/`. The list below is the public
input/output contract; click through to the source for the decorators.

| DTO | Purpose | File |
| --- | ------- | ---- |
| `CreateProjectDto`    | Body of `POST /api/v1/projects` (admin). Required: `title`, `slug`, `description`. Optional: `content`, `coverImage`, `tags`, `isPublished`, `urls`. | [`create-project.dto.ts`](./dto/create-project.dto.ts) |
| `UpdateProjectDto`    | Body of `PATCH /api/v1/projects/:id` (admin). `PartialType(CreateProjectDto)` from `@nestjs/swagger` — every field is optional. The DIFF semantics on `urls` (field-absent vs. empty array vs. non-empty array) live in the service, not in the DTO. | [`update-project.dto.ts`](./dto/update-project.dto.ts) |
| `ListProjectsQueryDto`| Query of `GET /api/v1/projects`. Optional: `page`, `pageSize`, `tags`, `isPublished`. Defaults (`page=1`, `pageSize=20`, `isPublished=true`) are applied at the service, NOT the DTO. | [`list-projects-query.dto.ts`](./dto/list-projects-query.dto.ts) |
| `ProjectUrlDto`       | Nested payload inside `CreateProjectDto.urls` / `UpdateProjectDto.urls`. Required: `title` (≤100 chars), `url` (http or https, ≤2048 chars). | [`project-url.dto.ts`](./dto/project-url.dto.ts) |
| `ProjectResponseDto`  | Single project in any response body (list, detail, create, update). Includes `urls: ProjectUrlResponseDto[]` and `createdAt` / `updatedAt` timestamps. | [`project-response.dto.ts`](./dto/project-response.dto.ts) |
| `ListProjectsResponseDto` | Envelope of `GET /api/v1/projects`. Shape `{ data: ProjectResponseDto[], total, page, pageSize }` — `total` is the count of rows that matched the filter (NOT the length of `data`). | [`list-projects-response.dto.ts`](./dto/list-projects-response.dto.ts) |

The intra-array `url` uniqueness rule on `CreateProjectDto.urls` and
`UpdateProjectDto.urls` is enforced by the custom
`@IsUniqueUrlInArray()` validator
([`is-unique-url-in-array.validator.ts`](./dto/validators/is-unique-url-in-array.validator.ts))
— `class-validator`'s built-in `@ArrayUnique` is whole-object
equality, which would let `[{title: A, url: x}, {title: B, url: x}]`
through. The custom decorator normalises `url` to `lower(trim(url))`
and rejects on any duplicate.

---

## Error envelope

Every 4xx and 5xx response on the projects routes (and on every
other route in this app) is rendered by the global
`AllExceptionsFilter` (`src/common/filters/all-exceptions.filter.ts`).
The body shape is locked by the `global-exception-filter` capability
spec — five keys, in this exact order:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Project not found",
  "timestamp": "2026-06-19T12:34:56.789Z",
  "path": "/api/v1/projects/non-existent"
}
```

| Key         | Type            | When it is set |
| ----------- | --------------- | -------------- |
| `statusCode`| `number`        | The HTTP status. `HttpException.getStatus()` for thrown HTTP errors; `500` for raw `Error`. |
| `error`     | `string`        | A short, human-readable label. Sourced from the exception's `getResponse().error` (e.g. `"Not Found"`, `"Unauthorized"`), or a built-in `STATUS_LABELS` fallback (`{ 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 500: "Internal Server Error" }`). |
| `message`   | `string` \| `string[]` | The exception message. A `string` for plain messages; a `string[]` for `class-validator` failures from the global `ValidationPipe`. For a raw `Error` in **production**, this is the fixed generic string `"Internal server error"`. In **development** it is the raw `Error.message`. |
| `timestamp` | `string` (ISO-8601) | The current time captured at filter time (`new Date().toISOString()`). |
| `path`      | `string`        | `req.originalUrl` (or `req.url` as a fallback) of the request that triggered the exception. |

The envelope is the **only** error shape a client will see. The
`401 Unauthorized` from `JwtAuthGuard` upstream of a protected route
is funneled through the same filter — there is no other path to the
client. The `409 Conflict` from a duplicate `slug` is funneled the
same way. NestJS's default plain-text 4xx body is gone.

Server-side, every 5xx (or raw `Error`) emits a single log entry via
`Logger` with `requestId`, `userId`, `method`, `path`, `message`,
`stack`. Production bodies never carry the stack or the raw
exception class name.

---

## DIFF semantics

`PATCH /api/v1/projects/:id` distinguishes between three shapes of
the `urls` field. The decision tree lives in the service
(`src/projects/projects.service.ts → update`), and the canonical
statement is **ADR-1** in the design.

| Body shape | Effect on `project_urls` |
| ---------- | ------------------------ |
| `urls` field absent | No change. Existing rows are left untouched. |
| `urls: []` (empty array) | Every row linked to this project is deleted. |
| `urls: [{...}, ...]` (non-empty) | DIFF: match by `(title, lower(url))` pair. Insert new pairs, delete pairs that no longer appear. Pairs present in both the existing rows and the incoming array are preserved as-is. |

A `urls` array that contains two entries with the same `url` (case
insensitive) is rejected at the DTO layer with a 400 — the
controller method never runs.

### Before / after

Initial state in `project_urls` for a project `P`:

```json
[
  { "title": "Live",      "url": "https://live.example.com" },
  { "title": "Repo",      "url": "https://github.com/me/p"  },
  { "title": "Staging",   "url": "https://staging.example.com" }
]
```

#### Case 1 — field absent

```http
PATCH /api/v1/projects/P
Content-Type: application/json
Authorization: Bearer <jwt>

{ "title": "Renamed project" }
```

Result: `project.title` is updated; the `project_urls` rows above are
unchanged in count and content. The service short-circuits before
`applyProjectUrlsDiff` is called.

#### Case 2 — empty array

```http
PATCH /api/v1/projects/P
Content-Type: application/json
Authorization: Bearer <jwt>

{ "urls": [] }
```

Result: every `project_urls` row linked to `P` is deleted. The
project row itself is preserved. Subsequent `GET /api/v1/projects/P`
returns the project with `urls: []`.

#### Case 3 — non-empty array (DIFF)

```http
PATCH /api/v1/projects/P
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "urls": [
    { "title": "Live",    "url": "https://live.example.com" },
    { "title": "Repo",    "url": "https://github.com/me/p-renamed" },
    { "title": "Docs",    "url": "https://docs.example.com" }
  ]
}
```

DIFF analysis (matched on `title|lower(url)`):

- `{title: "Live",    url: "https://live.example.com"}`  — same key in both → **preserve**
- `{title: "Repo",    url: "https://github.com/me/p"}`     — incoming key does not match the new entry's key → **delete** (URL was renamed)
- `{title: "Staging", url: "https://staging.example.com"}` — incoming key does not include staging → **delete**
- `{title: "Repo",    url: "https://github.com/me/p-renamed"}` — new key, not in existing → **insert**
- `{title: "Docs",    url: "https://docs.example.com"}`    — new key, not in existing → **insert**

Net DB effect inside a single `dataSource.transaction`: 2
`manager.delete` calls + 2 `manager.insert` calls. The two
preserved keys result in zero row mutations.

#### Case 4 — duplicate `url` (rejected at DTO)

```http
PATCH /api/v1/projects/P
Content-Type: application/json
Authorization: Bearer <jwt>

{
  "urls": [
    { "title": "First",  "url": "https://x.example.com" },
    { "title": "Second", "url": "https://x.example.com" }
  ]
}
```

Response: `400 Bad Request` from the global `ValidationPipe` via
`@IsUniqueUrlInArray()`. The `message` field on the envelope is a
`string[]` with one entry per validation failure. The controller
method is not invoked, and no `project_urls` row is mutated. The
two `title` values are different, so `class-validator`'s built-in
`@ArrayUnique` (whole-object equality) would NOT have caught this —
that is the reason the custom decorator exists.

---

## Auth & authorization

Three of the five routes require a valid access token:
`POST /projects`, `PATCH /projects/:id`, `DELETE /projects/:id`.
The guard is `JwtAuthGuard` from `src/auth/guards/jwt-auth.guard.ts`,
applied per-method with `@UseGuards(JwtAuthGuard)` on the route
handler — never globally, never via `APP_GUARD`. The auth-domain
capability spec is the source of truth for the token shape and
the guard's contract.

Sending a request to a protected route without a valid
`Authorization: Bearer <jwt>` header yields:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Unauthorized",
  "timestamp": "2026-06-19T12:34:56.789Z",
  "path": "/api/v1/projects"
}
```

The same envelope is produced for an expired or signature-invalid
token. The `message` is always the literal string `"Unauthorized"`
(the default NestJS `UnauthorizedException` message) — the filter
does not echo token contents or failure reasons to the client.

`GET /projects` and `GET /projects/:slug` carry no guard. The
`isPublished: true` gate on the slug detail prevents an anonymous
caller from distinguishing a missing project from an unpublished
one — the `NotFoundException("Project not found")` body is
**byte-equal** across the two cases (see the
`projects-domain` capability spec — Scenario: "Unpublished project
returns 404 (no existence leak)").

---

## Test layout

Two test surfaces cover the projects module:

- **Unit (colocated, `src/projects/**/*.spec.ts`)** — runs under
  `npm test`. Exercises the entities, DTOs, service, controller,
  and module wire in isolation. Fake repositories via
  `getRepositoryToken`; fake `dataSource.transaction` that captures
  the `manager` so `manager.create` / `manager.save` / `manager.insert`
  / `manager.delete` are observed as `jest.fn()` calls.
  - `entities/project.entity.spec.ts` — 10 columns, `slug unique`, `isPublished default false`, `tags` `text[]`
  - `entities/project-url.entity.spec.ts` — FK + CASCADE
  - `dto/create-project.dto.spec.ts` — happy + 9 reject branches
  - `dto/update-project.dto.spec.ts` — optional-everything, DIFF payload shapes
  - `dto/list-projects-query.dto.spec.ts` — query transforms (incl. the `isPublished` `obj`-recovery regression test from PR3)
  - `projects.service.spec.ts` — `findPublic`, `findOneBySlug`, `create`, `update` (DIFF in all 4 cases), `remove`
  - `projects.controller.spec.ts` — 5 routes + guard placement + Swagger
  - `projects.module.spec.ts` — module wire (static contract)
- **E2E (`test/projects.e2e-spec.ts`)** — runs under
  `npm run test:e2e`. Stubs `DATABASE_URL` and mocks `@nestjs/typeorm`
  the same way `test/auth.e2e-spec.ts` does. Drives the full HTTP
  surface with supertest; mints real JWTs via `JwtService` for the
  protected cases. 24 cases across 5 describe blocks (public list,
  public detail by slug with no-existence-leak 404, admin CRUD
  with JWT, global filter shape on 4xx and 5xx).

The global exception filter is wired in both surfaces:
`src/main.ts` for the runtime and the e2e test module, so the
`{ statusCode, error, message, timestamp, path }` assertions in
both unit and e2e tests hit the real filter, not a stub.

---

## Related docs

- **Entity contract** — `openspec/specs/database-schema.dbml` (the
  `projects` and `project_urls` tables, including the `LOWER(slug)`
  and GIN-on-`tags` indexes).
- **Backend contract** — `openspec/specs/server_specs.md` (the
  `/api/v1` prefix, the global `ValidationPipe` and CORS / Swagger
  configuration, and the full route list across all domains).
- **Auth contract** — `openspec/specs/auth-domain/spec.md` (the
  `JwtAuthGuard` contract, the access-token shape, the cookie-based
  refresh-token rotation).
- **Bootstrap contract** — `openspec/specs/api-bootstrap/spec.md`
  (the global pipe, CORS, Swagger bearer scheme, prefix).
- **This change** — `openspec/changes/projects-crud/` (the proposal,
  the delta specs for `projects-domain` and
  `global-exception-filter`, the design with the 7 ADRs, the
  per-PR tasks, and the per-PR `apply-progress.md` you are reading
  alongside this README).
