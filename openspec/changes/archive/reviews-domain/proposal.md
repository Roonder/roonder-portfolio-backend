# Proposal: Reviews Domain

## Change

| Field | Value |
| --- | --- |
| Change name | `reviews-domain` |
| Branch | `domains/reviews` (current; trunk-based commit-range) |
| Commit strategy (user-locked) | ONE commit per file / spec / service / functionality completed. ZERO small-progress commits. |
| Delivery strategy | Trunk-based commit-range on `domains/reviews`; no PRs, no work branches, `apply-progress` markers track progression. |
| Strict TDD | Active. Runner: `npm test` (Jest 30 + ts-jest). Specs (next phase) MUST map 1:1 to `*.spec.ts` scenarios. |
| Review budget | 400 LOC soft cap, 800+ needs explicit maintainer exception. |

## Intent

`src/reviews/` is the NestJS scaffold stub: a 5-route `ReviewsController` with no
`@UseGuards(JwtAuthGuard)`, no admin split, no Swagger, no
`@nestjs/throttler`, a `+id` numeric coercion on a uuid param, a 1-line
`CreateReviewDto`, a `Review` entity class with no columns, and a `ReviewsService`
that returns string placeholders. `server_specs.md` §3.3 mandates 6 routes
(3 public, 3 protected) and `database-schema.dbml` defines the `reviews` and
`review_comments` tables. `src/main.ts` already registers no rate limiter, so
the public `POST /api/v1/reviews` is open to untrusted traffic. This change
lands the Reviews domain on the auth-domain and projects-domain foundations,
adds `@nestjs/throttler` protection on the two public write endpoints, and
ships the hand-written migration that creates the two tables (with `is_approved`
on comments and `ON DELETE CASCADE` on `review_comments.review_id`). Read
endpoints stay public; create/comment/toggle/delete are protected where §3.3
requires it.

## Scope

### In Scope

- `ReviewEntity` (7 columns mirroring DBML) + `ReviewCommentEntity` (4 DBML
  columns + `is_approved`) matching `database-schema.dbml`. Both registered
  in `src/data-source.ts` `entities` array AND in `ReviewsModule.imports`
  via `TypeOrmModule.forFeature([...])`.
- Hand-written TypeORM migration that creates the two tables, the
  `is_approved` column on `review_comments`, the `ON DELETE CASCADE` FK,
  and the recommended indexes (`is_approved` on both tables,
  `review_id` on `review_comments`). Reversible via `down()`.
