import type { ReviewEntity } from "./entities/review.entity";
import type { ReviewCommentEntity } from "./entities/review-comment.entity";

/**
 * Entity → response DTO mappers for the reviews domain. Pure
 * functions, no side effects. The mapper is the single point where
 * the response shape is decided — controllers and tests consume the
 * same shape via the response DTO classes (added in T7 for
 * `ReviewResponseDto` and T12 for `ReviewCommentResponseDto`).
 *
 * `comments` defaults to `[]` on `toReviewResponse` when the
 * one-to-many relation is not eager-loaded (the public list path —
 * `findAllApproved` and `findAllForAdmin` do NOT join `comments`).
 * The public `GET /:id/comments` route returns a separate response
 * (the comment list envelope), so the inline `comments` field on
 * a review body is always `[]` in this slice of the API.
 *
 * The mapper takes the entity types as input and returns plain
 * objects with the documented field set. The DTO classes (added in
 * later tasks) declare the same field set via `@ApiProperty`, so
 * the structural contract is identical and the runtime values are
 * assignment-compatible.
 */
export function toReviewResponse(row: ReviewEntity): {
	id: string;
	authorName: string;
	authorRole: string | null;
	content: string;
	rating: number;
	isApproved: boolean;
	createdAt: Date;
	comments: Array<{
		id: string;
		reviewId: string;
		authorName: string;
		content: string;
		isApproved: boolean;
		createdAt: Date;
	}>;
} {
	return {
		id: row.id,
		authorName: row.authorName,
		authorRole: row.authorRole,
		content: row.content,
		rating: row.rating,
		isApproved: row.isApproved,
		createdAt: row.createdAt,
		comments: (row.comments ?? []).map(toReviewCommentResponse),
	};
}

export function toReviewCommentResponse(row: ReviewCommentEntity): {
	id: string;
	reviewId: string;
	authorName: string;
	content: string;
	isApproved: boolean;
	createdAt: Date;
} {
	return {
		id: row.id,
		reviewId: row.reviewId,
		authorName: row.authorName,
		content: row.content,
		isApproved: row.isApproved,
		createdAt: row.createdAt,
	};
}
