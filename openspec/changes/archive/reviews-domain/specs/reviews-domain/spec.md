# reviews-domain

This is a NEW domain capability. It owns the `ReviewEntity` and
`ReviewCommentEntity` TypeORM entities (mirroring `reviews` and
`review_comments` in `openspec/specs/database-schema.dbml`, plus an
`is_approved` column on `review_comments` that this change adds on
top of the DBML — see Requirement: ReviewCommentEntity), the four
public routes and three protected routes mandated by
`server_specs.md` §3.3, the `{ data, total, page, pageSize }`
envelope for paginated lists, and the public-read existence-leak
guard.

The cross-cutting HTTP bootstrap (global `/api/v1` prefix, global
`ValidationPipe`, CORS, Swagger bearer auth, the canonical 4xx/5xx
envelope) lives in the `api-bootstrap` and `global-exception-filter`
capability specs; the `JwtAuthGuard` contract (method-level, never
global) lives in the `auth-domain` capability spec; the anti-spam
throttler lives in the `reviews-throttling` delta spec in this same
change.

The write surface is split across two controllers mounted at
`/api/v1/reviews` and `/api/v1/admin/reviews`. The public read
surface is anonymous. The four public endpoints carry per-route
`@Throttle()` decorators (per `reviews-throttling` §Per-Route
Throttle Limits). The three admin endpoints carry
`@UseGuards(JwtAuthGuard) @ApiBearerAuth()` and are NOT throttled.

`ReviewEntity` and `ReviewCommentEntity` declare NO polymorphism (no
`project_id`, no `owner_user_id`, no `subject_type` discriminator).
A review's `content` is free text — visitors who want to refer to
a project or to the owner write that into `content`. The two
tables mirror `database-schema.dbml` exactly, with `is_approved`
added on `review_comments`.

## ADDED Requirements

### Requirement: ReviewEntity

The system MUST persist reviews in the `reviews` table defined in
`openspec/specs/database-schema.dbml` (lines 39–47). The TypeORM
`ReviewEntity` MUST expose `id` (uuid), `authorName` (varchar,
default `'Anónimo'`), `authorRole` (varchar, nullable), `content`
(text, NOT NULL), `rating` (integer, NOT NULL), `isApproved`
(boolean, default `false`), and `createdAt` (timestamp). The
entity MUST NOT declare any foreign key to `projects`, any foreign
key to `users`, and any `subjectType` discriminator column.
`ReviewEntity` MUST be registered in the shared TypeORM
`AppDataSource` (`src/data-source.ts`) `entities` array AND in
`ReviewsModule.imports` via `TypeOrmModule.forFeature([...])`.

#### Scenario: ReviewEntity columns match the database schema

- GIVEN the `ReviewEntity` is loaded
- WHEN the TypeORM metadata is inspected
- THEN the entity declares `id`, `authorName`, `authorRole`,
  `content`, `rating`, `isApproved`, `createdAt`
- AND `authorName` has a DB default of `'Anónimo'`
- AND `authorRole` is nullable
- AND `content` is NOT NULL
- AND `isApproved` defaults to `false`

#### Scenario: ReviewEntity has no subject polymorphism

- GIVEN the `ReviewEntity` is loaded
- WHEN the entity's column metadata is inspected
- THEN the entity has NO `projectId` column
- AND the entity has NO `ownerUserId` column
- AND the entity has NO `subjectType` column
- AND the entity has no `ManyToOne` relation to `ProjectEntity`
- AND the entity has no `ManyToOne` relation to `UserEntity`

#### Scenario: DataSource and ReviewsModule register ReviewEntity

- GIVEN `src/data-source.ts` is loaded
- WHEN the `entities` array of `AppDataSource` is inspected
- THEN it includes `ReviewEntity`
- AND `ReviewsModule.imports` includes
  `TypeOrmModule.forFeature([ReviewEntity, ReviewCommentEntity])`

### Requirement: ReviewCommentEntity

