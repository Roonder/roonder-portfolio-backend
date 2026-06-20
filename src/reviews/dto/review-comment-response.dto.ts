import { ApiProperty } from "@nestjs/swagger";

/**
 * Single comment in response bodies. The 6 fields mirror the
 * `ReviewCommentEntity` (T2) at the API boundary:
 *   - `id`, `reviewId`, `authorName`, `content`,
 *     `isApproved`, `createdAt`.
 *
 * NOTE: This is the minimal stub added in T11 to unblock the
 * build. The `T12` task replaces this with the full
 * `ReviewCommentResponseDto` deliverable + the
 * `create-review-comment.dto.spec.ts` +
 * `list-comments-query.dto.spec.ts` + the comment list envelope
 * + the 4 DTOs that share this file's neighbors. The T12 commit
 * will overwrite this file with the final version.
 */
export class ReviewCommentResponseDto {
	@ApiProperty({ format: "uuid" })
	id!: string;

	@ApiProperty({ format: "uuid" })
	reviewId!: string;

	@ApiProperty({ maxLength: 100 })
	authorName!: string;

	@ApiProperty({ maxLength: 1_000 })
	content!: string;

	@ApiProperty()
	isApproved!: boolean;

	@ApiProperty({ format: "date-time" })
	createdAt!: Date;
}
