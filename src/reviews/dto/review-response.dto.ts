import { ApiProperty } from "@nestjs/swagger";
import type { ReviewCommentResponseDto } from "./review-comment-response.dto";

/**
 * Single review in response bodies. The 7 fields mirror the
 * `ReviewEntity` (T2) at the API boundary:
 *   - `id`, `authorName`, `authorRole`, `content`, `rating`,
 *     `isApproved`, `createdAt`.
 *
 * The `comments` field is included in the DTO for forward
 * compatibility (a future "review with comments" read could use it),
 * but the public list path always returns `comments: []` because
 * the relation is not eager-loaded (per T5 mapper). The
 * `GET /:id/comments` route returns a separate response (the
 * comment list envelope).
 *
 * `ReviewCommentResponseDto` is added in T12; we type-import it
 * here so the field set is locked at the API surface.
 */
export class ReviewResponseDto {
	@ApiProperty({ format: "uuid" })
	id!: string;

	@ApiProperty({ maxLength: 100 })
	authorName!: string;

	@ApiProperty({ maxLength: 120, nullable: true })
	authorRole!: string | null;

	@ApiProperty({ maxLength: 2_000 })
	content!: string;

	@ApiProperty({ minimum: 1, maximum: 5 })
	rating!: number;

	@ApiProperty()
	isApproved!: boolean;

	@ApiProperty({
		type: [Object],
		description:
			"Inline comments (empty on list path; use GET /:id/comments for a paginated list)",
	})
	comments!: ReviewCommentResponseDto[];

	@ApiProperty({ format: "date-time" })
	createdAt!: Date;
}
