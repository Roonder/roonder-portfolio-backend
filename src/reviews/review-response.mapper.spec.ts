import {
	toReviewResponse,
	toReviewCommentResponse,
} from "./review-response.mapper";
import type { ReviewEntity } from "./entities/review.entity";
import type { ReviewCommentEntity } from "./entities/review-comment.entity";

/**
 * Pure-function spec for the response mapper. Mirrors
 * `src/projects/project-response.mapper.spec.ts` shape: build a
 * canonical row + edge cases (missing relation), call the mapper,
 * assert the output shape.
 */
describe("toReviewResponse", () => {
	const baseRow = {
		id: "11111111-2222-3333-4444-555555555555",
		authorName: "Maria",
		authorRole: "PM",
		content: "Great work on the dashboard redesign",
		rating: 5,
		isApproved: false,
		createdAt: new Date("2026-06-19T10:00:00.000Z"),
		// `comments` is the @OneToMany side. When the relation is not
		// eager-loaded (the public list path), it is undefined.
	};

	it("maps all fields from the entity to the response DTO", () => {
		const out = toReviewResponse(baseRow as unknown as ReviewEntity);
		expect(out).toEqual({
			id: baseRow.id,
			authorName: "Maria",
			authorRole: "PM",
			content: "Great work on the dashboard redesign",
			rating: 5,
			isApproved: false,
			createdAt: baseRow.createdAt,
			// `comments` defaults to [] when the relation is not loaded
			// (e.g. the public list path). The response shape is
			// always an array.
			comments: [],
		});
	});

	it("comments defaults to [] when the relation is undefined (eager not loaded)", () => {
		const row = {
			...baseRow,
			comments: undefined,
		} as unknown as ReviewEntity;
		const out = toReviewResponse(row);
		expect(out.comments).toEqual([]);
	});

	it("comments is mapped via toReviewCommentResponse when the relation is loaded", () => {
		const commentRows: ReviewCommentEntity[] = [
			{
				id: "c-1",
				reviewId: baseRow.id,
				authorName: "Pedro",
				content: "Agree",
				isApproved: true,
				createdAt: new Date("2026-06-19T10:05:00.000Z"),
				review: baseRow as unknown as ReviewEntity,
			},
		];
		const row = {
			...baseRow,
			comments: commentRows,
		} as unknown as ReviewEntity;
		const out = toReviewResponse(row);
		expect(out.comments).toHaveLength(1);
		expect(out.comments[0]).toEqual({
			id: "c-1",
			reviewId: baseRow.id,
			authorName: "Pedro",
			content: "Agree",
			isApproved: true,
			createdAt: commentRows[0].createdAt,
		});
	});

	it("preserves authorRole as null when the entity has no role (nullable column)", () => {
		const row = { ...baseRow, authorRole: null } as unknown as ReviewEntity;
		const out = toReviewResponse(row);
		expect(out.authorRole).toBeNull();
	});
});

describe("toReviewCommentResponse", () => {
	const baseRow = {
		id: "c-1",
		reviewId: "r-1",
		authorName: "Pedro",
		content: "Agree, well done",
		isApproved: true,
		createdAt: new Date("2026-06-19T10:05:00.000Z"),
	};

	it("maps all fields from the comment entity to the response DTO", () => {
		const out = toReviewCommentResponse(
			baseRow as unknown as ReviewCommentEntity,
		);
		expect(out).toEqual({
			id: "c-1",
			reviewId: "r-1",
			authorName: "Pedro",
			content: "Agree, well done",
			isApproved: true,
			createdAt: baseRow.createdAt,
		});
	});
});
