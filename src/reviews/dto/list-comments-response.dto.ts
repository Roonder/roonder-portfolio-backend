import { ApiProperty } from "@nestjs/swagger";
import { ReviewCommentResponseDto } from "./review-comment-response.dto";

/**
 * Envelope for `GET /api/v1/reviews/:id/comments`. Same
 * `{ data, total, page, pageSize }` shape as the review list
 * envelope (per the spec scenario "Envelope shape is consistent
 * across public and admin lists" — the comment list is
 * implicitly consistent with the review list).
 */
export class ListCommentsResponseDto {
	@ApiProperty({ type: [ReviewCommentResponseDto] })
	data!: ReviewCommentResponseDto[];

	@ApiProperty({ minimum: 0 })
	total!: number;

	@ApiProperty({ minimum: 1, default: 1 })
	page!: number;

	@ApiProperty({ minimum: 1, maximum: 100, default: 20 })
	pageSize!: number;
}