The system MUST persist review comments in the `review_comments`
table defined in `openspec/specs/database-schema.dbml` (lines
49–55) PLUS an `is_approved` boolean column added by this change.
The TypeORM `ReviewCommentEntity` MUST expose `id` (uuid),
`reviewId` (uuid FK → `reviews.id` with `onDelete: 'CASCADE'`),
`authorName` (varchar, default `'Anónimo'`), `content` (text, NOT
NULL), `isApproved` (boolean, default `false`), and `createdAt`
(timestamp). The entity MUST declare a many-to-one relation to
`ReviewEntity` keyed on `reviewId`, and the FK MUST be configured
with `onDelete: 'CASCADE'` so that
`DELETE /api/v1/admin/reviews/:id` removes child comments
atomically at the database level. `ReviewCommentEntity` MUST be
registered in the shared `AppDataSource` `entities` array AND in
`ReviewsModule.imports` via `TypeOrmModule.forFeature([...])`.

#### Scenario: ReviewCommentEntity columns match the schema plus isApproved

- GIVEN the `ReviewCommentEntity` is loaded
- WHEN the TypeORM metadata is inspected
- THEN the entity declares `id`, `reviewId`, `authorName`,
  `content`, `isApproved`, `createdAt`
- AND `authorName` has a DB default of `'Anónimo'`
- AND `content` is NOT NULL
- AND `isApproved` defaults to `false`

#### Scenario: ReviewCommentEntity FK is ON DELETE CASCADE

- GIVEN the `ReviewCommentEntity` is loaded
- WHEN the relation metadata is inspected
- THEN the many-to-one relation to `ReviewEntity` is keyed on
  `reviewId`
- AND the FK is configured with `onDelete: 'CASCADE'`
- AND there is NO manual `delete({ reviewId })` call in the
  service surface for child removal (the DB does the cascade)

### Requirement: Submit Review (Public)

The system MUST expose `POST /api/v1/reviews` (Public — no auth
required). The request body MUST be validated by the global
`ValidationPipe` (per `api-bootstrap` Requirement: Global
Validation Pipe) against a `CreateReviewDto` that declares:
`authorName` (string, optional, max length `100`), `authorRole`
(string, optional, max length `120`), `content` (string, required,
min length `10`, max length `2000`), and `rating` (integer,
required, min `1`, max `5`). The DTO MUST NOT declare `projectId`,
`ownerUserId`, or `subjectType` (the DTO is the canonical proof
of the "no polymorphism" locked decision). On success the
response MUST be `201 Created` with body
`{ id, authorName, authorRole, content, rating, isApproved: false,
createdAt }`. The persisted row MUST have `is_approved = false`
regardless of body contents. The endpoint MUST carry a per-route
`@Throttle()` decorator per `reviews-throttling` Requirement:
Per-Route Throttle Limits.

#### Scenario: Valid public submission persists with isApproved=false

- GIVEN no review exists for the visitor
- WHEN a client sends `POST /api/v1/reviews` with body
  `{ "content": "Great work on the dashboard redesign", "rating": 5,
     "authorName": "Maria", "authorRole": "PM" }`
- THEN the response is `201 Created`
- AND the body contains the new review with `isApproved: false`
- AND a row is inserted in `reviews` with `is_approved = false`

#### Scenario: Missing content returns 400

- GIVEN the global `ValidationPipe` is configured with
  `whitelist: true` and `forbidNonWhitelisted: true`
- WHEN a client sends `POST /api/v1/reviews` with body
  `{ "rating": 5 }` (no `content`)
- THEN the response is `400 Bad Request` (canonical envelope)
- AND the controller method is not invoked
- AND no row is inserted in `reviews`

#### Scenario: rating outside 1..5 returns 400

- GIVEN the global `ValidationPipe` is configured
- WHEN a client sends `POST /api/v1/reviews` with body
  `{ "content": "valid content here", "rating": 6 }`
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked
- AND no row is inserted in `reviews`

#### Scenario: Unknown body field returns 400 (forbidNonWhitelisted)

- GIVEN the global `ValidationPipe` is configured with
  `forbidNonWhitelisted: true`
- WHEN a client sends `POST /api/v1/reviews` with body containing
  a field not declared on `CreateReviewDto` (e.g. `{ ..., "isAdmin": true }`)
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked
- AND no row is inserted in `reviews`

