# Apply Progress — reviews-domain

**Change**: reviews-domain
**Branch**: domains/reviews
**Strategy**: trunk-based + apply-progress chunking (user choice 2026-06-19, option A)
**Strict TDD**: ACTIVE
**Started**: 2026-06-19

- [x] T1 — add @nestjs/throttler dep + 3 Joi keys + seed:reviews script — 0614d6e — 60 + 44
- [x] T2 — ReviewEntity + ReviewCommentEntity + 2 entity specs — 6581d54 — 130 + 192
- [x] T3 — migration create-reviews-and-review-comments (FK CASCADE + 3 indexes + ADD COLUMN IF NOT EXISTS) — cd34688 — 91 + 0 (TDD-exempt: SQL is the artifact)
- [x] T4 — register ReviewEntity + ReviewCommentEntity in AppDataSource — fb1cd6c — 24 + 2
- [x] T5 — review-response.mapper (toReviewResponse + toReviewCommentResponse) — 5acfa60 — 64 + 105
- [x] T6 — ThrottlerModule.forRootAsync + ThrottledWrite/Read decorator factory — 4c50315 — 35 + 159
- [x] T7 — CreateReviewDto + ListReviewsQueryDto + ReviewResponseDto + envelope — a6468d6 — 110 + 219
- [x] T8a — ReviewsService v1 (constructor + create) with isApproved=false default — 5a65ffe — 70 + 203
- [x] T8b — ReviewsService.findAllApproved + findAllForAdmin (isApproved filter + 100-clamp + envelope) — efba832 — 56 + 199
- [x] T8c — ReviewsService.toggleApproval + remove (NotFoundException 404 + FK CASCADE contract) — 3a398ce — 27 + 188
- [x] T9 — ReviewsController v1 (POST + GET /reviews with throttling, no +id bug) — 1799d9b — 89 + 264
- [x] T10 — ReviewsAdminController (3 protected routes, class-level JwtAuthGuard, no throttler) — 5ad2d6b — 96 + 248
- [x] T11 — ReviewsModule wire (forFeature + 2 controllers + service export) + TestFakesModule extension — 702dedd — 56 + 134
- [x] T12 — comment DTOs (Create + ListQuery + ReviewCommentResponse + envelope) + 4 specs — ebc1fed — 76 + 124
- [x] T13 — ReviewsService.addComment + findApprovedCommentsByReviewId (asymmetric existence-leak guard) — 0c381cf — 117 + 246
- [x] T14 — ReviewsController comment routes (POST + GET /:id/comments, throttled + ParseUUIDPipe) — 4ef276a — 76 + 105
- [x] T15 — delete update-review.dto.ts + app.set('trust proxy', 1) in main.ts + 3 spec extensions (filter 429 + trust proxy + entities guard) — 9bdec4b — 60 + 53
- [x] T16a — e2e harness + 10 public review routes (in-memory review repo + QueryBuilder shim) — b67719c — 0 + 500
- [x] T16b — e2e admin routes (5 list + 5 toggle + 4 delete + 1 filter) + FK CASCADE contract — b673710 — 0 + 277
- [x] T16c — e2e comment routes (7 add + 3 list + 3 throttler-shape) + asymmetric existence-leak — 239689b — 0 + 422