- DTOs: `CreateReviewDto`, `CreateReviewCommentDto`, `ListReviewsQueryDto`,
  `ListReviewsResponseDto`, `ReviewResponseDto`, `ReviewCommentResponseDto`,
  and `ListCommentsQueryDto` (for the public comments endpoint). No
  `UpdateReviewDto` (per locked #8 — the scaffold stub is removed).
- 6 routes per `server_specs.md` §3.3: `POST /api/v1/reviews` (public,
  throttled), `GET /api/v1/reviews` (public, paginated, approved-only),
  `GET /api/v1/admin/reviews` (JWT, paginated, all), `PATCH /api/v1/admin/reviews/:id/approve`
  (JWT, toggle), `POST /api/v1/reviews/:id/comments` (public, throttled,
  404 on missing parent), `DELETE /api/v1/admin/reviews/:id` (JWT, 204,
  cascades to comments).
- 1 additional public read endpoint: `GET /api/v1/reviews/:id/comments`
  (per clarifier #7 default — gated by `is_approved=true`).
- Public list envelope `{ data, total, page, pageSize }` (locked, mirrors
  projects). Admin list uses the same envelope shape.
- `@nestjs/throttler` registered at the module level in `app.module.ts`
  with env-driven per-IP limits (default 5 / 60_000 ms on the two public
  POSTs; 60 / 60_000 ms on the two public reads). NOT registered as
  `APP_GUARD` (per-route `@Throttle()` only — see Risks).
- 3 admin routes split into a SECOND controller (`ReviewsAdminController`,
  `@Controller('admin/reviews')`) so the public surface stays at
  `@Controller('reviews')`. All 3 admin methods carry
  `@UseGuards(JwtAuthGuard) @ApiBearerAuth()` per
  `auth-domain` precedent.
- Swagger annotations (`@ApiTags('reviews')`, `@ApiOperation`,
  `@ApiBearerAuth()` on the 3 protected routes + the 1 toggle, `@ApiResponse`
  for 4xx) mirroring `src/projects/projects.controller.ts`.
- Colocated `*.spec.ts` (entity metadata, DTO validation, controller HTTP
  shape, service behavior, throttler integration) + `test/reviews.e2e-spec.ts`
  (mint a JWT for the protected cases). Strict-TDD RED-first per the
  proposal's STRICT TDD MODE contract.
- Drop the `+id` numeric coercion on `:id` path params; use
  `ParseUUIDPipe` on every uuid (mirrors the projects fix).
- `seed-reviews.ts` CLI (per clarifier #6 default — mirror
  `seed-projects.ts` with `SEED_DRY_RUN`).
- README section in `README.md` documenting the reviews endpoints table
  and the throttler behavior (the user explicitly asked for clarity so
  they can understand how it works).

### Out of Scope

- Admin moderation of comments (no `PATCH /admin/reviews/:commentId/approve`).
  The `is_approved` column lands in this change; the admin toggle is a
  follow-up. (Locked #3.)
- Editing a review after submission (`PATCH /reviews/:id` removed, no
  `PATCH /admin/reviews/:id` either). (Locked #8.)
- Reply threading on comments — flat list only, no parent/child.
- Email notification on new review (no Resend dispatch).
- Full-text search, ranking, sentiment analysis.
- Per-`author_name` rate-limit, CAPTCHA, IP capture, or any other
  anti-spam layer beyond `@nestjs/throttler`. (Locked #2.)
- GDPR retention, anonymisation, soft delete.
- Multi-language / i18n content.
- Polymorphic "subject" (no `project_id` / `owner_user_id` / `subject_type`
  on `reviews`). (Locked #1.)
- Caching (HTTP, Redis, in-memory).
- DB-level CHECK on `rating` 1..5 — DTO enforces; defense in depth
  deferred to a follow-up migration.
- DBML delta for the `is_approved` column (DBML is documentation; the
  hand-written migration is the source of truth at apply time; the DBML
  is updated in `sdd-archive` per the projects-crud precedent).

## Locked Decisions (from user)

These four are locked by the user 2026-06-19 (saved to Engram at
`architecture/reviews-domain-decisions`, observation #37). The proposal
inherits them as-is. They are NOT open questions for design or apply.

1. **Schema for "subject" — NO polymorphism.** No `project_id` FK, no
   `owner_user_id` FK, no `subject_type` discriminator on `reviews`.
   Reviews are general: the visitor MAY mention a project in free-text
   `content`, but is NOT required to. The `reviews` table is created
   exactly as the DBML describes (7 columns, no extras for subject
   linking).
2. **Anti-spam — throttler required.** Public `POST /api/v1/reviews` and
   `POST /api/v1/reviews/:id/comments` MUST be protected with
   `@nestjs/throttler` (per-IP, ~60s window — design phase confirms
   exact values; see §Anti-Spam below). DBML unchanged. New npm dep:
   `@nestjs/throttler`.
3. **Comment moderation — option (a).** `is_approved boolean [default: false]`
   on `review_comments`. Public `GET /api/v1/reviews/:id/comments` (if
   added) filters to `is_approved=true`. Admin moderation for comments
   is OUT OF SCOPE for this slice. Migration:
   `ALTER TABLE review_comments ADD COLUMN is_approved boolean NOT NULL DEFAULT false;`
4. **ON DELETE CASCADE on `review_comments.review_id`.**
   `DELETE /api/v1/admin/reviews/:id` removes child comments atomically
   via the FK. The service does NOT delete comments manually. Migration
   matches the `project_urls.project_id` precedent.

## Endpoints (from `server_specs.md` §3.3)

6 routes, all under the global `/api/v1` prefix (per `api-bootstrap`
spec). `ParseUUIDPipe` on every uuid `:id` param (the scaffold's `+id`
numeric coercion is removed).

| # | Method + path | Auth | Request body / params | Success | Error cases |
| - | --- | --- | --- | --- | --- |
| 1 | `POST /api/v1/reviews` | Public, **throttled** (5 / 60_000 ms) | `CreateReviewDto` (see §DTOs) | `201 Created` + `ReviewResponseDto` (with `isApproved: false`) | `400` (validation), `429` (throttler) |
| 2 | `GET /api/v1/reviews` | Public, throttled (60 / 60_000 ms) | `ListReviewsQueryDto` (`page?`, `pageSize?`, `rating?`) | `200 OK` + envelope `{ data, total, page, pageSize }` (only `isApproved: true`) | `400` (bad query) |
| 3 | `GET /api/v1/admin/reviews` | JwtAuthGuard + ApiBearerAuth | `ListReviewsQueryDto` extended with `isApproved?` (default: any) | `200 OK` + same envelope shape (all reviews) | `400`, `401` |
| 4 | `PATCH /api/v1/admin/reviews/:id/approve` | JwtAuthGuard + ApiBearerAuth | `:id` (uuid, `ParseUUIDPipe`) | `200 OK` + `ReviewResponseDto` with toggled `isApproved` | `400`, `401`, `404` |
| 5 | `POST /api/v1/reviews/:id/comments` | Public, **throttled** (5 / 60_000 ms) | `:id` (uuid) + `CreateReviewCommentDto` | `201 Created` + `ReviewCommentResponseDto` (with `isApproved: false`) | `400`, `404` (parent review missing), `429` |
| 6 | `DELETE /api/v1/admin/reviews/:id` | JwtAuthGuard + ApiBearerAuth | `:id` (uuid) | `204 No Content` (cascades to `review_comments`) | `400`, `401`, `404` |
| 7 (clarifier #7) | `GET /api/v1/reviews/:id/comments` | Public, throttled (60 / 60_000 ms) | `:id` (uuid) + `ListCommentsQueryDto` | `200 OK` + envelope of approved comments | `400`, `404` |

> Route #7 is the clarifier-#7 default (public read of approved comments).
> sdd-design can drop it if the user prefers comments inline with the
> review body. The default is in the table so the proposal's deliverable
> scope is concrete.

### Response shape — single review

`ReviewResponseDto` (reused by every create/list/get/toggle response):
`{ id, authorName, authorRole, content, rating, isApproved, createdAt }`.
`comments` is NOT included by default (a separate endpoint returns them;
this keeps the list endpoint payload light).

### Response shape — list envelope

`{ data: ReviewResponseDto[] | ReviewCommentResponseDto[], total, page, pageSize }`.
Same shape as the projects list. `pageSize > 100` is silently clamped to
100 (no 400). The default `pageSize` is 20. `page` defaults to 1.
`total` is the count of rows that matched the filter.

## Data Model

### `ReviewEntity` — `src/reviews/entities/review.entity.ts`

Mirrors the `reviews` table in `database-schema.dbml` (lines 39–47)
exactly. 7 columns. No FK. No discriminator.

| DBML column | TypeORM decorator | Notes |
| --- | --- | --- |
| `id uuid pk default uuid_generate_v4()` | `@PrimaryGeneratedColumn("uuid")` `id: string` | |
| `author_name varchar default 'Anónimo'` | `@Column({ name: "author_name", type: "varchar", default: () => "'Anónimo'" })` `authorName: string` | DBML default; the DTO also defaults to `'Anónimo'` at the API surface. |
| `author_role varchar` (nullable) | `@Column({ name: "author_role", type: "varchar", nullable: true })` `authorRole: string \| null` | |
| `content text not null` | `@Column({ type: "text" })` `content: string` | |
| `rating integer not null note 'Escala 1-5'` | `@Column({ type: "integer" })` `rating: number` | DTO enforces `@IsInt @Min(1) @Max(5)`. |
| `is_approved boolean default false` | `@Column({ name: "is_approved", type: "boolean", default: false })` `isApproved: boolean` | |
| `created_at timestamp default now()` | `@CreateDateColumn({ name: "created_at" })` `createdAt: Date` | No `updated_at` (DBML has none). |
| **one-to-many to `review_comments`** | `@OneToMany(() => ReviewCommentEntity, (c) => c.review) comments: ReviewCommentEntity[]` | Eager-loaded only on demand via `relations: { comments: true }`. |

### `ReviewCommentEntity` — `src/reviews/entities/review-comment.entity.ts`

Mirrors the `review_comments` table (DBML lines 49–55) PLUS the
`is_approved` column from locked #3.

| DBML column | TypeORM decorator | Notes |
| --- | --- | --- |
| `id uuid pk default uuid_generate_v4()` | `@PrimaryGeneratedColumn("uuid")` `id: string` | |
| `review_id uuid ref > reviews.id not null` | `@ManyToOne(() => ReviewEntity, (r) => r.comments, { onDelete: "CASCADE" })` `review: ReviewEntity` + `@JoinColumn({ name: "review_id" })` `reviewId: string` | FK + CASCADE per locked #4. |
| `author_name varchar default 'Anónimo'` | `@Column({ name: "author_name", type: "varchar", default: () => "'Anónimo'" })` `authorName: string` | |
| `content text not null` | `@Column({ type: "text" })` `content: string` | |
| `created_at timestamp default now()` | `@CreateDateColumn({ name: "created_at" })` `createdAt: Date` | No `updated_at` (DBML has none). |
| **`is_approved boolean default false`** (locked #3) | `@Column({ name: "is_approved", type: "boolean", default: false })` `isApproved: boolean` | NOT in DBML today. Lands in the migration; DBML is updated at archive time. |

> Per locked #1, the `ReviewEntity` has NO `project_id` / `owner_user_id` /
> `subject_type` columns. The intent of the user's intent ("reviews of
> projects or of mi persona") is satisfied by free-text `content`; no
> schema change is required.

## Migration Shape

Hand-written TypeORM migration (mirrors
`20260618205116-create-projects-and-project-urls.ts` precedent).
Registered in `src/data-source.ts` via the existing `migrations` glob.

File: `src/database/migrations/<timestamp>-create-reviews-and-review-comments.ts`.

```sql
-- up()
CREATE TABLE "reviews" (
    "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
    "author_name"   varchar NOT NULL DEFAULT 'Anónimo',
    "author_role"   varchar,
    "content"       text NOT NULL,
    "rating"        integer NOT NULL,
    "is_approved"   boolean NOT NULL DEFAULT false,
    "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT "PK_reviews" PRIMARY KEY ("id")
);

CREATE TABLE "review_comments" (
    "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
    "review_id"     uuid NOT NULL,
    "author_name"   varchar NOT NULL DEFAULT 'Anónimo',
    "content"       text NOT NULL,
    "is_approved"   boolean NOT NULL DEFAULT false,  -- locked #3
    "created_at"    TIMESTAMP NOT NULL DEFAULT now(),
    CONSTRAINT "PK_review_comments" PRIMARY KEY ("id"),
    CONSTRAINT "FK_review_comments_review"
        FOREIGN KEY ("review_id")
        REFERENCES "reviews"("id")
        ON DELETE CASCADE                            -- locked #4
);

-- Indexes (per explore §DBML gap):
CREATE INDEX "idx_reviews_is_approved"        ON "reviews"       ("is_approved");
CREATE INDEX "idx_review_comments_review_id"  ON "review_comments" ("review_id");
CREATE INDEX "idx_review_comments_is_approved" ON "review_comments" ("is_approved");
```

`down()` drops in reverse order (indexes first, then `review_comments`,
then `reviews`).

The migration file uses the same comment-block header as the projects
migration documenting the "no live Postgres in this env" caveat and the
docker verification recipe.

> **Risk note**: the `is_approved` migration is NOT idempotent — a re-run
> will fail on `ADD COLUMN`. design will document the strategy (a guard
> query in `up()` or an `IF NOT EXISTS` clause; the latter is preferred
> because Postgres 9.6+ supports it for `ADD COLUMN`).

## DTOs

All under `src/reviews/dto/`. `@ApiProperty` on every field (Swagger).
Mirror the projects-crud conventions: `@IsOptional()` on optional fields,
`@MaxLength(...)` on free-text fields, query DTOs use `@Type(() => Number)`
per `bootstrap-api-config` ADR-2 (which is what
`src/projects/dto/list-projects-query.dto.ts` does).

### `CreateReviewDto` — replaces stub `create-review.dto.ts`

| Field | Type | Decorators | Required | Notes |
| --- | --- | --- | --- | --- |
| `authorName` | `string` | `@IsString @IsOptional @MaxLength(100)` | | DBML default `'Anónimo'` kicks in when the service omits. |
| `authorRole` | `string` | `@IsString @IsOptional @MaxLength(120)` | | Free text; documented PII risk in Risks. |
| `content` | `string` | `@IsString @MinLength(10) @MaxLength(2_000)` | ✓ | 2 KB cap; justification in §Risks. |
| `rating` | `number` | `@IsInt @Min(1) @Max(5)` | ✓ | 1–5 inclusive. |

> Per locked #1, NO `projectId` / `ownerUserId` / `subjectType` field.
> The DTO is the canonical proof of the "no polymorphism" decision.

### `CreateReviewCommentDto` — new

| Field | Type | Decorators | Required | Notes |
| --- | --- | --- | --- | --- |
| `authorName` | `string` | `@IsString @IsOptional @MaxLength(100)` | | |
| `content` | `string` | `@IsString @MinLength(2) @MaxLength(1_000)` | ✓ | Shorter than review body. |

### `ListReviewsQueryDto` — new

| Field | Type | Decorators | Default | Notes |
| --- | --- | --- | --- | --- |
| `page` | `number` | `@IsOptional @Type(() => Number) @IsInt @Min(1)` | `1` | |
| `pageSize` | `number` | `@IsOptional @Type(() => Number) @IsInt @Min(1) @Max(100)` | `20` | Capped silently at 100 by service. |
| `rating` | `number` | `@IsOptional @Type(() => Number) @IsInt @Min(1) @Max(5)` | — | Optional filter for the public list. |
| `isApproved` | `boolean` | `@IsOptional @Type(() => Boolean) @IsBoolean` | — | Admin-only; service ignores on public list, defaults to `true` there. |

### `ListCommentsQueryDto` — new

| Field | Type | Decorators | Default | Notes |
| --- | --- | --- | --- | --- |
| `page` | `number` | `@IsOptional @Type(() => Number) @IsInt @Min(1)` | `1` | |
| `pageSize` | `number` | `@IsOptional @Type(() => Number) @IsInt @Min(1) @Max(100)` | `20` | Capped silently at 100. |

### `ReviewResponseDto` — new

Plain class with `@ApiProperty`. `class-transformer`'s
`excludeExtraneousValues: true` keeps the response shape locked.
Single object shape reused by create / list / get / toggle responses.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` (uuid) | |
| `authorName` | `string` | |
| `authorRole` | `string \| null` | |
| `content` | `string` | |
| `rating` | `number` | 1–5. |
| `isApproved` | `boolean` | |
| `createdAt` | `string` (ISO-8601) | |

### `ReviewCommentResponseDto` — new

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | |
| `reviewId` | `string` | |
| `authorName` | `string` | |
| `content` | `string` | |
| `isApproved` | `boolean` | Public responses only carry `isApproved: true` rows. |
| `createdAt` | `string` | |

### `ListReviewsResponseDto` + `ListCommentsResponseDto` — new

```ts
interface ListReviewsResponseDto { data: ReviewResponseDto[]; total: number; page: number; pageSize: number; }
interface ListCommentsResponseDto { data: ReviewCommentResponseDto[]; total: number; page: number; pageSize: number; }
```

Mirrors `src/projects/dto/list-projects-response.dto.ts` shape and
`@ApiProperty` annotations.

> **No `UpdateReviewDto`** — per clarifier #8 default, the scaffold stub
> `update-review.dto.ts` is deleted. §3.3 has no edit endpoint.

## Service Surface

`ReviewsService` (`src/reviews/reviews.service.ts`) — the methods below
are the only public surface. No transactions needed (no DIFF, no
cascading writes — Postgres `ON DELETE CASCADE` handles the cascade on
`DELETE`). No `withRetry` wrapper either (the projects DIFF + slug race
is reviews-irrelevant; the only "concurrent" path is the throttler,
which is per-route, not in the service).

```ts
@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(ReviewEntity)        private readonly reviews: Repository<ReviewEntity>,
    @InjectRepository(ReviewCommentEntity) private readonly comments: Repository<ReviewCommentEntity>,
  ) {}

  // Public reads
  findAllApproved(query: ListReviewsQueryDto): Promise<ListReviewsResult>;
  findOneApprovedById(id: string): Promise<ReviewResponseDto>;     // 404 on missing OR unapproved (existence-leak guard)
  findApprovedCommentsByReviewId(reviewId: string, query: ListCommentsQueryDto): Promise<ListCommentsResult>;

  // Public writes (validated by the global pipe; throttled per-route)
  create(dto: CreateReviewDto): Promise<ReviewResponseDto>;          // isApproved = false; no subject linkage
  addComment(reviewId: string, dto: CreateReviewCommentDto): Promise<ReviewCommentResponseDto>;  // 404 if parent missing; isApproved = false

  // Admin
  findAllForAdmin(query: ListReviewsQueryDto): Promise<ListReviewsResult>;  // includes unapproved; optional isApproved? filter
  toggleApproval(id: string): Promise<ReviewResponseDto>;          // 404 on missing
  remove(id: string): Promise<void>;                                // 204; FK CASCADE removes comments
}
```

### Responsibilities (one-line each)

- `create` — insert a new `ReviewEntity` with `isApproved: false`. No
  subject linkage (locked #1). No transaction.
- `findAllApproved` — query the `reviews` table with `isApproved: true`
  default; filter by `?rating=` if supplied. Envelope shape.
  `pageSize > 100` silently clamped to 100 (no 400).
- `findOneApprovedById` — 404 for both "missing" and "exists but
  unapproved" (mirror the projects `findOneBySlug` existence-leak
  guard). This is a NEW public surface, not in §3.3; it is needed by
  the throttler + UX flow. **If design disagrees it is the FIRST route
  to drop.**
- `findApprovedCommentsByReviewId` — return the approved comments for
  a review (gated by `isApproved: true`, locked #3). 404 if the parent
  review is missing OR unapproved (same existence-leak guard).
- `addComment` — insert a `ReviewCommentEntity`; 404 if the parent
  review is missing. `isApproved: false` (locked #3, no admin
  moderation in this slice).
- `findAllForAdmin` — same envelope shape; default returns ALL reviews
  (approved + pending); `?isApproved=true|false` filters; `?rating=`
  supported.
- `toggleApproval` — read current `isApproved`, flip, save. Returns the
  updated review. Idempotent (called twice = same as called zero times).
- `remove` — `this.reviews.delete({ id })`. The `ON DELETE CASCADE` on
  `review_comments.review_id` removes child comments atomically
  (locked #4). 404 if the row is missing.

## Controller Surface

TWO controllers under `src/reviews/`:

### `ReviewsController` (`@Controller('reviews')`) — public surface

5 routes (3 public writes, 2 public reads), all throttled per the
values table above.

| Route | Method | Decorators | Throttler |
| --- | --- | --- | --- |
| `POST /api/v1/reviews` | create | `@ApiOperation`, `@ApiResponse(201)`, `@ApiResponse(400)`, `@ApiResponse(429)` | `@Throttle({ default: { limit: 5, ttl: 60_000 }})` |
| `GET /api/v1/reviews` | findAllApproved | `@ApiOperation`, `@ApiQuery` for `page`/`pageSize`/`rating`, `@ApiResponse(200, type: ListReviewsResponseDto)`, `@ApiResponse(400)` | `@Throttle({ default: { limit: 60, ttl: 60_000 }})` |
| `POST /api/v1/reviews/:id/comments` | addComment | `@ApiResponse(201)`, `@ApiResponse(400)`, `@ApiResponse(404)`, `@ApiResponse(429)` | `@Throttle({ default: { limit: 5, ttl: 60_000 }})` |
| `GET /api/v1/reviews/:id/comments` | findApprovedCommentsByReviewId | `@ApiResponse(200, type: ListCommentsResponseDto)`, `@ApiResponse(404)` | `@Throttle({ default: { limit: 60, ttl: 60_000 }})` |

> **The `findOneApprovedById` route is deferred to design** — it is
> needed if a future UX wants a single review by id, but §3.3 does not
> mandate it. The proposal mentions it on the service surface because
> the throttler + existence-leak guard are tested there; the
> controller route is added only if design confirms.

### `ReviewsAdminController` (`@Controller('admin/reviews')`) — protected surface

3 routes. All carry `@UseGuards(JwtAuthGuard) @ApiBearerAuth()` per
`auth-domain` precedent. NO throttler on admin routes (the JWT is
the gate; no need for IP-based throttling).

| Route | Method | Decorators |
| --- | --- | --- |
| `GET /api/v1/admin/reviews` | findAllForAdmin | `@ApiBearerAuth`, `@ApiQuery` for `page`/`pageSize`/`rating`/`isApproved`, `@ApiResponse(200)`, `@ApiResponse(401)` |
| `PATCH /api/v1/admin/reviews/:id/approve` | toggleApproval | `@ApiBearerAuth`, `@ApiResponse(200)`, `@ApiResponse(401)`, `@ApiResponse(404)` |
| `DELETE /api/v1/admin/reviews/:id` | remove | `@ApiBearerAuth`, `@HttpCode(204)`, `@ApiResponse(204)`, `@ApiResponse(401)`, `@ApiResponse(404)` |

> The two-controller split mirrors the path convention in §3.3. The
> projects domain has only ONE controller because §3.2 does not split
> `/admin/projects/...`; the reviews domain does. Both controllers
> share `ReviewsService` via DI.

`@ApiTags('reviews')` is on BOTH controllers (so the Swagger UI groups
them under one tag). `ParseUUIDPipe` on every `:id` path param (no
`+id` numeric coercion).

## Anti-Spam (locked #2 — throttler)

The user explicitly asked for throttler protection to be WELL
DOCUMENTED. This section is the canonical place for that documentation;
the README will mirror it.

### What gets throttled

| Route | Default limit | Window | Why |
| --- | --- | --- | --- |
| `POST /api/v1/reviews` | `5` | `60_000` ms (60 s) | Public write; abuse risk = spam reviews. |
| `POST /api/v1/reviews/:id/comments` | `5` | `60_000` ms (60 s) | Public write; abuse risk = spam comments. |
| `GET /api/v1/reviews` | `60` | `60_000` ms (60 s) | Public read; lower priority but still rate-limited to prevent scrapers. |
| `GET /api/v1/reviews/:id/comments` | `60` | `60_000` ms (60 s) | Public read; same. |
| All 3 admin routes | **unthrottled** | — | JWT is the gate. Adding throttler to admin would be a denial-of-service vector against the single admin. |

### How it works

`@nestjs/throttler` is registered ONCE in `src/app.module.ts` as a
global module (NOT as `APP_GUARD` — see Risks #6). The
`ThrottlerModule.forRoot([...])` call returns a list of named
"trackers" (the `default` name is the convention). Per-route
`@Throttle({ default: { limit: 5, ttl: 60_000 }})` overrides the
default; routes without `@Throttle()` use the module-level default.

The tracker is per-IP. The IP is sourced from `req.ip` (Express)
which by default honours the `X-Forwarded-For` header ONLY when
`trust proxy` is set on the app. The `main.ts` bootstrap does NOT
currently set `app.set('trust proxy', ...)` — the design phase MUST
add this with the documented trade-off (see Risks #1).

When a route is throttled, the throttler throws
`ThrottlerException`, which renders through the global
`AllExceptionsFilter` as `429 Too Many Requests` with the canonical
envelope `{ statusCode: 429, error: "Too Many Requests", message: "ThrottlerException: Too Many Requests", timestamp, path }`.

The `Retry-After` header is set automatically by `@nestjs/throttler`
on the `429` response — clients can read it to back off correctly.

### Env-driven overrides

The `60_000` (window) and `5` / `60` (limits) are defaults; design
must add three new env vars to the Joi schema so they can be tuned
per environment:

| Env var | Default | Joi validation |
| --- | --- | --- |
| `REVIEWS_THROTTLE_TTL_MS` | `60_000` | `Joi.number().integer().min(1_000).default(60_000)` |
| `REVIEWS_THROTTLE_WRITE_LIMIT` | `5` | `Joi.number().integer().min(1).default(5)` |
| `REVIEWS_THROTTLE_READ_LIMIT` | `60` | `Joi.number().integer().min(1).default(60)` |

The throttler is configured via `ConfigService.get(...)` inside
`ThrottlerModule.forRootAsync({ inject: [ConfigService], useFactory: ... })`
so the values are read at boot, validated by Joi, and applied
uniformly across processes. **This is the only way to make the
throttler safe in dev vs. prod** — a hard-coded `5 / 60_000` would
break the test suite which hammers the public POSTs in e2e.

### What is NOT protected

- The 3 admin routes (JWT is the gate; per-IP throttling on the admin
  IP is meaningless for a single admin).
- The public existence-leak guards (`findOneApprovedById`,
  `findApprovedCommentsByReviewId`) — reads are cheap, the public
  read throttle covers them.
- Anti-bot (CAPTCHA, IP capture, `author_email` capture, etc.) — out
  of scope. If the admin queue shows a bot pattern, the throttler
  limit is the first knob to turn.

### How the user can change the limits

Three env vars, three places: `.env` (dev), deployment env (prod),
and test setup (`test/reviews.e2e-spec.ts` overrides them with
"unlimited" — `limit: 1_000_000` — so the e2e suite is not gated by
the throttler). The README documents each var and the default. The
admin can also disable the throttler entirely by setting
`REVIEWS_THROTTLE_WRITE_LIMIT=1000000` and
`REVIEWS_THROTTLE_READ_LIMIT=1000000`.

## Module Wiring

### `ReviewsModule` (`src/reviews/reviews.module.ts`)

```ts
@Module({
  imports: [TypeOrmModule.forFeature([ReviewEntity, ReviewCommentEntity])],
  controllers: [ReviewsController, ReviewsAdminController],
  providers: [ReviewsService],
  exports: [ReviewsService],   // seed CLI consumes it
})
export class ReviewsModule {}
```

Mirrors `src/projects/projects.module.ts`. Exports `ReviewsService` so
the `seed-reviews.ts` CLI can consume it (clarifier #6 default).

### `AppModule` (`src/app.module.ts`) — additions

```ts
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
// ...

@Module({
  imports: [
    // ... existing imports ...
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig>) => {
        const write = config.get("REVIEWS_THROTTLE_WRITE_LIMIT", { infer: true }) as number;
        const read  = config.get("REVIEWS_THROTTLE_READ_LIMIT",  { infer: true }) as number;
        const ttl   = config.get("REVIEWS_THROTTLE_TTL_MS",      { infer: true }) as number;
        return [{ name: "default", ttl, limit: write }];
      },
    }),
  ],
  // NOTE: ThrottlerGuard is NOT registered as APP_GUARD — the throttler
  // is per-route via @Throttle() decorators. See Risks #6.
})
```

The `default` tracker's `limit` is the WRITE limit (5 by default);
the public read routes override per-route with their own `@Throttle()`.

### `data-source.ts` — additions

```ts
import { ReviewEntity } from "./reviews/entities/review.entity";
import { ReviewCommentEntity } from "./reviews/entities/review-comment.entity";

export const AppDataSource = new DataSource({
  // ...
  entities: [UserEntity, RefreshTokenEntity, ProjectEntity, ProjectUrlEntity, ReviewEntity, ReviewCommentEntity],
  migrations: [join(process.cwd(), "src/database/migrations/*.{ts,js}")],
  synchronize: false,
});
```

### `env.config.ts` — additions

Three new Joi keys (per §Anti-Spam env-driven overrides above).

## Conventions Inherited from `projects-crud`

- **Layout**: `src/reviews/{dto,entities,reviews.controller.ts,reviews-admin.controller.ts,reviews.service.ts,reviews.module.ts,*.spec.ts}`.
- **Entity shape**: TypeORM `@Entity('reviews')` and `@Entity('review_comments')`
  mirroring DBML exactly (column names in snake_case via `@Column({ name })`,
  `createdAt` via `@CreateDateColumn`). Register in `src/data-source.ts`
  `entities` array AND in `ReviewsModule.imports` via
  `TypeOrmModule.forFeature([...])`.
- **DTO shape**: `class-validator` + `class-transformer` annotations,
  `@ApiProperty` on every field, `@IsOptional()` on optional fields,
  `@MaxLength(...)` on free-text fields, query DTOs use
  `@Type(() => Number)`. The `forbidNonWhitelisted` global pipe is
  inherited from `main.ts` — unknown fields 400.
- **Response envelope**: `{ data, total, page, pageSize }` for paginated
  lists; single-object responses return the entity-shaped DTO directly.
- **Error envelope**: canonical 4xx/5xx shape from
  `global-exception-filter/spec.md` (already wired in `main.ts` via
  `useGlobalFilters(new AllExceptionsFilter(...))`). Service throws
  `NotFoundException` / `ConflictException`; the filter renders the
  rest.
- **JwtAuthGuard usage**: method-level (NOT global), per `auth-domain`
  spec. `@UseGuards(JwtAuthGuard) @ApiBearerAuth()` on the 3 admin
  methods only. The `app.module.spec.ts` static guard-rail (which
  asserts no `APP_GUARD` provider references `JwtAuthGuard`) stays
  green.
- **Existence-leak guard**: `findOneApprovedById` and
  `findApprovedCommentsByReviewId` both return 404 for "missing" and
  "exists but unapproved" using the same `NotFoundException` body
  (mirrors `ProjectsService.findOneBySlug`).
- **E2E shape**: `test/reviews.e2e-spec.ts` mirrors
  `test/projects.e2e-spec.ts` (process.env stubs at the top,
  `@nestjs/typeorm` mocked, JWT minted with the test secret for
  protected cases).
- **Migration shape**: hand-written TypeORM migration in
  `src/database/migrations/`, reversible via `down()`, comment-block
  header documenting the "no live Postgres in this env" caveat and
  the docker verification recipe.
- **Colocated `*.spec.ts`**: every file has a colocated spec. Entity
  metadata spec, DTO validation spec (with the global pipe options),
  controller HTTP-shape spec, service behavior spec, throttler
  integration spec.
- **Strict TDD**: RED-first. Every behavior committed in this proposal
  has a corresponding scenario in the next-phase `*.spec.ts` and
  `test/reviews.e2e-spec.ts`.
- **`apply-progress` markers**: per the user-locked commit strategy,
  every file/spec/service/functionality-complete commit MUST be
  accompanied by an `apply-progress.md` entry naming the task.
- **No new packages** beyond `@nestjs/throttler` (locked #2). Every
  other dep is already installed.

## Affected Areas

| Area | Impact | Description |
| --- | --- | --- |
| `src/reviews/entities/review.entity.ts` | Replaced | `@Entity('reviews')` matching DBML. NO subject linkage. |
| `src/reviews/entities/review-comment.entity.ts` | New | `@Entity('review_comments')` with `isApproved` column (locked #3). FK to `ReviewEntity` with `onDelete: 'CASCADE'` (locked #4). |
| `src/reviews/entities/{review,review-comment}.entity.spec.ts` | New | Entity-metadata assertions. |
| `src/reviews/dto/create-review.dto.ts` | Replaced | Subject-free body. |
| `src/reviews/dto/create-review-comment.dto.ts` | New | |
| `src/reviews/dto/list-reviews-query.dto.ts` | New | `page?`, `pageSize?`, `rating?`, `isApproved?` (admin-only). |
| `src/reviews/dto/list-comments-query.dto.ts` | New | `page?`, `pageSize?`. |
| `src/reviews/dto/review-response.dto.ts` | New | Single review shape. |
| `src/reviews/dto/review-comment-response.dto.ts` | New | Single comment shape. |
| `src/reviews/dto/list-reviews-response.dto.ts` | New | Envelope. |
| `src/reviews/dto/list-comments-response.dto.ts` | New | Envelope. |
| `src/reviews/dto/create-review.dto.spec.ts` + 3 more DTO specs | New | DTO validation. |
| `src/reviews/review-response.mapper.ts` | New | Entity → response DTO. |
| `src/reviews/reviews.controller.ts` | Replaced | Public surface, 4 throttled routes. |
| `src/reviews/reviews-admin.controller.ts` | New | Protected surface, 3 JWT-guarded routes. |
| `src/reviews/reviews.controller.spec.ts` | New | HTTP shape + throttler + Swagger assertions. |
| `src/reviews/reviews-admin.controller.spec.ts` | New | HTTP shape + JwtAuthGuard + Swagger assertions. |
| `src/reviews/reviews.service.ts` | Replaced | 8 methods (see §Service Surface). |
| `src/reviews/reviews.service.spec.ts` | Replaced | Service behavior + existence-leak + CASCADE coverage. |
| `src/reviews/reviews.module.ts` | Modified | `TypeOrmModule.forFeature([...])`, two controllers, exports service. |
| `src/reviews/reviews.module.spec.ts` | New | Wires the module without the throttler. |
| `src/cli/seed-reviews.ts` + spec | New | CLI seed mirroring `seed-projects.ts` with `SEED_DRY_RUN`. |
| `src/database/migrations/<ts>-create-reviews-and-review-comments.ts` | New | Hand-written migration (2 tables, 1 FK, 3 indexes). |
| `src/data-source.ts` | Modified | Add `ReviewEntity`, `ReviewCommentEntity` to the `entities` array. |
| `src/app.module.ts` | Modified | Register `ThrottlerModule.forRootAsync(...)` (NOT as `APP_GUARD`). |
| `src/config/env.config.ts` | Modified | Add 3 Joi keys (`REVIEWS_THROTTLE_*`). |
| `package.json` | Modified | `+ @nestjs/throttler` dep. |
| `test/reviews.e2e-spec.ts` | New | E2E for all 7 routes. |
| `test/jest-e2e.json` | Modified (if needed) | Already matches `*.e2e-spec.ts` (per projects-crud). |
| `openspec/specs/server_specs.md` | Modified | §3.3 gains throttler section + envelope + cascade contract. |
| `openspec/specs/database-schema.dbml` | Modified (at archive) | Add `is_approved` to `review_comments`. |
| `README.md` | Modified | New "Reviews" endpoints table + "Anti-spam (throttler)" subsection documenting the env vars and the per-route limits. |

## Risks

| # | Risk | Likelihood | Mitigation |
| - | --- | --- | --- |
| 1 | Throttler env values are wrong (too permissive → spam, too strict → real users 429). | Med | The 3 new Joi keys have explicit defaults (`5` / `60` / `60_000`) and a `min(1)` floor. The README documents each var. The e2e suite uses `limit: 1_000_000` to avoid throttler interference. |
| 2 | `is_approved` migration on `review_comments` is NOT idempotent — re-run fails on `ADD COLUMN`. | Med | Use `ALTER TABLE review_comments ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;` (Postgres 9.6+ supports `IF NOT EXISTS` on `ADD COLUMN`). |
| 3 | `ON DELETE CASCADE` removes child comments silently — admin UI should warn before delete. | Med | The frontend concern; this proposal documents it. The service does NOT log the cascade (it is a single `delete` call); the design phase may add a `Logger.log` debug line for diagnostics. |
| 4 | DBML has no CHECK on `rating` 1–5; the DTO enforces it. | Low | Documented defense-in-depth trade-off. A follow-up migration can add the CHECK if the user wants. The DTO + the `integer` column type catch the realistic abuse. |
| 5 | `author_role` free text is a minor PII leak (e.g. "CTO en Startup X" identifies the reviewer). | Low (privacy) | Documented per clarifier #5. The proposal's default is "return as-is" — a follow-up can add a normalized "Anonymous" path or an opt-in `?redactPii=true` flag. |
| 6 | Throttler module is registered but `ThrottlerGuard` is NOT registered as `APP_GUARD` — only per-route `@Throttle()` decorators apply. If a future route is added without `@Throttle()`, it is unthrottled. | Med | Document the choice in this proposal + design + README. The per-route pattern is intentional (admin routes are unthrottled). A static guard-rail in `app.module.spec.ts` can assert "ThrottlerGuard is not in `APP_GUARD` providers" to prevent a future global registration. |
| 7 | Stub routes `GET /reviews/:id` and `PATCH /reviews/:id` are removed in this slice. If the frontend depends on them, it breaks. | Med | Confirmed by the explore (server_specs has no such routes; the stubs are leftover from the scaffold). The proposal's clarifier #8 is the explicit "REMOVE" verdict. design confirms with the user. |
| 8 | `content` 2000-char cap is much smaller than projects' 50 000. Why? | Low | Reviews are short-form feedback; 2 KB ≈ 300 words (≈ 1–2 paragraphs). 2 KB also bounds the `text` storage and the e2e payload. Documented in the DTO comment. |
| 9 | The throttler uses `req.ip` which is wrong behind a reverse proxy without `trust proxy` set. | Med | design MUST add `app.set('trust proxy', 1)` in `main.ts` (or document the user's deployment as "direct to Nest, no proxy"). Without this, every visitor appears to come from the proxy IP and gets 429d. |
| 10 | The `findOneApprovedById` route is a NEW public surface, not in §3.3. If the user prefers a strict "only §3.3" interpretation, this route is dropped. | Low | Service method stays (so the throttler + existence-leak guard are tested). The controller route is added only if design confirms. |
| 11 | The throttler is a runtime config; tests that build a `Test.createTestingModule` need the env vars set. | Low | `test/reviews.e2e-spec.ts` sets `process.env.REVIEWS_THROTTLE_*` to permissive values at the top. The unit spec for the throttler integration uses `Test.createTestingModule({ imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 1_000, limit: 1_000_000 }])] })`. |
| 12 | Two controllers share `ReviewsService` via DI — the module's `controllers` array lists both. The `Test.createTestingModule` for either controller must still provide `ReviewsService`. | Low | The `reviews.controller.spec.ts` and `reviews-admin.controller.spec.ts` each list `ReviewsService` as a provider (mirror the projects spec). |

## Forecast (rough LOC)

> Read against the projects-crud archive as a reference (~670 LOC
> total over 4 chains). Reviews-domain is structurally similar
> (entity + DTO + service + controller + migration + e2e + seed) but
> has TWO controllers (public + admin), an extra entity
> (`ReviewCommentEntity`), the throttler integration, and a 7th route.
> The migration is one file (vs. projects' one file).

| File | Rough LOC |
| --- | --- |
| `ReviewEntity` + `ReviewCommentEntity` + 2 specs | ~120 |
| DTOs (6 files) + 4 specs | ~400 |
| `ReviewResponseMapper` | ~30 |
| `ReviewsService` + spec | ~350 |
| `ReviewsController` + spec | ~150 |
| `ReviewsAdminController` + spec | ~150 |
| `ReviewsModule` + spec | ~60 |
| Throttler integration (env keys, app.module, README section) | ~100 |
| Migration | ~80 |
| `seed-reviews.ts` + spec | ~150 |
| `test/reviews.e2e-spec.ts` | ~300 |
| `README.md` (new sections) | ~60 |
| **Total** | **~1 950** |

> **Note**: this is a rough estimate. The throttler integration is the
> biggest unknown (the `throttler-module-options` factory + the per-route
> decorators + the env-var wiring can balloon depending on how
> configurable the user wants it). The 400-line review budget is
> **exceeded by an order of magnitude**. The proposal recommends
> `apply-progress` chunking (see §Delivery Strategy) — NOT a single
> chain, NOT chained PRs (per the user-locked strategy: "NO work
> branches, NO PRs").
>
> Low estimate: ~1 400 LOC (aggressive code golf, throttler integration
> left bare-bones).
> High estimate: ~2 400 LOC (full Swagger annotations, robust throttler
> integration with per-route customisation, comprehensive e2e).

## Delivery Strategy

**Trunk-based commit-range on `domains/reviews`**. No PRs. No work
branches. `apply-progress` markers track progression.

Per the user-locked commit strategy: **ONE commit per file / spec /
service / functionality completed. ZERO small-progress commits.** Each
commit is a coherent unit of work that leaves the repo in a green
state (`npm run lint && npm test && npm run build` passes after every
commit).

The apply phase chunks the work into ~10-15 commits. The exact
sequence is owned by `sdd-tasks` (which respects this proposal's
ordering) and refined by `sdd-apply`. Approximate commit sequence
(commit messages are conventional-commit style):

1. `chore(reviews): add @nestjs/throttler dep + 3 env keys`
2. `feat(reviews): ReviewEntity + ReviewCommentEntity + entity specs`
3. `feat(reviews): migration create-reviews-and-review-comments`
4. `feat(db): register review entities in data-source`
5. `feat(reviews): review-response.mapper`
6. `feat(reviews): CreateReviewDto + CreateReviewCommentDto + specs`
7. `feat(reviews): ListReviewsQueryDto + ListCommentsQueryDto + specs`
8. `feat(reviews): ReviewResponseDto + ReviewCommentResponseDto + envelopes + specs`
9. `feat(reviews): ReviewsService (8 methods) + service spec`
10. `feat(reviews): ReviewsController (public, throttled) + spec`
11. `feat(reviews): ReviewsAdminController (protected) + spec`
12. `feat(reviews): ReviewsModule (forFeature + 2 controllers + export)`
13. `feat(throttler): register ThrottlerModule.forRootAsync in AppModule`
14. `test(reviews): e2e coverage of 7 routes + throttler shape`
15. `chore(reviews): seed-reviews.ts CLI + spec`
16. `docs(reviews): README endpoints table + throttler section`

Total: ~16 commits. No commit is a "small progress" commit — each one
ships a complete file (or a logical group of related files). The
throttler commit (#13) is a single coherent functionality; the e2e
commit (#14) is a single coherent test file; the seed commit (#15) is
the CLI + its spec (the project uses CLI + colocated spec as one
unit, mirroring `seed-projects.ts`).

The `apply-progress.md` log is appended with an entry per commit
(commit SHA + the task name from `tasks.md`). The orchestrator does
NOT create PRs (per the user-locked strategy).

## Open Clarifiers (Design Phase Will Own)

These four have defaults in this proposal but the user can override
at design time. They are explicitly NOT blockers for `sdd-spec`.

| # | Clarifier | Proposed default | Override path |
| - | --- | --- | --- |
| 5 | PII surface on public `GET /api/v1/reviews`: return `authorName` / `authorRole` as-is, or normalize empty to "Anonymous", or opt-in `?redactPii=true`? | **Return as-is.** Documented in Risks #5. The DBML default `'Anónimo'` already normalises empty submissions; explicit values pass through. | sdd-design can opt for normalisation or an opt-in flag if the user prefers. |
| 6 | `seed-reviews.ts` CLI: add a dev/test seeder mirroring `seed-projects.ts`? | **YES.** Mirror `src/cli/seed-projects.ts` shape: 3 approved reviews + 2 pending reviews, each with 0–2 sample comments, with `SEED_DRY_RUN=1` for dry-run. | sdd-design can drop the CLI if the user prefers manual seeding via the admin UI. |
| 7 | Public `GET /api/v1/reviews/:id/comments`: add a public read endpoint? | **YES** — gated by `isApproved: true`. Implied by the §3.3 public-UX flow. The service method ships regardless; the controller route is added only if design confirms. | sdd-design can drop the route (service stays). |
| 8 | Stub `PATCH /reviews/:id` route: keep, drop, or move to `PATCH /admin/reviews/:id`? | **REMOVE in this slice.** §3.3 has no edit endpoint. The `UpdateReviewDto` stub is deleted. | sdd-design can keep a PATCH route (public or admin) if a future need surfaces — explicitly NOT in this change. |

## Rollback Plan

The hand-written migration is reversible via `down()` (drops the
indexes + tables in reverse order). `synchronize: false` in
`data-source.ts` means the schema in any environment is unaffected
by a hypothetical entity-only change. The new routes are additive
in the public path (`/api/v1/reviews` is new) and additive in the
admin path (`/api/v1/admin/reviews` is new) — no existing endpoint
is renamed or removed (the scaffold stub routes ARE removed, but
they were never functional — the scaffold was a string-placeholder
stub). To revert: `git revert <sha>` for each commit in reverse
order; the routes disappear, the migration is reversed via
`migration:revert`, the `@nestjs/throttler` dep is removed, and
`app.module.ts` + `data-source.ts` go back to their pre-change
state. Per the projects-crud precedent, the
`app.module.spec.ts` static guard-rail (asserts no `APP_GUARD`
references `JwtAuthGuard` OR `ThrottlerGuard`) stays green — this
change does NOT register `ThrottlerGuard` as a global guard.

## Success Criteria

- [ ] `npm run build` passes.
- [ ] `npm test` passes (unit specs added for both entities, all 6
      DTOs, both controllers, the service, the module, the
      throttler integration, and the seed CLI).
- [ ] `npm run test:e2e` passes (`test/reviews.e2e-spec.ts` covers
      all 7 routes + the throttler shape + the cascade).
- [ ] `GET /api/v1/reviews` (public, throttled) → 200 + envelope
      `{ data, total, page, pageSize }`; only `isApproved: true`;
      `?rating=5` filters; `?page=2&pageSize=5` paginates.
- [ ] `GET /api/v1/reviews/:id` (public, throttled) → 200 + review;
      404 for "missing" and "exists but unapproved" (same body, no
      existence leak).
- [ ] `GET /api/v1/reviews/:id/comments` (public, throttled) → 200
      + envelope of `isApproved: true` comments; 404 if the parent
      is missing or unapproved.
- [ ] `POST /api/v1/reviews` (public, throttled) without auth → 201
      with `isApproved: false`; validation errors → 400; 6th
      request inside the 60s window → 429.
- [ ] `POST /api/v1/reviews/:id/comments` (public, throttled) → 201
      with `isApproved: false`; missing parent → 404; 6th request
      inside the 60s window → 429.
- [ ] `GET /api/v1/admin/reviews` without `Authorization` → 401; with
      bearer → 200 + all reviews; `?isApproved=true|false` filters.
- [ ] `PATCH /api/v1/admin/reviews/:id/approve` without bearer → 401;
      with bearer + valid id → 200 with toggled `isApproved`; 404
      on missing.
- [ ] `DELETE /api/v1/admin/reviews/:id` without bearer → 401; with
      bearer + valid id → 204; child `review_comments` rows are
      removed by the FK CASCADE (verified via the e2e mock repo).
- [ ] Any `HttpException` → response body matches the canonical
      envelope from `global-exception-filter/spec.md`.
- [ ] A throttled request → 429 with the canonical envelope + a
      `Retry-After` header.
- [ ] Swagger UI at `/api/v1/docs` lists `reviews` tag with 7 routes;
      the 3 admin routes + 1 toggle show the bearer padlock.
- [ ] `src/data-source.ts` lists `ReviewEntity, ReviewCommentEntity`;
      `npm run build` resolves both entities.
- [ ] The migration is reversible via `down()`; the file matches the
      projects migration's comment-block header.
- [ ] The seed CLI (`npm run seed:reviews`) inserts 3 approved + 2
      pending reviews with 0–2 comments each; `SEED_DRY_RUN=1`
      short-circuits to a log.
- [ ] `server_specs.md` §3.3 reflects the envelope, throttler
      section, cascade, and the per-route limits.
- [ ] `database-schema.dbml` gains `is_approved` on `review_comments`
      (at archive time, per the projects-crud precedent).
- [ ] `README.md` has the Reviews endpoints table and the
      "Anti-spam (throttler)" subsection documenting the 3 env vars
      and how to change the limits.

## Recommended Next Step

`sdd-spec` — produces 2 delta specs:

1. `openspec/changes/reviews-domain/specs/reviews-domain/spec.md`
   covering: `ReviewEntity` + `ReviewCommentEntity`, the 7 routes
   (or 6 if clarifier #7 is dropped at design), the public list
   envelope, the existence-leak guard on the public detail, the
   JWT guard on the 3 admin routes, the FK `ON DELETE CASCADE`
   contract (locked #4), the `forbidNonWhitelisted` rejection of
   unknown fields, and the `parseUUIDPipe` 400 on bad ids.
2. `openspec/changes/reviews-domain/specs/reviews-throttling/spec.md`
   (or `reviews-anti-spam/spec.md` — name is design's call)
   covering: the throttler registration, the per-route `@Throttle`
   decorators, the 3 new env vars with Joi validation, the
   `Retry-After` header on 429, the canonical envelope on the 429
   body, and the explicit "ThrottlerGuard is NOT in `APP_GUARD`"
   contract (Risks #6).

Specs depend on the 4 clarifier defaults being committed at design
time — but sdd-propose is NOT waiting; it has proposed with
defaults. sdd-design will surface the 4 clarifiers for explicit user
confirmation; if the user changes a default, sdd-spec must adjust
its scenarios before landing.

## What I Did NOT Propose

- No source code (`*.ts` in `src/`); no spec files; no design; no
  tasks — those are the next phases (`sdd-spec`, `sdd-design`,
  `sdd-tasks`).
- No DBML delta committed here — the `is_approved` column ships in
  the hand-written migration; the DBML is updated at `sdd-archive`
  per the projects-crud precedent.
- No `package.json` mutation, no edits to `src/main.ts`,
  `src/app.module.ts`, `src/data-source.ts`,
  `src/config/env.config.ts`, `openspec/specs/server_specs.md`, or
  `README.md` — those are touched during `sdd-apply` and merged at
  `sdd-archive`.
- No live-DB verification (per the projects-crud precedent, the
  migration is verified via the comment-block recipe; no Postgres in
  this env).
- No re-litigation of the 4 locked decisions.