#### Scenario: authorName defaults to 'Anónimo' when omitted

- GIVEN the global `ValidationPipe` is configured
- WHEN a client sends `POST /api/v1/reviews` with body
  `{ "content": "valid content here", "rating": 4 }` (no `authorName`)
- THEN the response is `201 Created`
- AND the persisted row has `author_name = 'Anónimo'`

#### Scenario: Throttled request returns 429

- GIVEN the throttler limit is `5` requests per `60_000` ms per IP
- WHEN a client sends the 6th `POST /api/v1/reviews` from the
  same IP inside the 60-second window
- THEN the response is `429 Too Many Requests` with the canonical
  envelope and a `Retry-After` header (per
  `reviews-throttling` Requirement: Throttle Response Shape)
- AND no row is inserted in `reviews`

### Requirement: List Approved Reviews (Public)

The system MUST expose `GET /api/v1/reviews` (Public, no auth
required). On success the response MUST be `200 OK` with a JSON
envelope of the shape
`{ data: Review[], total: number, page: number, pageSize: number }`.
The list MUST be filtered to `is_approved = true` only — unapproved
reviews MUST NOT appear in `data`. The endpoint MUST support three
query parameters in this slice: `page` (integer ≥ 1, default
`1`), `pageSize` (integer ≥ 1, default `20`, capped at `100`),
and `rating` (integer 1–5, optional, no default). `pageSize > 100`
MUST be silently capped at `100` (NOT rejected with 400). The
endpoint MUST carry a per-route `@Throttle()` decorator per
`reviews-throttling` Requirement: Per-Route Throttle Limits.

#### Scenario: Default list returns only approved reviews

- GIVEN the `reviews` table contains a mix of approved and
  unapproved reviews
- WHEN a client sends `GET /api/v1/reviews` with no query params
- THEN the response is `200 OK`
- AND the body shape is
  `{ data: Review[], total: <count>, page: 1, pageSize: 20 }`
- AND `data` contains ONLY reviews with `isApproved = true`
- AND `total` equals the count of `data` rows

#### Scenario: rating filter restricts the list

- GIVEN the `reviews` table contains approved reviews with
  `rating = 5`, `rating = 3`, and `rating = 5`
- WHEN a client sends `GET /api/v1/reviews?rating=5`
- THEN the response is `200 OK`
- AND `data` contains ONLY reviews with `rating = 5`
- AND `total` equals the count of `data` rows

#### Scenario: Pagination with page and pageSize

- GIVEN the `reviews` table contains 25 approved reviews
- WHEN a client sends `GET /api/v1/reviews?page=2&pageSize=10`
- THEN the response is `200 OK`
- AND `data` contains 10 reviews
- AND `page = 2` and `pageSize = 10` and `total = 25`

#### Scenario: pageSize is silently capped at 100

- GIVEN the `reviews` table contains at least 200 approved reviews
- WHEN a client sends `GET /api/v1/reviews?pageSize=500`
- THEN the response is `200 OK`
- AND `pageSize = 100` (silently capped, NOT rejected with 400)
- AND `data` contains at most 100 reviews

#### Scenario: page below 1 returns 400

- GIVEN the global `ValidationPipe` is configured
- WHEN a client sends `GET /api/v1/reviews?page=0`
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked

### Requirement: List All Reviews For Admin (Protected)

The system MUST expose `GET /api/v1/admin/reviews` (Protected —
requires a valid `Authorization: Bearer ...` access token per the
`auth-domain` Requirement: JwtAuthGuard). On success the response
MUST be `200 OK` with the same envelope shape
`{ data: Review[], total: number, page: number, pageSize: number }`.
The list MUST default to ALL reviews (both `is_approved = true`
and `is_approved = false`) and MUST support the
`?isApproved=true|false` query param to filter the queue. The
endpoint MUST support `page`, `pageSize` (same caps and defaults
as the public list), and `rating` (integer 1–5) query params. The
endpoint MUST carry `@UseGuards(JwtAuthGuard)` and
`@ApiBearerAuth()` and MUST NOT carry any `@Throttle()` decorator
(admin routes are unthrottled per `reviews-throttling`
Requirement: Per-Route Throttle Limits).

