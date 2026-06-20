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
