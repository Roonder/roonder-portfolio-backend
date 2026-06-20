import { ApiProperty } from "@nestjs/swagger";

/**
 * Single comment in response bodies. The 6 fields mirror the
 * `ReviewCommentEntity` (T2) at the API boundary:
 *   - `id`, `reviewId`, `authorName`, `content`,
 *     `isApproved`, `createdAt`.
 *
 * `isApproved` is included so a future admin moderation queue
 * can render the flag without a second round-trip. Public
 * readers always see `isApproved: true` on returned rows (the
 * service filters at the query level per ADR-7 + ADR-11).
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
