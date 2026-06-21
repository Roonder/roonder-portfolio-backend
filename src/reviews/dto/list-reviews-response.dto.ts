import { ApiProperty } from "@nestjs/swagger";
import { ReviewResponseDto } from "./review-response.dto";

/**
 * Plain result interface for the service's list methods. The
 * service returns this (NOT a class instance) so the controller
 * wraps it in `ListReviewsResponseDto` for the response body. The
 * interface keeps the service signature stable without forcing a
 * class construction at every call.
 */
export interface ListReviewsResult {
	data: ReviewResponseDto[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * Envelope for `GET /api/v1/reviews` and `GET /api/v1/admin/reviews`.
 * Shape is locked by the spec scenario
 * "Envelope shape is consistent across public and admin lists":
 * `{ data, total, page, pageSize }`. `total` is the count of rows
 * that matched the filter, NOT the length of `data` (which is
 * capped at `pageSize`).
 */
export class ListReviewsResponseDto implements ListReviewsResult {
	@ApiProperty({ type: [ReviewResponseDto] })
	data!: ReviewResponseDto[];

	@ApiProperty({ minimum: 0 })
	total!: number;

	@ApiProperty({ minimum: 1, default: 1 })
	page!: number;

	@ApiProperty({ minimum: 1, maximum: 100, default: 20 })
	pageSize!: number;
}