#### Scenario: Bearer-authenticated admin sees all reviews

- GIVEN a valid `Authorization: Bearer <access>` is presented
- AND the `reviews` table contains both approved and unapproved
  reviews
- WHEN a client sends `GET /api/v1/admin/reviews`
- THEN the response is `200 OK`
- AND `data` contains BOTH approved and unapproved reviews
- AND `total` equals the count of all rows in `reviews`

#### Scenario: Admin filters by isApproved=true

- GIVEN a valid bearer is presented
- AND the `reviews` table contains both approved and unapproved
  reviews
- WHEN a client sends `GET /api/v1/admin/reviews?isApproved=true`
- THEN the response is `200 OK`
- AND `data` contains ONLY reviews with `isApproved = true`

#### Scenario: Missing bearer returns 401

- GIVEN no `Authorization` header is sent
- WHEN a client sends `GET /api/v1/admin/reviews`
- THEN the response is `401 Unauthorized` (canonical envelope)
- AND the controller method is not invoked
- AND no review is read from the database

#### Scenario: Invalid bearer returns 401

- GIVEN an access token whose signature does not verify against
  `JWT_SECRET` (or which is expired)
- WHEN a client sends `GET /api/v1/admin/reviews` with that bearer
- THEN the response is `401 Unauthorized`
- AND the controller method is not invoked

### Requirement: Toggle Review Approval (Protected)

The system MUST expose `PATCH /api/v1/admin/reviews/:id/approve`
(Protected — requires a valid bearer per the `auth-domain`
Requirement: JwtAuthGuard). The `:id` parameter MUST be a uuid
parsed by `ParseUUIDPipe` (the scaffold's `+id` numeric coercion
is removed). On success the response MUST be `200 OK` with the
updated review body. The endpoint MUST read the current value of
`is_approved`, flip it (`true → false`, `false → true`), and
persist the change atomically. The endpoint MUST respond `404 Not
Found` when no review matches the `:id`. The endpoint MUST
respond `400 Bad Request` when the `:id` is not a valid uuid. The
endpoint MUST carry `@UseGuards(JwtAuthGuard)`, `@ApiBearerAuth()`,
and MUST NOT carry any `@Throttle()` decorator.

#### Scenario: Bearer + valid uuid flips isApproved from false to true

- GIVEN a valid bearer is presented
- AND a review exists with `id = R` and `isApproved = false`
- WHEN a client sends `PATCH /api/v1/admin/reviews/R/approve`
- THEN the response is `200 OK`
- AND the body contains the same review with `isApproved = true`
- AND the row in `reviews` has `is_approved = true`

#### Scenario: Toggling twice is idempotent (returns to original)

- GIVEN a valid bearer is presented
- AND a review exists with `id = R` and `isApproved = false`
- WHEN a client sends `PATCH /api/v1/admin/reviews/R/approve` twice
- THEN the second response is `200 OK` with `isApproved = false`
- AND the row in `reviews` has `is_approved = false`

#### Scenario: Missing bearer returns 401

- GIVEN no `Authorization` header is sent
- WHEN a client sends `PATCH /api/v1/admin/reviews/R/approve`
- THEN the response is `401 Unauthorized`
- AND the controller method is not invoked
- AND the row in `reviews` is unchanged

#### Scenario: Non-uuid id returns 400

- GIVEN a valid bearer is presented
- WHEN a client sends `PATCH /api/v1/admin/reviews/not-a-uuid/approve`
- THEN the response is `400 Bad Request` (canonical envelope)
- AND the controller method is not invoked

#### Scenario: Unknown uuid returns 404

- GIVEN a valid bearer is presented
- AND no review exists with `id = R`
- WHEN a client sends `PATCH /api/v1/admin/reviews/R/approve`
- THEN the response is `404 Not Found` (canonical envelope)
- AND no row in `reviews` is inserted or mutated

### Requirement: Add Comment To Review (Public)

