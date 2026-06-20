import {
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Patch,
	Query,
	UseGuards,
} from "@nestjs/common";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiQuery,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ReviewsService } from "./reviews.service";
import { ListReviewsQueryDto } from "./dto/list-reviews-query.dto";
import { ReviewResponseDto } from "./dto/review-response.dto";
import { ListReviewsResponseDto } from "./dto/list-reviews-response.dto";

/**
 * Admin Reviews surface.
 *
 * 3 routes (per the design's commit sequence at T10 — public
 * routes are on `ReviewsController`):
 *
 *   GET    /api/v1/admin/reviews                — protected
 *   PATCH  /api/v1/admin/reviews/:id/approve    — protected
 *   DELETE /api/v1/admin/reviews/:id            — protected
 *
 * All 3 routes are class-level `@UseGuards(JwtAuthGuard)`
 * (per ADR-6) and carry `@ApiBearerAuth()` for Swagger. No
 * throttler decorator on any method — the admin routes are
 * intentionally unthrottled (per ADR-4; the spec scenario
 * "Admin routes are NOT throttled" is covered by the static
 * assertion in the controller's spec).
 *
 * `:id` is the review's internal uuid — `ParseUUIDPipe`
 * validates the format and returns 400 for anything that is
 * not a uuid (locked #6). The previous scaffold's numeric-id
 * coercion bug is GONE.
 *
 * 4xx/5xx responses are NOT declared per route beyond the
 * success shape; the canonical envelope is the global exception
 * filter's job (verified at T15 + T16).
 */
@ApiTags("reviews")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("admin/reviews")
export class ReviewsAdminController {
	constructor(private readonly reviews: ReviewsService) {}

	@Get()
	@ApiOperation({
		summary: "List all reviews (admin, paginated, filterable)",
	})
	@ApiQuery({ name: "page", required: false, type: Number })
	@ApiQuery({ name: "pageSize", required: false, type: Number })
	@ApiQuery({ name: "rating", required: false, type: Number })
	@ApiQuery({ name: "isApproved", required: false, type: Boolean })
	@ApiResponse({
		status: 200,
		description: "Envelope of reviews (approved + pending by default)",
		type: ListReviewsResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid query parameters" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	findAllForAdmin(@Query() query: ListReviewsQueryDto) {
		return this.reviews.findAllForAdmin(query);
	}

	@Patch(":id/approve")
	@ApiOperation({
		summary: "Toggle review approval (admin, idempotent)",
	})
	@ApiResponse({
		status: 200,
		description: "The updated review body (isApproved flipped)",
		type: ReviewResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid id (non-uuid)" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	@ApiResponse({ status: 404, description: "Review not found" })
	toggleApproval(@Param("id", ParseUUIDPipe) id: string) {
		return this.reviews.toggleApproval(id);
	}

	@Delete(":id")
	@HttpCode(204)
	@ApiOperation({
		summary:
			"Delete a review (admin, cascades to review_comments via FK CASCADE)",
	})
	@ApiResponse({ status: 204, description: "Review deleted" })
	@ApiResponse({ status: 400, description: "Invalid id (non-uuid)" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	@ApiResponse({ status: 404, description: "Review not found" })
	remove(@Param("id", ParseUUIDPipe) id: string) {
		return this.reviews.remove(id);
	}
}
