# Design: Reviews Domain + Anti-Spam Throttler

## Technical Approach

Build the reviews domain on the existing
`bootstrap-api-config`, `auth-domain`, `projects-crud`, and
`global-exception-filter` foundations: two TypeORM entities
(`ReviewEntity`, `ReviewCommentEntity`) wired into the shared
`AppDataSource` and `ReviewsModule`; the seven routes
mandated by `server_specs.md` §3.3 plus the clarifier-#7
public read of approved comments; the
`{ data, total, page, pageSize }` envelope for paginated
lists; the canonical 4xx/5xx envelope from
`global-exception-filter`; the method/class-level
`JwtAuthGuard` contract from `auth-domain`; and
`@nestjs/throttler` registered once in `AppModule` with
three new Joi-validated env vars and per-route
`@Throttle()` decorators on the four public endpoints.
The `reviews` and `review_comments` tables mirror
`database-schema.dbml` exactly — **no `project_id`, no
`owner_user_id`, no `subject_type` discriminator** (locked
#1) — with `is_approved boolean default false` added on
`review_comments` (locked #3) and `ON DELETE CASCADE` on
`review_comments.review_id` (locked #4). The
`UpdateReviewDto` stub and the `PATCH /reviews/:id` route
are removed (locked #8). A hand-written TypeORM migration
in `src/database/migrations/` is reversible via `down()`
and follows the precedent set by
`20260618205116-create-projects-and-project-urls.ts`. A
dev-only seed CLI (`src/cli/seed-reviews.ts`) mirrors
`seed-projects.ts` with a `SEED_DRY_RUN=1` flag. Total
forecast: **1,900-2,400 non-test LOC** (~3,400 with
strict-TDD tests) across ~18 single-file commits on
`domains/reviews` (trunk-based, no PRs, `apply-progress`
markers).

Satisfies the `reviews-domain` delta spec (10 ADDED
Requirements, 24 scenarios) and the `reviews-throttling`
delta spec (4 ADDED Requirements, 17 scenarios). Reuses
`JwtAuthGuard` from `src/auth/guards/`, the global
`ValidationPipe` from `main.ts`, the canonical
`AllExceptionsFilter` from `src/common/filters/`, and the
typed `ConfigService<EnvConfig>` injection pattern from
`bootstrap-api-config`. **One new dependency**:
`@nestjs/throttler` (locked #2).

## Architecture Overview

```
   ┌──────────────┐  public        ┌─────────────────────────┐
   │  Frontend /  │ ─────────────► │ ReviewsController       │
   │  curl / e2e  │  4 throttled   │ @Controller('reviews')  │
   │              │  routes        │  POST  /reviews         │ ◄── @Throttle(write)
   │              │                │  GET   /reviews         │ ◄── @Throttle(read)
   │              │                │  POST  /reviews/:id/... │ ◄── @Throttle(write)
   │              │                │  GET   /reviews/:id/... │ ◄── @Throttle(read)
   └──────┬───────┘                └────────┬────────────────┘
          │                                 │ shared DI
          │  bearer (admin)                 ▼
          └──────────────────────────► ┌────────────────────────────────────┐
                                       │ ReviewsAdminController              │
                                       │ @Controller('admin/reviews')       │
                                       │ @UseGuards(JwtAuthGuard) CLASS-LEVEL│
                                       │  GET    /admin/reviews              │
                                       │  PATCH  /admin/reviews/:id/approve  │
                                       │  DELETE /admin/reviews/:id         │
                                       └────────┬───────────────────────────┘
                                                ▼
                                       ┌────────────────────────────────────┐
                                       │ ReviewsService (8 methods)         │
                                       │  injects reviews + comments repos  │
                                       │  (no DataSource — no transactions) │
                                       └────────┬───────────────────────────┘
                                                ▼
                                       ┌────────────────────────────────────┐
                                       │ Postgres: reviews + review_comments│
                                       │  ON DELETE CASCADE on review_id    │
                                       └────────────────────────────────────┘

   AppModule:
     ThrottlerModule.forRootAsync({ ConfigService })
       → reads REVIEWS_THROTTLE_TTL_MS / _WRITE_LIMIT / _READ_LIMIT
       → returns [{ name: 'default', ttl, limit: writeLimit }]
     ThrottlerGuard is NOT registered as APP_GUARD

   main.ts:
     app.set('trust proxy', 1)   // so req.ip is the real client IP
     useGlobalPipes(ValidationPipe)
     useGlobalFilters(AllExceptionsFilter)  // also renders 429
```

The two controllers split along the path prefix
(`/reviews` vs `/admin/reviews`) per `server_specs.md` §3.3.
Both share `ReviewsService` via DI; the public surface has
no guard and per-route `@Throttle()`; the admin surface
has class-level `@UseGuards(JwtAuthGuard)` and no
throttler. 4xx/5xx renders through the global
`AllExceptionsFilter`; the throttler's
`ThrottlerException` flows through it as a `429` with the
canonical body and a `Retry-After` header.

## Architecture Decision Records

### ADR-1: No subject polymorphism on `reviews` (locked)

`ReviewEntity` exposes the seven columns the DBML declares
(DBML lines 39-47): `id`, `authorName`, `authorRole`,
`content`, `rating`, `isApproved`, `createdAt`. There is
NO `projectId` FK, NO `ownerUserId` FK, and NO
`subjectType` discriminator. `ReviewEntity` has NO
`@ManyToOne` to `ProjectEntity` / `UserEntity`.
`CreateReviewDto` does NOT expose any of the three (the
DTO is the canonical proof of this decision at the API
surface).

**Rationale.** Locked #1. The user said "Siguiendo las
definiciones del DBML" and explicitly chose to skip
polymorphism. A visitor who wants to refer to a project
writes the project name into free-text `content`. The
trade-off: a review can never be queried by project and
has no referential integrity to a project. The benefit:
a clean, simple table that requires no schema change, no
admin-side select widget, and no cascade policy on subject
deletion. Rejected alternatives: (a) `project_id` +
`subject_type` discriminator; (b) two nullable FKs +
CHECK; (c) two separate tables — all contradict locked #1.

### ADR-2: Throttler module-level, not feature-level

`ThrottlerModule` is registered once in `AppModule` via
`ThrottlerModule.forRootAsync({ inject: [ConfigService],
useFactory })`. The factory reads the three new
Joi-validated env vars via the typed
`ConfigService<EnvConfig>` and returns a single named
tracker `{ name: "default", ttl, limit: <writeLimit> }`.
The throttler is applied per-route via
`@Throttle({ default: { limit, ttl } })` decorators on
the four public endpoints only. `ThrottlerGuard` is NOT
registered as a global `APP_GUARD` (the per-route pattern
is intentional: admin routes are unthrottled, so a global
guard would force every public route to opt out).

**Rationale.** Module-level registration keeps the
integration in one place and makes future domains (e.g.
`contact`) opt-in via their own per-route `@Throttle()`
decorators. Feature-level registration would duplicate
the env-var reading, the storage allocation, and the
guard wiring. The `forRootAsync` factory is the only way
to make the throttler tunable at boot without code
changes (per locked #2 the user asked for well-documented
knobs). Storage is in-memory per-IP
(`@nestjs/throttler` default); a Redis-backed store is a
follow-up only if multi-instance deployment becomes a
problem. Rejected alternatives: (a) global `APP_GUARD`
(forces public routes to opt out); (b) feature-level
registration (duplication); (c) Redis from day one
(unnecessary operational cost).

### ADR-3: Throttler env-var names (confirmed)

| Env var | Type | Default | Joi rule |
| --- | --- | --- | --- |
| `REVIEWS_THROTTLE_TTL_MS` | `number` (ms) | `60_000` | `Joi.number().integer().min(1_000).default(60_000)` |
| `REVIEWS_THROTTLE_WRITE_LIMIT` | `number` | `5` | `Joi.number().integer().min(1).default(5)` |
| `REVIEWS_THROTTLE_READ_LIMIT` | `number` | `60` | `Joi.number().integer().min(1).default(60)` |

The names match the spec proposal exactly. Defaults match
the spec table. The `min(1_000)` floor on the TTL prevents
a zero-millisecond window (which would 429 every
request); the `min(1)` floor on the limits prevents `0`.
`infer: true` on `ConfigService.get(...)` is the
typed-env-access pattern inherited from
`bootstrap-api-config`. The `REVIEWS_` prefix is kept
(per the spec lock); future domains (e.g. `contact`) can
use `CONTACT_THROTTLE_*` to keep namespaces clean.

### ADR-4: Per-route throttle limits (locked)

| Route | Limit | TTL | Source env var |
| --- | --- | --- | --- |
| `POST /api/v1/reviews` | `5` | `60_000` ms | `_WRITE_LIMIT` / `_TTL_MS` |
| `POST /api/v1/reviews/:id/comments` | `5` | `60_000` ms | `_WRITE_LIMIT` / `_TTL_MS` |
| `GET /api/v1/reviews` | `60` | `60_000` ms | `_READ_LIMIT` / `_TTL_MS` |
| `GET /api/v1/reviews/:id/comments` | `60` | `60_000` ms | `_READ_LIMIT` / `_TTL_MS` |
| 3 admin routes | — | — | (no `@Throttle()` decorator) |

The 5-write / 60-second window is enough to cover
"submit one review, tweak it, resubmit" without letting a
bot submit 1000 reviews per minute. The 60-read /
60-second window is high enough that a normal user does
not notice throttling, low enough to make scraping more
expensive than visiting the public site. Admin routes
have NO `@Throttle()`: the JWT is the gate, and per-IP
throttling on a single admin IP is a self-denial-of-service
vector. Values are env-overridable so the e2e suite can
set them to `1_000_000` to bypass the throttler.

### ADR-5: Trust proxy = 1 in `main.ts`

`app.set('trust proxy', 1)` is called in
`configureApp(...)` BEFORE `useGlobalPipes(...)` and the
CORS / Swagger / filter wiring. The value `1` means
"trust the nearest hop" — the Express documented setting
for a single reverse-proxy deployment (Vercel / Cloudflare
/ a Cloudflare tunnel).

**Rationale.** `@nestjs/throttler` buckets requests by
`req.ip`, which Express derives from the socket IP by
default. Without `trust proxy` set, every visitor behind
a reverse proxy shares the proxy's IP and the throttler
429s the entire fleet after the 5th public POST. `1` is
safe for a single-proxy deployment; `true` ("trust all
proxies") is rejected because it lets a client spoof
their `X-Forwarded-For` header and bypass per-IP
throttling entirely.

### ADR-6: 2-controller split (`ReviewsController` + `ReviewsAdminController`)

`ReviewsController` (`@Controller('reviews')`) — public
surface, 4 routes. No `@UseGuards`. Per-route
`@Throttle()` per ADR-4. `ReviewsAdminController`
(`@Controller('admin/reviews')`) — protected surface, 3
routes. `@UseGuards(JwtAuthGuard) @ApiBearerAuth()` at
the CLASS level (not per-method — the entire controller
is admin-only). Both registered in the same
`ReviewsModule`'s `controllers` array and share
`ReviewsService` via DI. `@ApiTags('reviews')` is on
both classes (Swagger groups them under one tag).
`ParseUUIDPipe` on every `:id` param.

**Rationale.** `server_specs.md` §3.3 explicitly
separates the two surfaces by path. A single controller
with per-method guards is harder to read at a glance; the
class-level guard on the admin controller is a single
source of truth. The projects domain uses a single
controller because its spec does NOT have a
`/admin/projects` sub-path; reviews does, so it uses two.
The seed CLI consumes `ReviewsService` (not the
controllers), so the controller split is a HTTP-routing
concern only. Rejected: (a) single controller with
per-method guards (less clear); (b) sub-routes on the
public controller (ugly URL); (c) separate
`ReviewsAdminModule` (unnecessary import split).

### ADR-7: `is_approved boolean default false` on `review_comments` (locked)

`ReviewCommentEntity.isApproved` is
`@Column({ name: "is_approved", type: "boolean", default: false })`.
The migration uses
`ALTER TABLE review_comments ADD COLUMN IF NOT EXISTS is_approved boolean NOT NULL DEFAULT false;`
(Postgres 9.6+ supports `IF NOT EXISTS` on `ADD COLUMN`).
The column is NOT in the DBML today; it lands in
`database-schema.dbml` at `sdd-archive` time per the
projects-crud precedent.

**Rationale.** Locked #3. The public read of comments
MUST filter to `isApproved: true`; the admin moderation
queue for comments is a follow-up. The `default false`
means every new comment starts unapproved — a deliberate
friction on spam. The idempotent migration clause is
defense against a partial re-run. The `isApproved` field
is included in `ReviewCommentResponseDto` for
forward-compatibility (the admin moderation route will
toggle it in a follow-up). Rejected: (a) auto-approve
comments when parent is approved (removes independent
moderation); (b) add `is_approved` to DBML first
(projects precedent updates DBML at archive time); (c)
default `true` (the exact gap the explore flagged).

### ADR-8: `ON DELETE CASCADE` on `review_comments.review_id` (locked)

`ReviewCommentEntity.review` declares
`onDelete: "CASCADE"` on the `@ManyToOne` decorator.
The migration emits
`FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE`.
`ReviewsService.remove(id)` calls
`this.reviews.delete({ id })` ONCE — the DB-level
cascade removes the child comment rows. The service does
NOT issue a manual `this.comments.delete(...)` call. The
e2e spec asserts both: parent removed AND child rows
removed via the FK CASCADE, NOT a service-side delete.

**Rationale.** Locked #4. The DBML has
`[ref: > reviews.id, not null]` with no `onDelete` clause
so Postgres defaults to `NO ACTION` (a DELETE on a parent
with children would 500). The CASCADE is the only way to
make `DELETE /admin/reviews/:id` succeed when the review
has child comments. Mirrors the
`project_urls.project_id` precedent (also CASCADE per
`20260618205116-create-projects-and-project-urls.ts`).
Rejected: (a) `RESTRICT` (manual child-delete required);
(b) `SET NULL` (FK is NOT NULL); (c) soft delete (out of
scope).

### ADR-9: `rating` 1-5 enforcement — DTO only (no DB CHECK)

`CreateReviewDto.rating` carries
`@IsInt() @Min(1) @Max(5) @IsNotEmpty()`. The
`@Column({ type: "integer" })` on `ReviewEntity.rating`
enforces the integer type at the DB level. There is NO
DB-level `CHECK (rating BETWEEN 1 AND 5)` constraint.

**Rationale.** The projects domain does NOT have a DB
CHECK on `is_published` either. The DTO is the canonical
input contract; a bad rating never reaches the service.
The `integer` column type already rejects non-integer
values at the DB layer. The realistic abuse vector is
"user submits rating=6 via the HTTP API", which the DTO
blocks at 400 — not "user bypasses the API and writes
directly to the DB", which requires a leaked
`DATABASE_URL` (a much bigger problem). A follow-up
migration can add the CHECK if the user wants defense
in depth; it is explicitly out-of-scope per proposal.

### ADR-10: Response envelope — inherit `{ data, total, page, pageSize }`

Every paginated list response (public review list, admin
review list, public comment list) uses the canonical
envelope. `page` defaults to `1` and MUST be `>= 1`.
`pageSize` defaults to `20` and MUST be `>= 1`;
`pageSize > 100` is silently clamped to `100` (NOT
rejected with 400). `total` is the count of rows that
matched the filter, BEFORE pagination. Single-object
responses (`POST /api/v1/reviews`,
`PATCH /api/v1/admin/reviews/:id/approve`) return the
entity-shaped DTO directly — no envelope.

**Rationale.** This is the projects-domain envelope
shape (`openspec/changes/archive/projects-crud/design.md`
§Service Layer) and is the convention every list
endpoint uses. Adding a new shape is a cross-cutting
breaking change for the frontend. The silent cap on
`pageSize > 100` is wire-permissive (the DTO's `@Max(100)`
already rejects at validation time; the service silent-cap
is belt-and-braces). Rejected: (a) reject `pageSize>100`
with 400 (spec is permissive); (b) new shape
`{ items, meta }` (mixing shapes); (c) `hasNext`/`hasPrev`
flags (projects domain doesn't have them).

### ADR-11: Existence-leak guard on public reads (with documented asymmetry)

The public read endpoints
(`GET /api/v1/reviews/:id/comments`) return `404` for
BOTH "row missing" AND "row exists but `isApproved:
false`", using the same `NotFoundException` body so an
anonymous caller cannot probe the existence of unapproved
rows. The public list (`GET /api/v1/reviews`) filters to
`isApproved: true` only. The toggle and delete endpoints
are admin-only and return 404 ONLY on truly missing rows
— the existence-leak guard does NOT apply to admin.

**Documented asymmetry.** `POST /api/v1/reviews/:id/comments`
returns 404 ONLY on a truly missing parent — it does NOT
404 on an unapproved parent (returns `201` and persists
the comment with `isApproved: false`). This is a
deliberate spec decision: lets a visitor comment on an
unapproved review so the comment is in place if/when the
admin approves the parent.

| Endpoint | 404 on missing | 404 on unapproved |
| --- | --- | --- |
| `GET /api/v1/reviews` | n/a | n/a (filters out) |
| `GET /api/v1/reviews/:id/comments` | yes | yes |
| `POST /api/v1/reviews/:id/comments` | yes | **no** (returns 201) |

The POST asymmetry is a mild existence leak bounded by
the throttler (5 POSTs per 60s per IP). The spec scenario
"Missing parent review returns 404" does not extend to
unapproved parents — this design honors the spec
verbatim. The DBML and `server_specs.md` are NOT
modified in this slice to close the leak (a follow-up
can).

### ADR-12: Error envelope — inherit from `global-exception-filter`

Every 4xx and 5xx response (400 from `ValidationPipe`,
401 from `JwtAuthGuard`, 404 from `NotFoundException`,
429 from `ThrottlerException`) flows through the global
`AllExceptionsFilter` registered in `main.ts`. The body
shape is the canonical envelope
`{ statusCode, error, message, timestamp, path }`. The
reviews domain adds NO new envelope shape and NO new
filter. The `Retry-After` header is set automatically by
`@nestjs/throttler` on the 429 response; the filter does
NOT strip it.

### ADR-13: Seed CLI — mirror `seed-projects.ts` with `SEED_DRY_RUN`

`src/cli/seed-reviews.ts` is a standalone `ts-node`
script. Imports `AppDataSource` from `src/data-source.ts`,
initializes it, calls the pure
`seedReviews({ reviewRepo, commentRepo })` function, and
destroys the connection. The pure function takes the two
repositories as parameters (so the unit suite passes Jest
fakes). The `SEED_DRY_RUN=1` env flag short-circuits to
the intended shape WITHOUT touching the repositories.
`package.json` adds
`"seed:reviews": "ts-node src/cli/seed-reviews.ts"`. The
script exits non-zero on failure. It is NOT wired into
`npm run start:prod`. Seed shape: 3 approved reviews + 2
pending reviews, each with 0-2 sample comments; all
comment rows have `isApproved: false` (per locked #3).

### ADR-14: Migration strategy — hand-written, idempotent where possible

The migration is hand-written
(`src/database/migrations/<ts>-create-reviews-and-review-comments.ts`)
and follows the precedent in
`20260618205116-create-projects-and-project-urls.ts`. The
`is_approved` column on `review_comments` uses
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (Postgres
9.6+). The `CREATE TABLE` statements are NOT idempotent
(a re-run would error on "relation already exists") —
the dev workflow is `migration:revert` + `migration:run`.
The migration is registered via the existing
`migrations: [join(process.cwd(), "src/database/migrations/*.{ts,js}")]`
glob in `data-source.ts` — no new wiring needed.

### ADR-15: Commit chunking — `apply-progress` markers, no chained PRs

~18 single-file commits on `domains/reviews`
(trunk-based). No PRs. No work branches. Each commit
leaves the repo green
(`npm run lint && npm test && npm run build` passes).
The `apply-progress.md` log is appended with an entry
per commit. Chained PRs are explicitly rejected
(user-locked: "NO work branches, NO PRs"). The
`apply-progress.md` markers are the orchestrator's
review trail — they replace the PR review cycle with a
linear commit log.

## TypeORM Data Model

### `ReviewEntity` — `src/reviews/entities/review.entity.ts`

Mirrors the `reviews` table in `database-schema.dbml`
(lines 39-47). 7 columns. No FK. No discriminator.

| DBML column | TypeORM decorator | Notes |
| --- | --- | --- |
| `id uuid pk default uuid_generate_v4()` | `@PrimaryGeneratedColumn("uuid")` `id: string` | |
| `author_name varchar default 'Anónimo'` | `@Column({ name: "author_name", type: "varchar", default: () => "'Anónimo'" })` `authorName: string` | DTO also defaults to `'Anónimo'`. |
| `author_role varchar` (nullable) | `@Column({ name: "author_role", type: "varchar", nullable: true })` `authorRole: string \| null` | Free text; PII risk (Risk #5). |
| `content text not null` | `@Column({ type: "text" })` `content: string` | 2 KB cap at DTO; no DB `VARCHAR(N)`. |
| `rating integer not null note 'Escala 1-5'` | `@Column({ type: "integer" })` `rating: number` | DTO enforces 1-5 (ADR-9). |
| `is_approved boolean default false` | `@Column({ name: "is_approved", type: "boolean", default: false })` `isApproved: boolean` | Public list filters to `true`. |
| `created_at timestamp default now()` | `@CreateDateColumn({ name: "created_at" })` `createdAt: Date` | No `updated_at`. |
| **one-to-many to `review_comments`** | `@OneToMany(() => ReviewCommentEntity, (c) => c.review) comments: ReviewCommentEntity[]` | NOT eager-loaded on the public list. |

### `ReviewCommentEntity` — `src/reviews/entities/review-comment.entity.ts`

Mirrors the `review_comments` table (DBML lines 49-55) PLUS
`is_approved` from locked #3.

| DBML column | TypeORM decorator | Notes |
| --- | --- | --- |
| `id uuid pk default uuid_generate_v4()` | `@PrimaryGeneratedColumn("uuid")` `id: string` | |
| `review_id uuid ref > reviews.id not null` | `@ManyToOne(() => ReviewEntity, (r) => r.comments, { onDelete: "CASCADE" })` `review: ReviewEntity` + `@JoinColumn({ name: "review_id" })` `reviewId: string` | FK + CASCADE (ADR-8). |
| `author_name varchar default 'Anónimo'` | `@Column({ name: "author_name", type: "varchar", default: () => "'Anónimo'" })` `authorName: string` | |
| `content text not null` | `@Column({ type: "text" })` `content: string` | 1 KB cap at DTO. |
| `created_at timestamp default now()` | `@CreateDateColumn({ name: "created_at" })` `createdAt: Date` | No `updated_at`. |
| **`is_approved boolean default false`** | `@Column({ name: "is_approved", type: "boolean", default: false })` `isApproved: boolean` | NOT in DBML today; lands at archive. |

## DTO Inventory

All under `src/reviews/dto/`. `@ApiProperty` on every
field. Body DTOs use no `@Type(() => Number)` (no numeric
body fields); query DTOs use `@Type(() => Number)` /
`@Type(() => Boolean)` per `bootstrap-api-config` ADR-2
and the `list-projects-query.dto.ts` precedent. NO
`UpdateReviewDto` (locked #8 — the scaffold stub is
deleted).

### `CreateReviewDto`

`authorName?: string` (`@IsString @IsOptional @MaxLength(100)`);
`authorRole?: string` (`@IsString @IsOptional @MaxLength(120)`);
`content: string` (`@IsString @IsNotEmpty @MinLength(10) @MaxLength(2_000)`);
`rating: number` (`@IsInt @Min(1) @Max(5) @IsNotEmpty`).
NO `projectId` / `ownerUserId` / `subjectType` (ADR-1).

### `CreateReviewCommentDto`

`authorName?: string` (`@IsString @IsOptional @MaxLength(100)`);
`content: string` (`@IsString @IsNotEmpty @MinLength(2) @MaxLength(1_000)`).

### `ListReviewsQueryDto`

`page?: number` (`@Type(() => Number) @IsInt @Min(1)`, default `1`);
`pageSize?: number` (`@Type(() => Number) @IsInt @Min(1) @Max(100)`, default `20`, silent cap to 100 at service);
`rating?: number` (`@Type(() => Number) @IsInt @Min(1) @Max(5)`);
`isApproved?: boolean` (`@Type(() => Boolean) @IsBoolean`; admin-only,
service ignores on public list, defaults to `true`).

### `ListCommentsQueryDto`

`page?: number` (default `1`);
`pageSize?: number` (default `20`, silent cap to 100 at service).

### Response DTOs

`ReviewResponseDto`: `id, authorName, authorRole, content,
rating, isApproved, createdAt`. No nested `comments`
field (a separate endpoint returns them — keeps the
list payload light).

`ReviewCommentResponseDto`: `id, reviewId, authorName,
content, isApproved, createdAt`. Public responses only
carry `isApproved: true` rows.

`ListReviewsResponseDto` / `ListCommentsResponseDto`:
the canonical envelope
`{ data: T[], total: number, page: number, pageSize: number }`,
mirroring `src/projects/dto/list-projects-response.dto.ts`.

## Service Layer

`ReviewsService` (`src/reviews/reviews.service.ts`) — the
8 public methods below. **No transactions needed** (no
DIFF, no cascading writes — Postgres `ON DELETE CASCADE`
handles the cascade per ADR-8). **No `withRetry` wrapper**
(no slug race; the throttler is per-route, not in the
service).

```ts
@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(ReviewEntity)        private readonly reviews: Repository<ReviewEntity>,
    @InjectRepository(ReviewCommentEntity) private readonly comments: Repository<ReviewCommentEntity>,
  ) {}

  // Public reads
  findAllApproved(query: ListReviewsQueryDto): Promise<ListReviewsResult>;
  findApprovedCommentsByReviewId(reviewId: string, query: ListCommentsQueryDto): Promise<ListCommentsResult>;

  // Public writes (validated by global pipe; throttled per-route)
  create(dto: CreateReviewDto): Promise<ReviewResponseDto>;
  addComment(reviewId: string, dto: CreateReviewCommentDto): Promise<ReviewCommentResponseDto>;

  // Admin
  findAllForAdmin(query: ListReviewsQueryDto): Promise<ListReviewsResult>;
  toggleApproval(id: string): Promise<ReviewResponseDto>;
  remove(id: string): Promise<void>;
}
```

### Responsibilities (one-line each)

- **`create`** — insert a new `ReviewEntity` with
  `isApproved: false`. No subject linkage (ADR-1). DB
  default `'Anónimo'` kicks in for `authorName` if the
  DTO omits it.
- **`findAllApproved`** — query the `reviews` table with
  `isApproved: true` default; filter by `?rating=` if
  supplied. Envelope shape (ADR-10). `pageSize > 100`
  silently clamped.
- **`findApprovedCommentsByReviewId`** — return the
  approved comments for a review (gated by
  `isApproved: true`, locked #3). 404 if the parent
  review is missing OR unapproved (existence-leak guard,
  ADR-11).
- **`addComment`** — insert a `ReviewCommentEntity`; 404
  if the parent review is missing. `isApproved: false`
  (locked #3). Does NOT 404 on unapproved parent
  (asymmetric existence-leak, ADR-11).
- **`findAllForAdmin`** — same envelope shape; default
  returns ALL reviews (approved + pending);
  `?isApproved=true|false` filters; `?rating=` supported.
- **`toggleApproval`** — read current `isApproved`, flip,
  save. Idempotent (called twice = original). 404 on
  missing.
- **`remove`** — `this.reviews.delete({ id })`. The FK
  CASCADE removes child comments (ADR-8). 404 if
  `affected === 0` (mirrors `ProjectsService.remove`).

## Controller Surface

### `ReviewsController` (`@Controller('reviews')`) — public

4 routes. All throttled per ADR-4.

| Route | Decorators | Throttler |
| --- | --- | --- |
| `POST /api/v1/reviews` | `@ApiOperation`, `@ApiResponse(201, ReviewResponseDto)`, `@ApiResponse(400)`, `@ApiResponse(429)` | `@ThrottledWrite()` (factory) |
| `GET /api/v1/reviews` | `@ApiOperation`, `@ApiQuery` for `page`/`pageSize`/`rating`, `@ApiResponse(200, ListReviewsResponseDto)`, `@ApiResponse(400)` | `@ThrottledRead()` |
| `POST /api/v1/reviews/:id/comments` | `@ApiResponse(201, ReviewCommentResponseDto)`, `@ApiResponse(400)`, `@ApiResponse(404)`, `@ApiResponse(429)` | `@ThrottledWrite()` |
| `GET /api/v1/reviews/:id/comments` | `@ApiResponse(200, ListCommentsResponseDto)`, `@ApiResponse(404)` | `@ThrottledRead()` |

`@ApiTags('reviews')` on the class. `ParseUUIDPipe` on
every `:id` (the scaffold's `+id` numeric coercion is
gone).

### `ReviewsAdminController` (`@Controller('admin/reviews')`) — protected

3 routes. Class-level `@UseGuards(JwtAuthGuard)
@ApiBearerAuth()` (per ADR-6). NO `@Throttle()` (per
ADR-4).

| Route | Decorators |
| --- | --- |
| `GET /api/v1/admin/reviews` | `@ApiOperation`, `@ApiQuery` for `page`/`pageSize`/`rating`/`isApproved`, `@ApiResponse(200, ListReviewsResponseDto)`, `@ApiResponse(400)`, `@ApiResponse(401)` |
| `PATCH /api/v1/admin/reviews/:id/approve` | `@ApiOperation`, `@ApiResponse(200, ReviewResponseDto)`, `@ApiResponse(400)`, `@ApiResponse(401)`, `@ApiResponse(404)` |
| `DELETE /api/v1/admin/reviews/:id` | `@ApiOperation`, `@HttpCode(204)`, `@ApiResponse(204)`, `@ApiResponse(400)`, `@ApiResponse(401)`, `@ApiResponse(404)` |

Class-level guard is preferred over per-method because
the entire controller is admin-only; a class-level
guard applies to every method uniformly and is harder
to forget on a new method.

## Throttler Integration

### `AppModule` — `src/app.module.ts`

```ts
import { ThrottlerModule } from "@nestjs/throttler";
// ...
@Module({
  imports: [
    // ... existing imports ...
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig>) => {
        const ttl   = config.get("REVIEWS_THROTTLE_TTL_MS",      { infer: true }) as number;
        const write = config.get("REVIEWS_THROTTLE_WRITE_LIMIT", { infer: true }) as number;
        return [{ name: "default", ttl, limit: write }];
      },
    }),
    // ... existing modules ...
  ],
})
export class AppModule {}
```

`ThrottlerGuard` is NOT registered as a global
`APP_GUARD` (ADR-2). The module-level tracker uses
`write` as the default `limit` (the safer of the two);
the read limit is consumed by the per-route decorator
factory below.

### `main.ts` — trust proxy

```ts
app.set("trust proxy", 1);  // ADR-5 — single reverse-proxy
```

Called BEFORE `useGlobalPipes(...)` and the CORS / Swagger
/ filter wiring.

### Per-route `@Throttle()` decorator factory

`src/reviews/throttle.decorator.ts` — the only way to
make the per-route `@Throttle()` decorator read env vars
at request time without re-deploying:

```ts
export function ThrottledWrite(): MethodDecorator {
  const limit = Number(process.env.REVIEWS_THROTTLE_WRITE_LIMIT ?? 5);
  const ttl   = Number(process.env.REVIEWS_THROTTLE_TTL_MS      ?? 60_000);
  return Throttle({ default: { limit, ttl } });
}
export function ThrottledRead(): MethodDecorator {
  const limit = Number(process.env.REVIEWS_THROTTLE_READ_LIMIT ?? 60);
  const ttl   = Number(process.env.REVIEWS_THROTTLE_TTL_MS     ?? 60_000);
  return Throttle({ default: { limit, ttl } });
}
```

The `process.env.*` direct read (NOT `ConfigService`) is
the only way to make the decorator work at request time
— the decorator factory runs at decoration time, before
the DI container is built. The fallback values match the
Joi defaults, so runtime behavior is identical to the
typed `ConfigService` read at module boot. The values are
still validated by Joi at boot via `ConfigModule`
validation.

### `env.config.ts` — three new Joi keys

```ts
export interface EnvConfig {
  // ... existing keys ...
  REVIEWS_THROTTLE_TTL_MS: number;
  REVIEWS_THROTTLE_WRITE_LIMIT: number;
  REVIEWS_THROTTLE_READ_LIMIT: number;
}

export const ENV_CONFIG = Joi.object<EnvConfig>({
  // ... existing keys ...
  REVIEWS_THROTTLE_TTL_MS:      Joi.number().integer().min(1_000).default(60_000),
  REVIEWS_THROTTLE_WRITE_LIMIT: Joi.number().integer().min(1).default(5),
  REVIEWS_THROTTLE_READ_LIMIT:  Joi.number().integer().min(1).default(60),
});
```

### `package.json` — one new dep + one new script

```jsonc
"dependencies": {
  // ... existing ...
  "@nestjs/throttler": "^6.x"
},
"scripts": {
  // ... existing ...
  "seed:reviews": "ts-node src/cli/seed-reviews.ts"
}
```

## Module Wiring

### `ReviewsModule` — `src/reviews/reviews.module.ts`

```ts
@Module({
  imports: [TypeOrmModule.forFeature([ReviewEntity, ReviewCommentEntity])],
  controllers: [ReviewsController, ReviewsAdminController],
  providers: [ReviewsService],
  exports: [ReviewsService],   // seed CLI consumes it
})
export class ReviewsModule {}
```

Mirrors `src/projects/projects.module.ts`. Exports
`ReviewsService` so the `seed-reviews.ts` CLI can import
the service directly without re-instantiating a Nest
application context.

### `AppModule`

No new module imports. `ThrottlerModule.forRootAsync` is
the only addition (see §Throttler Integration). The
`ReviewsModule` is already in the `imports` array.

### `data-source.ts`

Add `ReviewEntity, ReviewCommentEntity` to the `entities`
array:

```ts
entities: [
  UserEntity, RefreshTokenEntity,
  ProjectEntity, ProjectUrlEntity,
  ReviewEntity, ReviewCommentEntity,
],
```

The `migrations` glob
(`join(process.cwd(), "src/database/migrations/*.{ts,js}")`)
already picks up the new migration file.

## Migration Plan

**Yes** — `synchronize: false` means the schema is NOT
auto-mutated. The migration is hand-written (no live
Postgres in dev, per the projects precedent).

**File**:
`src/database/migrations/<ts>-create-reviews-and-review-comments.ts`
(the `<ts>` is UTC at apply time). Picked up by the
existing glob in `data-source.ts:22`.

**`up()` — canonical SQL:**

```sql
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
    ON DELETE CASCADE                              -- locked #4
);

-- Idempotent safety net for partial re-runs
ALTER TABLE "review_comments"
  ADD COLUMN IF NOT EXISTS "is_approved" boolean NOT NULL DEFAULT false;

CREATE INDEX "idx_reviews_is_approved"        ON "reviews"        ("is_approved");
CREATE INDEX "idx_review_comments_review_id"  ON "review_comments" ("review_id");
CREATE INDEX "idx_review_comments_is_approved" ON "review_comments" ("is_approved");
```

The `ADD COLUMN IF NOT EXISTS` is a belt-and-braces
guard against a partial re-run (e.g. Step 2 created the
table but `is_approved` was reverted). The CREATE
TABLE statements are NOT idempotent — dev workflow is
`migration:revert` + `migration:run` for re-application,
matching the projects precedent.

**`down()` — inverse of `up()`:**

```sql
DROP INDEX IF EXISTS "idx_review_comments_is_approved";
DROP INDEX IF EXISTS "idx_review_comments_review_id";
DROP INDEX IF EXISTS "idx_reviews_is_approved";
DROP TABLE IF EXISTS "review_comments";
DROP TABLE IF EXISTS "reviews";
```

**Verification recipe** (comment block, mirrors
`20260618205116-create-projects-and-project-urls.ts`
lines 9-16):

```bash
docker run --rm -d --name pg-verify -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
  npx typeorm schema:log src/data-source.ts
DATABASE_URL=... npx typeorm migration:run
DATABASE_URL=... npx typeorm migration:revert
```

## Seed CLI

`src/cli/seed-reviews.ts` — pure-function shape, mirrors
`src/cli/seed-projects.ts`. The pure function takes the
two repositories as parameters; the I/O wrapper owns the
`AppDataSource` lifecycle.

```ts
export interface SeedReviewsDeps {
  reviewRepo:  Repository<ReviewEntity>;
  commentRepo: Repository<ReviewCommentEntity>;
}
export interface SeedReviewsSummary {
  reviews:  Array<{ id: string; authorName: string; isApproved: boolean }>;
  comments: Array<{ id: string; reviewId: string; isApproved: boolean }>;
}
export async function seedReviews(deps: SeedReviewsDeps): Promise<SeedReviewsSummary>;
```

`SEED_DRY_RUN=1` short-circuits the function to return
the intended shape WITHOUT touching the repos. The
`package.json` script is
`"seed:reviews": "ts-node src/cli/seed-reviews.ts"`. The
script is NOT wired into `npm run start:prod`. Seed
shape: 3 approved reviews + 2 pending reviews, 0-2
comments per review; all comment rows have
`isApproved: false` (locked #3).

## Out of Scope (explicit)

Restated from the proposal §Out-of-Scope. Admin moderation
of comments (`PATCH /admin/reviews/:commentId/approve`);
editing a review after submission (no
`PATCH /reviews/:id`, no `PATCH /admin/reviews/:id` — the
`UpdateReviewDto` is deleted, locked #8); reply threading
on comments (flat list only); email notification on new
review (no Resend dispatch); full-text search / ranking
/ sentiment; per-`author_name` rate-limit, CAPTCHA, IP
capture, `author_email` capture (locked #2 — the
throttler is the only anti-spam layer); GDPR retention,
anonymisation, soft delete; multi-language / i18n;
polymorphic "subject" (locked #1); caching (HTTP, Redis,
in-memory); DB-level CHECK on `rating` 1-5 (DTO only,
ADR-9); Redis-backed throttler storage (in-memory only);
auto-approval of comments when parent is approved
(ADR-7); `@nestjs/throttler` as `APP_GUARD` (ADR-2);
`findOneApprovedById` public read controller route (the
service method stays, the controller route is a
follow-up). Design-specific additions: no
`?redactPii=true` flag on the public list (clarifier #5
default is "return as-is"); no auto-approval of comments;
no soft delete.

## Test Strategy

Strict TDD. Every spec scenario maps to one `it()` block
in either a colocated `*.spec.ts` or the e2e file.

### Unit (colocated `*.spec.ts`)

| File | What it covers | Mocking |
| --- | --- | --- |
| `entities/review.entity.spec.ts` | `@Entity('reviews')`; 7 columns; `authorName` default `'Anónimo'`; `authorRole` nullable; `content` NOT NULL; `isApproved` default `false`; one-to-many to `ReviewCommentEntity`; NO `projectId` / `ownerUserId` / `subjectType`. | `getMetadataArgsStorage()` — no DB. |
| `entities/review-comment.entity.spec.ts` | `@Entity('review_comments')`; columns incl. `isApproved`; `ManyToOne` to `ReviewEntity`; `JoinColumn` named `review_id`; `onDelete: 'CASCADE'`. | Same. |
| `dto/create-review.dto.spec.ts` | happy path; missing `content`/`rating` → 400; `rating: 6` / `rating: 0` → 400; `content: 'x'` (<10) → 400; `content: 'x'.repeat(2001)` → 400; `authorName` / `authorRole` over-length → 400; unknown field `projectId` / `subjectType` → 400 (`forbidNonWhitelisted`; the ADR-1 DTO proof). | `validate(dto)` with the global pipe options. |
| `dto/create-review-comment.dto.spec.ts` | happy path; missing `content` → 400; `content: 'x'` (<2) → 400; `content: 'x'.repeat(1001)` → 400; `authorName` over-length → 400. | Same. |
| `dto/list-reviews-query.dto.spec.ts` | `?page=2&pageSize=5` → `{ page: 2, pageSize: 5 }`; `?rating=5` → `{ rating: 5 }`; `?isApproved=true|false` → coerced bool; `?page=0` / `?pageSize=0` → 400. | Same. |
| `dto/list-comments-query.dto.spec.ts` | `?page=2&pageSize=5` → coerced; `?page=0` → 400; `?pageSize=500` accepted by DTO (service-level silent cap, mirrors `list-projects-query.dto.spec.ts`). | Same. |
| `review-response.mapper.ts` (colocated) | `toReviewResponse(row)` maps all fields; `comments` defaults to `[]` when relation not loaded; `toReviewCommentResponse(row)` maps all fields. | Pure function. |
| `reviews.service.spec.ts` | `create` — persists with `isApproved: false`; `findAllApproved` — defaults `isApproved: true`; `?rating=5` filter; `pageSize > 100` clamped; envelope shape; `findApprovedCommentsByReviewId` — returns approved only; 404 on missing parent; 404 on unapproved parent (no leak); `addComment` — persists with `isApproved: false`; 404 on missing parent; NOT 404 on unapproved parent (asymmetric); `findAllForAdmin` — returns all; `?isApproved` filter; `toggleApproval` — flips; idempotent; 404 on missing; `remove` — cascade to comments (mocked `comments.delete` is NOT called — the FK CASCADE does the work); 404 on missing. | Fake repos via `getRepositoryToken`; no `DataSource` injection. |
| `reviews.controller.spec.ts` | 4 routes; status codes; per-route `@Throttle()` is present (asserted by source read); Swagger padlock NOT present; `ParseUUIDPipe` on `:id` (non-uuid returns 400); `@ApiTags('reviews')` on class. | `Test.createTestingModule` with controller + service + fake repos; `ThrottlerModule.forRoot([{ ttl: 1_000, limit: 1_000_000 }])` so throttler is a no-op. |
| `reviews-admin.controller.spec.ts` | 3 routes; status codes; class-level `@UseGuards(JwtAuthGuard)` (asserted by source read); `@ApiBearerAuth()` on class; NO `@Throttle()` on any method (asserted by source read). | Same. |
| `reviews.module.spec.ts` | Static contract: `TypeOrmModule.forFeature([ReviewEntity, ReviewCommentEntity])`; providers `ReviewsService`; controllers `ReviewsController, ReviewsAdminController`; exports `ReviewsService`. | Static source read (mirror `projects.module.spec.ts`). |
| `throttle.decorator.spec.ts` | `ThrottledWrite()` binds `REVIEWS_THROTTLE_WRITE_LIMIT` + `REVIEWS_THROTTLE_TTL_MS`; `ThrottledRead()` binds read limit; env-var defaults match Joi defaults (`5` / `60` / `60_000`). | Pure function. |
| `cli/seed-reviews.spec.ts` | `seedReviews({ reviewRepo, commentRepo })` with `SEED_DRY_RUN=1` does NOT touch repos and returns the intended shape; with flag unset, inserts 3 approved + 2 pending reviews and 1-2 comments per review; comment rows have `isApproved: false`; I/O wrapper (not unit-tested) opens/closes `AppDataSource`. | Mirror `cli/seed-projects.spec.ts`. |
| `common/filters/all-exceptions.filter.spec.ts` (extension) | New test: `ThrottlerException → 429` renders canonical envelope; `Retry-After` header present. | Same as existing filter spec. |
| `app.module.spec.ts` (extension) | New static: `app.module.ts` does NOT match `/APP_GUARD[\s\S]*ThrottlerGuard/`; `data-source.ts` matches `entities: [...]` containing `ReviewEntity, ReviewCommentEntity`; `env.config.ts` matches three `REVIEWS_THROTTLE_*` Joi keys; `main.ts` matches `app.set\(['"]trust proxy['"],\s*1\)`. | Same. |
| `main.spec.ts` (extension) | `configureApp` test asserts `app.set('trust proxy', 1)` is called before `useGlobalPipes(...)`. | Same. |

### E2E (`test/reviews.e2e-spec.ts` — new)

`process.env` stubbed at the top per `test/auth.e2e-spec.ts:1-12`.
The three new env vars are set to permissive values
(`TTL=1000`, `WRITE=1000000`, `READ=1000000`) so the
throttler is effectively disabled for most of the suite.
One targeted scenario flips the limits to the spec
defaults to assert the 429 behaviour. `@nestjs/typeorm`
mocked the same way (`test/auth.e2e-spec.ts:15-26`).
`Test.createTestingModule` builds the full app
(`ReviewsModule` + the two repos + `ThrottlerModule` +
global pipe + `useGlobalFilters(new AllExceptionsFilter(...))`).
`supertest` drives the HTTP surface. A `JwtService` is
instantiated with the test secret to mint bearer tokens
for the 3 protected cases (mirror
`test/projects.e2e-spec.ts`).

Scenarios (per the two spec files, in spec order):

1. `GET /api/v1/reviews` (public) — 200 + envelope
   `{ data: [], total: 0, page: 1, pageSize: 20 }`.
2. `GET /api/v1/reviews?rating=5` — 200; only `rating: 5`.
3. `GET /api/v1/reviews?pageSize=500` — 200; `pageSize: 100`
   (silently clamped).
4. `GET /api/v1/reviews?page=0` — 400.
5. `POST /api/v1/reviews` no body — 400.
6. `POST /api/v1/reviews` with `content: 'too short'`
   (<10 chars) — 400.
7. `POST /api/v1/reviews` with `rating: 6` — 400.
8. `POST /api/v1/reviews` with `projectId: '...'` (unknown
   field) — 400 (`forbidNonWhitelisted`; the ADR-1 HTTP
   proof).
9. `POST /api/v1/reviews` with valid body — 201 +
   `ReviewResponseDto` with `isApproved: false`.
10. `GET /api/v1/reviews` after #9 — 200; the new row is
    NOT in `data` (unapproved).
11. `GET /api/v1/admin/reviews` without bearer — 401.
12. `GET /api/v1/admin/reviews` with bearer — 200; the
    new row IS in `data`.
13. `PATCH /api/v1/admin/reviews/:id/approve` without
    bearer — 401.
14. `PATCH /api/v1/admin/reviews/:id/approve` with bearer
    + valid id — 200; row now has `isApproved: true`.
15. `PATCH` called twice — 200; row has `isApproved: false`
    (idempotent).
16. `PATCH /api/v1/admin/reviews/not-a-uuid/approve` —
    400.
17. `PATCH /api/v1/admin/reviews/<unknown-uuid>/approve`
    — 404.
18. `GET /api/v1/reviews` after #14 — 200; the row IS in
    `data` (approved).
19. `GET /api/v1/reviews/:id/comments` on approved row —
    200; empty data.
20. `POST /api/v1/reviews/:id/comments` no body — 400.
21. `POST` with `content: 'x'` (<2 chars) — 400.
22. `POST` with valid body — 201 + `ReviewCommentResponseDto`
    with `isApproved: false`.
23. `GET /api/v1/reviews/:id/comments` after #22 — 200;
    the new comment is NOT in `data` (unapproved).
    Existence-leak guard: the parent is approved, so we
    return 200, not 404.
24. `GET /api/v1/reviews/<unknown-uuid>/comments` — 404
    (existence-leak guard on missing parent).
25. `GET /api/v1/reviews/<unapproved-review-uuid>/comments`
    — 404 (existence-leak guard on unapproved parent;
    same body as #24).
26. `POST /api/v1/reviews/<unknown-uuid>/comments` — 404
    (only on missing parent; the asymmetry).
27. `POST /api/v1/reviews/<unapproved-review-uuid>/comments`
    — 201 (the asymmetry; comment is in place, awaiting
    both the parent and the comment to be approved).
28. `DELETE /api/v1/admin/reviews/:id` without bearer —
    401.
29. `DELETE` with bearer + valid id — 204; row gone; child
    comments gone (FK CASCADE).
30. `DELETE /api/v1/admin/reviews/<unknown-uuid>` with
    bearer — 404.
31. Throttler shape — set `WRITE=2`; send 3
    `POST /api/v1/reviews` from same IP; 3rd returns 429
    with canonical envelope + `Retry-After` header.
32. Throttler shape — same for comment POST.
33. Throttler shape — admin routes NOT throttled; set
    `READ=1`; send 100 `GET /api/v1/admin/reviews` with
    valid bearer; all 100 return 200 or 401 (never 429).
34. Filter shape — every 4xx/5xx renders canonical
    envelope `{ statusCode, error, message, timestamp, path }`.

## DBML Implications

The DBML MUST change in ONE place at `sdd-archive` time
(per the projects-crud precedent):

- `review_comments` gains `is_approved boolean [default: false]`
  (after line 53 of `database-schema.dbml`).
- The FK on `review_comments.review_id` gains
  `note: 'ON DELETE CASCADE'`:

```
review_id uuid [ref: > reviews.id, not null, note: 'ON DELETE CASCADE']
```

(DBML 5.x has no `delete: cascade` syntax; the `note` is
the canonical way to express intent.) The `reviews` table
is unchanged. The `users`, `projects`, `project_urls`,
`contacts`, and `refresh_tokens` tables are unchanged.

## Implementation Sequence (commit order)

~18 single-file commits, trunk-based on `domains/reviews`.
Each commit leaves the repo green
(`npm run lint && npm test && npm run build` passes).
Commit messages follow conventional-commit style
(`git log --oneline domain/projects | head -50` for
reference). `apply-progress.md` is appended with an entry
per commit.

| # | Commit message | Files in commit | Spec coverage |
| --- | --- | --- | --- |
| 1 | `chore(reviews): add @nestjs/throttler dep + seed:reviews npm script` | `M package.json` | (infrastructure) |
| 2 | `feat(reviews): ReviewEntity + ReviewCommentEntity + entity specs` | `R review.entity.ts` `+ review-comment.entity.ts` `+ 2 specs` | reviews-domain: ReviewEntity (3), ReviewCommentEntity (2) |
| 3 | `feat(db): migration create-reviews-and-review-comments` | `+ <ts>-create-reviews-and-review-comments.ts` | ADR-7, ADR-8, ADR-14 |
| 4 | `feat(db): register ReviewEntity and ReviewCommentEntity in data-source` | `M data-source.ts` | reviews-domain: DataSource register |
| 5 | `feat(reviews): review-response.mapper` | `+ review-response.mapper.ts` | (internal) |
| 6 | `feat(reviews): CreateReviewDto + CreateReviewCommentDto + specs` | `R create-review.dto.ts` `+ create-review-comment.dto.ts` `+ 2 specs` | reviews-domain: Submit Review (5) + Add Comment (4) + ADR-1 DTO proof |
| 7 | `feat(reviews): ListReviewsQueryDto + ListCommentsQueryDto + specs` | `+ 2 query DTOs` `+ 2 specs` | reviews-domain: List Approved (5) + List Comments (3) |
| 8 | `feat(reviews): ReviewResponseDto + ReviewCommentResponseDto + envelopes` | `+ 4 response DTOs` | reviews-domain: Pagination Envelope (2) |
| 9 | `feat(reviews): ReviewsService (8 methods) + service spec` | `R reviews.service.ts` `R reviews.service.spec.ts` | reviews-domain: Toggle Approval (5) + Delete (3) + Existence-Leak (4) |
| 10 | `feat(reviews): ReviewsController (public, throttled) + spec` | `R reviews.controller.ts` `R reviews.controller.spec.ts` | reviews-domain: 4 public routes (HTTP shape) |
| 11 | `feat(reviews): ReviewsAdminController (protected) + spec` | `+ reviews-admin.controller.ts` `+ reviews-admin.controller.spec.ts` | reviews-domain: 3 admin routes (HTTP shape) |
| 12 | `feat(reviews): ReviewsModule (forFeature + 2 controllers + export)` | `R reviews.module.ts` `+ reviews.module.spec.ts` | reviews-domain: Module wiring |
| 13 | `chore(reviews): delete update-review.dto.ts stub (locked #8)` | `D update-review.dto.ts` | locked #8 |
| 14 | `feat(throttler): register ThrottlerModule.forRootAsync + trust proxy + 3 Joi keys` | `M app.module.ts` `M main.ts` `M env.config.ts` `+ throttle.decorator.ts` `+ throttle.decorator.spec.ts` | reviews-throttling: Module Reg (3) + Trust Proxy (2) + Joi (5) |
| 15 | `test(throttler): extend app.module.spec.ts + main.spec.ts + all-exceptions.filter.spec.ts` | `M 3 specs` | reviews-throttling: NOT APP_GUARD + 429 envelope + Retry-After |
| 16 | `test(reviews): e2e coverage of 7 routes + throttler shape` | `+ test/reviews.e2e-spec.ts` | every spec scenario e2e (34 total) |
| 17 | `chore(reviews): seed-reviews.ts CLI + spec` | `+ seed-reviews.ts` `+ seed-reviews.spec.ts` | (dev tool; ADR-13) |
| 18 | `docs(reviews): README endpoints table + throttler section` | `M README.md` | (docs) |

**LOC budget per commit (rough):** largest is commit
#16 (e2e, ~500 LOC — single test file, the review is
the spec scenarios, not the LOC count). All other
commits are ≤ 400 LOC, in line with the 400-line review
budget. The 400-line cap is exceeded only by the
cumulative change (~3,400 LOC total), mitigated by
`apply-progress` chunking (ADR-15).

## File Inventory

| # | File | Action | LOC | Commit # | Spec coverage |
| --- | --- | --- | --- | --- | --- |
| 1 | `package.json` | MOD | +5 | 1 | (dep) |
| 2 | `src/reviews/entities/review.entity.ts` | REPL | 80 | 2 | reviews-domain: ReviewEntity |
| 3 | `src/reviews/entities/review-comment.entity.ts` | NEW | 90 | 2 | reviews-domain: ReviewCommentEntity |
| 4 | `src/reviews/entities/review.entity.spec.ts` | NEW | 90 | 2 | (entity metadata) |
| 5 | `src/reviews/entities/review-comment.entity.spec.ts` | NEW | 100 | 2 | (entity metadata) |
| 6 | `src/database/migrations/<ts>-create-reviews-and-review-comments.ts` | NEW | 80 | 3 | ADR-7, ADR-8, ADR-14 |
| 7 | `src/data-source.ts` | MOD | +2 | 4 | DataSource register |
| 8 | `src/reviews/review-response.mapper.ts` | NEW | 50 | 5 | (internal) |
| 9-12 | `dto/create-review.dto.ts` + `dto/create-review-comment.dto.ts` + 2 specs | REPL/NEW | 255 | 6 | Submit Review (5) + Add Comment (4) + ADR-1 |
| 13-16 | `dto/list-reviews-query.dto.ts` + `dto/list-comments-query.dto.ts` + 2 specs | NEW | 260 | 7 | List Approved (5) + List Comments (3) |
| 17-20 | `dto/review-response.dto.ts` + `dto/review-comment-response.dto.ts` + 2 envelopes | NEW | 150 | 8 | Pagination Envelope (2) |
| 21 | `dto/update-review.dto.ts` | DEL | -4 | 13 | locked #8 |
| 22-23 | `reviews.service.ts` + `reviews.service.spec.ts` | REPL | 600 | 9 | Toggle (5) + Delete (3) + Existence-Leak (4) |
| 24-25 | `reviews.controller.ts` + `reviews.controller.spec.ts` | REPL | 230 | 10 | 4 public routes (HTTP) |
| 26-27 | `reviews-admin.controller.ts` + `reviews-admin.controller.spec.ts` | NEW | 210 | 11 | 3 admin routes (HTTP) |
| 28-29 | `reviews.module.ts` + `reviews.module.spec.ts` | REPL/NEW | 80 | 12 | Module wiring |
| 30-33 | `app.module.ts` + `main.ts` + `env.config.ts` + `throttle.decorator.ts` + spec | MOD/NEW | 200 | 14 | Module Reg + Trust Proxy + Joi |
| 34-36 | `app.module.spec.ts` + `main.spec.ts` + `all-exceptions.filter.spec.ts` | MOD | 55 | 15 | guard-rails + 429 envelope |
| 37 | `test/reviews.e2e-spec.ts` | NEW | 500 | 16 | every spec scenario (34) |
| 38-39 | `src/cli/seed-reviews.ts` + `seed-reviews.spec.ts` | NEW | 250 | 17 | (dev tool; ADR-13) |
| 40 | `README.md` | MOD | +60 | 18 | (docs) |
| 41 | `openspec/specs/database-schema.dbml` | MOD | +2 | (archive) | ADR-7 + ADR-8 |
| 42 | `openspec/specs/server_specs.md` | MOD | +30 | (archive) | §3.3 envelope + throttler + cascade |

**Total: ~3,375 LOC** (with tests); **~1,950 LOC**
non-test (lands in the middle of the proposal's
1,400-2,400 ballpark).

## Forecast

| Category | Files | LOC |
| --- | --- | --- |
| Entities (2) + specs (2) | 4 | ~360 |
| DTOs (8) + specs (4) | 12 | ~700 |
| Mapper (1) | 1 | ~50 |
| Service (1) + spec (1) | 2 | ~600 |
| Controller (public, 1) + spec (1) | 2 | ~230 |
| Controller (admin, 1) + spec (1) | 2 | ~210 |
| Module (1) + spec (1) | 2 | ~80 |
| Throttler integration (5 files + 3 spec extensions) | 8 | ~255 |
| Migration (1) | 1 | ~80 |
| Seed CLI (1) + spec (1) | 2 | ~250 |
| E2E spec (1) | 1 | ~500 |
| README | 1 | ~60 |
| **Subtotal — non-test code** | | **~1,950** |
| **Subtotal — test code** | | **~1,470** |
| **Total** | | **~3,420** |

The non-test subtotal (~1,950) lands in the middle of
the proposal's 1,400-2,400 ballpark. The with-tests total
(~3,420) is the strict-TDD reality.

## Risks and Mitigations

| # | Risk | Likelihood | Mitigation |
| --- | --- | --- | --- |
| 1 | Throttler env values are wrong (too permissive → spam, too strict → real users 429). | Med | The 3 new Joi keys have explicit defaults and `min(1)` / `min(1_000)` floors. The README documents each var. The e2e suite uses `1_000_000` to avoid interference except in the dedicated 429 scenarios. |
| 2 | `is_approved` migration re-run fails on `ADD COLUMN`. | Low | The migration uses `ADD COLUMN IF NOT EXISTS` (Postgres 9.6+). The `CREATE TABLE` statements are non-idempotent — dev workflow is `migration:revert` + `migration:run`. |
| 3 | `ON DELETE CASCADE` removes child comments silently — admin UI should warn before delete. | Med | The service does NOT log the cascade; the design adds a `Logger.log` debug line on the `remove` path. |
| 4 | DBML has no CHECK on `rating` 1-5; the DTO enforces it. | Low | ADR-9 — DTO only. A follow-up migration can add the CHECK if the user wants. |
| 5 | `author_role` free text is a minor PII leak. | Low | Documented per clarifier #5 (return as-is). A follow-up can add a `?redactPii=true` flag. |
| 6 | Throttler module is registered but `ThrottlerGuard` is NOT registered as `APP_GUARD`. A future route without `@Throttle()` is unthrottled. | Med | Static guard-rail in `app.module.spec.ts` asserts `ThrottlerGuard` is not in `APP_GUARD` providers. |
| 7 | Stub routes `GET /reviews/:id` and `PATCH /reviews/:id` are removed. If the frontend depends on them, it breaks. | Med | Confirmed by the explore (server_specs has no such routes; locked #8 is the explicit "REMOVE" verdict). The new controller has no `:id` GET or PATCH. |
| 8 | `content` 2000-char cap is much smaller than projects' 50,000. | Low | Reviews are short-form feedback (~300 words). Documented in the DTO comment. |
| 9 | The throttler uses `req.ip` which is wrong behind a reverse proxy without `trust proxy` set. | Med | `app.set('trust proxy', 1)` is set in `main.ts` (ADR-5). |
| 10 | The throttler is a runtime config; tests need the env vars set. | Low | `test/reviews.e2e-spec.ts` sets `process.env.REVIEWS_THROTTLE_*` to permissive values at the top. The unit spec uses `ThrottlerModule.forRoot([{ ttl: 1_000, limit: 1_000_000 }])`. The decorator factory falls back to the Joi defaults. |
| 11 | Two controllers share `ReviewsService` via DI; `Test.createTestingModule` for either must still provide `ReviewsService`. | Low | Each spec lists `ReviewsService` as a provider. The `app.module.spec.ts` extension adds the two entities to `TestFakesModule`. |
| 12 | The existence-leak asymmetry (POST 404 only on missing, GET 404 on missing OR unapproved) is a mild leak via POST. | Low | Documented in ADR-11. The leak is bounded by the throttler. The spec scenario explicitly accepts the asymmetry. |
| 13 | The throttler factory reads `process.env.*` directly, bypassing typed `ConfigService`. | Low | Fallback values match the Joi defaults, so runtime behavior is identical to the typed read at module boot. The values are still validated by Joi at boot. |
| 14 | The seed CLI is dev-only; if accidentally wired into `npm run start:prod`, it floods production. | Low | The seed is a standalone `ts-node` script (`npm run seed:reviews`), not a startup hook. The `seed-reviews.spec.ts` asserts dry-run does NOT touch repos. |
| 15 | Trust proxy = 1 is correct for a single reverse proxy. If the API is behind multiple proxies, `X-Forwarded-For` is exploitable. | Low | The explore report's deployment topology is a single edge proxy. A follow-up can switch to a more specific value. Documented in ADR-5. |

## Acceptance Criteria for `sdd-apply`

The change is done when:

- [ ] `npm run build` passes (TypeScript strict mode, no `any`).
- [ ] `npm test` passes (every colocated `*.spec.ts` is green;
      13 new + 5 extended spec files).
- [ ] `npm run test:e2e` passes (`test/reviews.e2e-spec.ts`
      covers all 7 routes + the 429 shape + the
      existence-leak + the FK CASCADE; 34 scenarios).
- [ ] `GET /api/v1/reviews` (public, throttled) returns
      `200` + envelope; only `isApproved: true` rows in
      `data`; `?rating=5` filters; `?pageSize=500`
      silently clamped to 100.
- [ ] `POST /api/v1/reviews` (public, throttled) without
      auth returns `201` with `isApproved: false`; 6th
      request inside 60s returns `429` with canonical
      envelope + `Retry-After` header.
- [ ] `POST /api/v1/reviews/:id/comments` (public,
      throttled) returns `201` with `isApproved: false`;
      missing parent returns `404`; unapproved parent
      returns `201` (asymmetric, ADR-11); 6th request
      returns `429`.
- [ ] `GET /api/v1/reviews/:id/comments` (public,
      throttled) returns `200` + envelope of
      `isApproved: true` comments; missing OR unapproved
      parent returns `404` (existence-leak guard).
- [ ] `GET /api/v1/admin/reviews` (protected) without
      bearer returns `401`; with bearer returns `200`;
      `?isApproved=true|false` filters; admin routes NOT
      throttled.
- [ ] `PATCH /api/v1/admin/reviews/:id/approve` (protected)
      without bearer returns `401`; with bearer + valid
      uuid returns `200`; idempotent; non-uuid returns
      `400`; missing returns `404`.
- [ ] `DELETE /api/v1/admin/reviews/:id` (protected)
      without bearer returns `401`; with bearer + valid
      uuid returns `204`; child `review_comments` rows
      removed by FK CASCADE (verified: `comments.delete`
      is NOT called; the DB does the cascade).
- [ ] Every `HttpException` body matches the canonical
      envelope; the `ThrottlerException → 429` case is
      covered.
- [ ] Swagger UI at `/api/v1/docs` lists `reviews` tag
      with 7 routes; the 3 admin routes show the bearer
      padlock.
- [ ] `src/data-source.ts` lists `ReviewEntity,
      ReviewCommentEntity`; `npm run build` resolves both.
- [ ] `src/app.module.ts` registers
      `ThrottlerModule.forRootAsync({ inject: [ConfigService],
      useFactory: ... })`; no `APP_GUARD` references
      `ThrottlerGuard` (asserted by the static guard-rail).
- [ ] `src/main.ts` calls `app.set('trust proxy', 1)`
      BEFORE `useGlobalPipes(...)` (asserted by
      `main.spec.ts`).
- [ ] `src/config/env.config.ts` adds the three
      `REVIEWS_THROTTLE_*` Joi keys with the spec defaults
      and floors.
- [ ] The migration is reversible via `down()`; the
      `is_approved` column add uses `ADD COLUMN IF NOT
      EXISTS`.
- [ ] The seed CLI (`npm run seed:reviews`) inserts 3
      approved + 2 pending reviews with 1-2 comments each;
      `SEED_DRY_RUN=1` short-circuits to a log without
      touching the DB.
- [ ] `package.json` adds `@nestjs/throttler` as a
      dependency and `seed:reviews` as a script.
- [ ] `README.md` has the Reviews endpoints table and the
      "Anti-spam (throttler)" subsection documenting the
      3 env vars and how to change the limits.
- [ ] `src/reviews/dto/update-review.dto.ts` is DELETED
      (locked #8).
- [ ] `apply-progress.md` is appended with one entry per
      commit (~18 entries); each entry names the task
      from `tasks.md`.
- [ ] `database-schema.dbml` is updated at `sdd-archive`
      time to add `is_approved` to `review_comments` and
      the `note: 'ON DELETE CASCADE'` on the FK.
- [ ] `server_specs.md` §3.3 is updated at `sdd-archive`
      time to reflect the envelope, the throttler
      section, the cascade contract, and the per-route
      limits.

## Recommended Next Step

`sdd-tasks` — produces a `tasks.md` file that breaks
this design's ~18 commits into ordered, testable, atomic
tasks. `sdd-apply` then executes the tasks commit-by-commit
with strict TDD (RED-first: spec → failing test →
implementation → passing test → refactor) and
`apply-progress.md` markers. `sdd-verify` runs the e2e
suite + the throttler-specific scenarios + the
existence-leak assertions + the FK CASCADE verification.
`sdd-archive` mirrors the DBML delta and the
`server_specs.md` §3.3 update.