The system MUST expose `POST /api/v1/reviews/:id/comments` (Public,
no auth required). The `:id` parameter MUST be a uuid parsed by
`ParseUUIDPipe`. The request body MUST be validated by the global
`ValidationPipe` against a `CreateReviewCommentDto` that declares:
`authorName` (string, optional, max length `100`) and `content`
(string, required, min length `2`, max length `1000`). On success
the response MUST be `201 Created` with body
`{ id, reviewId, authorName, content, isApproved: false, createdAt }`.
The persisted row MUST have `is_approved = false`. The endpoint
MUST respond `404 Not Found` when the parent review with `:id`
does not exist. The endpoint MUST carry a per-route `@Throttle()`
decorator per `reviews-throttling` Requirement: Per-Route Throttle
Limits.

#### Scenario: Valid comment on existing review persists with isApproved=false

- GIVEN a review exists with `id = R`
- WHEN a client sends `POST /api/v1/reviews/R/comments` with body
  `{ "content": "I agree, well done", "authorName": "Pedro" }`
- THEN the response is `201 Created`
- AND the body contains the new comment with `isApproved: false`
  and `reviewId = R`
- AND a row is inserted in `review_comments` with
  `review_id = R` and `is_approved = false`

#### Scenario: Missing parent review returns 404

- GIVEN no review exists with `id = R`
- WHEN a client sends `POST /api/v1/reviews/R/comments` with any
  valid body
- THEN the response is `404 Not Found` (canonical envelope)
- AND the controller method is not invoked
- AND no row is inserted in `review_comments`

#### Scenario: Content below 2 characters returns 400

- GIVEN a review exists with `id = R`
- AND the global `ValidationPipe` is configured
- WHEN a client sends `POST /api/v1/reviews/R/comments` with
  body `{ "content": "x" }`
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked

#### Scenario: Non-uuid id returns 400

- GIVEN the global `ValidationPipe` is configured
- WHEN a client sends `POST /api/v1/reviews/not-a-uuid/comments`
  with any body
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked

#### Scenario: Throttled request returns 429

- GIVEN the throttler limit is `5` requests per `60_000` ms per IP
- WHEN a client sends the 6th `POST /api/v1/reviews/R/comments`
  from the same IP inside the 60-second window
- THEN the response is `429 Too Many Requests` with the
  canonical envelope and a `Retry-After` header
- AND no row is inserted in `review_comments`

### Requirement: Delete Review (Protected)

The system MUST expose `DELETE /api/v1/admin/reviews/:id`
(Protected — requires a valid bearer per the `auth-domain`
Requirement: JwtAuthGuard). The `:id` parameter MUST be a uuid
parsed by `ParseUUIDPipe`. On success the response MUST be
`204 No Content` with an empty body. The hard delete MUST
cascade: every `review_comments` row whose `review_id` matches
`:id` MUST be removed in the same operation via the
`onDelete: 'CASCADE'` FK to `reviews.id` (the service does NOT
delete comments manually). The endpoint MUST respond `404 Not
Found` when no review matches the `:id`. The endpoint MUST
respond `400 Bad Request` when the `:id` is not a valid uuid. The
endpoint MUST carry `@UseGuards(JwtAuthGuard)`, `@ApiBearerAuth()`,
`@HttpCode(204)`, and MUST NOT carry any `@Throttle()` decorator.

#### Scenario: Valid bearer + known id deletes review and child comments

- GIVEN a valid bearer is presented
- AND a review exists with `id = R` and two `review_comments`
  rows linked to `R` (one approved, one unapproved)
- WHEN a client sends `DELETE /api/v1/admin/reviews/R`
- THEN the response is `204 No Content` with an empty body
- AND no row exists in `reviews` with `id = R`
- AND no row exists in `review_comments` with `review_id = R`
- AND the cascade happened at the database level (no manual
  child-delete call in the service)

#### Scenario: Missing bearer returns 401

- GIVEN no `Authorization` header is sent
- WHEN a client sends `DELETE /api/v1/admin/reviews/R`
- THEN the response is `401 Unauthorized`
- AND the review and its child comments are unchanged

#### Scenario: Unknown uuid returns 404

