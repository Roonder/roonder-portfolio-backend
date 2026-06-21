import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * Query string of `GET /api/v1/reviews/:id/comments` (public).
 * Mirrors `ListReviewsQueryDto` shape (page / pageSize) — the
 * `rating` + `isApproved` filters are NOT in the comment list
 * (the list is implicitly filtered to `isApproved: true` via
 * ADR-7 + ADR-11).
 *
 * The pipe layer's `@Type(() => Number)` coerces the query
 * string `?page=2&pageSize=5` into numbers. The DTO's
 * `@Max(100)` is the wire-level guard for `pageSize > 100`
 * (returns 400); the service silently re-clamps if the DTO is
 * bypassed.
 */
export class ListCommentsQueryDto {
	@ApiPropertyOptional({ minimum: 1, default: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number;

	@ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	pageSize?: number;
}
