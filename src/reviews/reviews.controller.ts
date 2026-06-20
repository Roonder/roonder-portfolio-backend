import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ThrottledRead, ThrottledWrite } from "./throttle.decorator";
import { ReviewsService } from "./reviews.service";
import { CreateReviewDto } from "./dto/create-review.dto";
import { ListReviewsQueryDto } from "./dto/list-reviews-query.dto";
import { ReviewResponseDto } from "./dto/review-response.dto";
import { ListReviewsResponseDto } from "./dto/list-reviews-response.dto";

/**
 * Public Reviews surface.
 *
 * 2 routes (per the design's commit sequence at T9 — the 2
 * comment routes land in T14 on the SAME controller):
 *
 *   POST  /api/v1/reviews          — public, throttled write
 *   GET   /api/v1/reviews          — public, throttled read
 *
 * Both routes are throttled per-route via the per-route
 * `@ThrottledWrite()` / `@ThrottledRead()` factories (ADR-4,
 * ADR-5). `ThrottlerGuard` is NOT registered as a global
 * `APP_GUARD` — verified by the static guard-rail in
 * `src/app.module.spec.ts`. The 3 admin routes
 * (`/admin/reviews/*`) live on `ReviewsAdminController` and
 * carry no `@Throttle()` decorator.
 *
 * 4xx/5xx are NOT declared per route beyond the success shape
 * (and the documented 400 / 429 cases on the public write path);
 * the canonical envelope is the global exception filter's job
 * (verified at T15 + T16).
 *
 * The previous scaffold's numeric-id coercion bug is GONE
 * (locked #6). The 2 T9 routes do not take an `:id` param at
 * all; the 2 T14 comment routes will use `ParseUUIDPipe`. The
 * `src/reviews/reviews.controller.spec.ts` static assertion
 * `NO numeric id coercion` is the guard rail.
 */
@ApiTags("reviews")
@Controller("reviews")
export class ReviewsController {
	constructor(private readonly reviews: ReviewsService) {}

	@Post()
	@ThrottledWrite()
	@ApiOperation({
		summary: "Submit a new review (public, persists with isApproved=false)",
	})
	@ApiResponse({
		status: 201,
		description: "The created review body (isApproved=false)",
		type: ReviewResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid body" })
	@ApiResponse({ status: 429, description: "Throttled" })
	create(@Body() dto: CreateReviewDto) {
		return this.reviews.create(dto);
	}

	@Get()
	@ThrottledRead()
	@ApiOperation({
		summary: "List approved reviews (public, paginated, filterable)",
	})
	@ApiResponse({
		status: 200,
		description: "Envelope of approved reviews matching the filters",
		type: ListReviewsResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid query parameters" })
	findAllApproved(@Query() query: ListReviewsQueryDto) {
		return this.reviews.findAllApproved(query);
	}
}