- GIVEN a valid bearer is presented
- AND no review exists with `id = R`
- WHEN a client sends `DELETE /api/v1/admin/reviews/R`
- THEN the response is `404 Not Found` (canonical envelope)
- AND no row in `reviews` or `review_comments` is mutated

### Requirement: List Approved Comments For Review (Public)

The system MUST expose `GET /api/v1/reviews/:id/comments` (Public,
no auth required). The `:id` parameter MUST be a uuid parsed by
`ParseUUIDPipe`. On success the response MUST be `200 OK` with a
JSON envelope of the shape
`{ data: ReviewComment[], total: number, page: number, pageSize: number }`.
The list MUST be filtered to `is_approved = true` only — pending
comments MUST NOT appear in `data`. The endpoint MUST support two
query parameters: `page` (integer ≥ 1, default `1`) and `pageSize`
(integer ≥ 1, default `20`, capped at `100`). `pageSize > 100`
MUST be silently capped at `100`. The endpoint MUST apply the
existence-leak guard on the parent review (per Requirement: 404
Existence-Leak Guard On Public Reads) — it MUST respond `404 Not
Found` when the parent review with `:id` does not exist OR exists
but has `is_approved = false`. The endpoint MUST carry a per-route
`@Throttle()` decorator per `reviews-throttling` Requirement:
Per-Route Throttle Limits.

#### Scenario: Default list returns only approved comments for an approved parent

- GIVEN a review exists with `id = R` and `isApproved = true`
- AND the `review_comments` table contains two approved and one
  unapproved comments linked to `R`
- WHEN a client sends `GET /api/v1/reviews/R/comments` with no
  query params
- THEN the response is `200 OK`
- AND the body shape is
  `{ data: ReviewComment[], total: 2, page: 1, pageSize: 20 }`
- AND `data` contains ONLY the two approved comments

#### Scenario: Empty approved list returns 200 with empty data

- GIVEN a review exists with `id = R` and `isApproved = true`
- AND the `review_comments` table contains zero approved
  comments linked to `R`
- WHEN a client sends `GET /api/v1/reviews/R/comments`
- THEN the response is `200 OK`
- AND `data = []`, `total = 0`, `page = 1`, `pageSize = 20`

#### Scenario: Non-uuid id returns 400

- GIVEN the global `ValidationPipe` is configured
- WHEN a client sends `GET /api/v1/reviews/not-a-uuid/comments`
- THEN the response is `400 Bad Request`
- AND the controller method is not invoked

### Requirement: Pagination Envelope

The system MUST shape every paginated list response (the public
review list, the admin review list, the public comment list) as
`{ data: T[], total: number, page: number, pageSize: number }` —
the canonical envelope inherited from the `projects-domain`
capability spec (`openspec/specs/projects-domain/spec.md`
Requirement: Public Project List). `page` MUST default to `1` and
MUST be ≥ 1. `pageSize` MUST default to `20` and MUST be ≥ 1;
`pageSize > 100` MUST be silently capped at `100` (NOT rejected
with 400). `total` MUST equal the count of rows that matched the
filter, BEFORE pagination is applied.

#### Scenario: Envelope shape is consistent across public and admin lists

- GIVEN the `reviews` table contains reviews
- WHEN a client sends `GET /api/v1/reviews`
- AND a client sends `GET /api/v1/admin/reviews` (with a valid bearer)
- THEN both responses use the envelope
  `{ data, total, page, pageSize }`
- AND the field names are identical (camelCase, no abbreviations)

#### Scenario: pageSize > 100 is silently capped, not rejected

- GIVEN the `reviews` table contains at least 200 approved reviews
- WHEN a client sends `GET /api/v1/reviews?pageSize=500`
- THEN the response is `200 OK`
- AND `pageSize = 100` (NOT `400 Bad Request`)

### Requirement: Validation Error Format

The system MUST render every 4xx response (including 400 from the
global `ValidationPipe`, 404 from the service, 429 from the
throttler) through the global `AllExceptionsFilter` registered in
`main.ts` (per the `global-exception-filter` capability spec at
`openspec/specs/global-exception-filter/spec.md` Requirement:
HttpException Renders the Canonical 4xx Envelope). The body shape
MUST be
`{ statusCode, error, message, timestamp, path }` — the canonical
envelope. For 400 from `ValidationPipe`, `message` MUST be the
`class-validator` string-array of violation messages. This
requirement is INHERITED — the filter is already wired;
reviews-domain reuses it without modification.

#### Scenario: 400 from ValidationPipe renders through the filter

- GIVEN the global `ValidationPipe` is configured with
  `whitelist: true` and `forbidNonWhitelisted: true`
- WHEN a client sends `POST /api/v1/reviews` with body missing
  `content`
- THEN the response is `400 Bad Request`
- AND the body shape is the canonical envelope
- AND `message` is an array of `class-validator` violation
  strings

#### Scenario: 404 from NotFoundException renders through the filter

- GIVEN a service throws `new NotFoundException('Review not found')`
- WHEN a client triggers that code path
- THEN the response is `404 Not Found`
- AND the body shape is the canonical envelope
- AND `message = 'Review not found'`
- AND the body contains no stack trace and no extra fields

### Requirement: 404 Existence-Leak Guard On Public Reads

The system MUST respond `404 Not Found` (not `200 OK` with `null`
or with an empty body) on every public read endpoint when the
target resource either (a) does not exist or (b) exists but is
not approved. The 404 body MUST NOT distinguish between the two
cases — anonymous callers MUST NOT be able to detect the
existence of unapproved reviews or comments by probing UUIDs. The
concrete application of this guard is: the public comments list
(`GET /api/v1/reviews/:id/comments`) MUST 404 when the parent
review is missing OR `is_approved = false`. The public review
list (`GET /api/v1/reviews`) and the public comment list
(`GET /api/v1/reviews/:id/comments`) MUST NOT return unapproved
rows in `data`. The toggle endpoint
(`PATCH /api/v1/admin/reviews/:id/approve`) and the delete
endpoint (`DELETE /api/v1/admin/reviews/:id`) are admin-only and
MAY distinguish "missing" from "exists but unapproved" by 404-ing
only on truly missing rows.

#### Scenario: Public comments list 404s on missing parent

- GIVEN no review exists with `id = R`
- WHEN a client sends `GET /api/v1/reviews/R/comments`
- THEN the response is `404 Not Found` (canonical envelope)
- AND the body does NOT distinguish this 404 from the
  "exists but unapproved" 404

#### Scenario: Public comments list 404s on unapproved parent (no existence leak)

- GIVEN a review exists with `id = R` and `isApproved = false`
- WHEN a client sends `GET /api/v1/reviews/R/comments`
- THEN the response is `404 Not Found` (canonical envelope)
- AND the body shape is identical to the "missing parent" 404
  body
- AND no field in the body reveals that the review exists

#### Scenario: Public review list omits unapproved rows

- GIVEN the `reviews` table contains both approved and unapproved
  reviews
- WHEN a client sends `GET /api/v1/reviews`
- THEN `data` contains ONLY approved reviews
- AND `total` reflects the approved-only count

#### Scenario: Admin toggle 404s only on truly missing rows

- GIVEN a valid bearer is presented
- AND a review exists with `id = R` and `isApproved = false`
- WHEN a client sends `PATCH /api/v1/admin/reviews/R/approve`
- THEN the response is `200 OK` (the unapproved row IS
  addressable for the admin; the existence-leak guard does not
  apply)

## MODIFIED Requirements

_None. No existing requirements in `openspec/specs/server_specs.md`,
`openspec/specs/api-bootstrap/spec.md`,
`openspec/specs/global-exception-filter/spec.md`, or
`openspec/specs/auth-domain/spec.md` are modified by this change.
The `reviews-domain` capability is fully self-contained: it
inherits the global prefix, the global `ValidationPipe`, the
canonical 4xx/5xx envelope, and the method-level `JwtAuthGuard`
contract, and adds a new domain surface on top. The DBML gains
an `is_approved` column on `review_comments` at archive time per
the projects-crud precedent — the schema change is implemented
in the hand-written migration that lands in `apply`, not in the
`database-schema.dbml` doc file._

## REMOVED Requirements

_None._
