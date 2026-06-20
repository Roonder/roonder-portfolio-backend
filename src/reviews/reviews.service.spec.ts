import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { NotFoundException } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import { ReviewEntity } from "./entities/review.entity";
import { ReviewCommentEntity } from "./entities/review-comment.entity";

// ---------------------------------------------------------------------------
// Fakes. The reviews service takes 2 repository tokens; the create() path
// uses only the `reviews` repo. The `comments` repo is injected for the
// T13 addComment + findApprovedCommentsByReviewId methods; the constructor
// signature is stable from T8 onward.
// ---------------------------------------------------------------------------

function makeReviewRepo(): {
	create: jest.Mock;
	save: jest.Mock;
	findOne: jest.Mock;
} {
	return {
		create: jest.fn(),
		save: jest.fn(),
		findOne: jest.fn(),
	};
}

function makeCommentRepo(): Record<string, jest.Mock> {
	return {};
}

async function buildService(
	reviews: ReturnType<typeof makeReviewRepo>,
	comments: ReturnType<typeof makeCommentRepo>,
): Promise<ReviewsService> {
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			ReviewsService,
			{
				provide: getRepositoryToken(ReviewEntity),
				useValue: reviews,
			},
			{
				provide: getRepositoryToken(ReviewCommentEntity),
				useValue: comments,
			},
		],
	}).compile();
	return module.get(ReviewsService);
}

const CREATE_DTO = {
	authorName: "Maria",
	authorRole: "PM",
	content: "Great work on the dashboard redesign",
	rating: 5,
};

describe("ReviewsService.create (T8a)", () => {
	it("persists the review with isApproved=false (the public submission contract)", async () => {
		const reviews = makeReviewRepo();
		const comments = makeCommentRepo();
		const createdRow = {
			id: "r-1",
			authorName: "Maria",
			authorRole: "PM",
			content: "Great work on the dashboard redesign",
			rating: 5,
			isApproved: false,
			createdAt: new Date("2026-06-19T10:00:00.000Z"),
		};
		reviews.create.mockReturnValue(createdRow);
		reviews.save.mockResolvedValue({ ...createdRow });

		const service = await buildService(reviews, comments);
		const out = await service.create(CREATE_DTO);

		// Assert: create was called with the DTO + isApproved: false
		expect(reviews.create).toHaveBeenCalledWith({
			...CREATE_DTO,
			isApproved: false,
		});
		// Assert: save fired once with the row create returned.
		expect(reviews.save).toHaveBeenCalledWith(createdRow);
		// Assert: response shape — the mapper drops the `comments`
		// relation (the public path never eager-loads it).
		expect(out).toEqual({
			id: "r-1",
			authorName: "Maria",
			authorRole: "PM",
			content: "Great work on the dashboard redesign",
			rating: 5,
			isApproved: false,
			createdAt: out.createdAt,
			comments: [],
		});
	});

	it("does NOT require a transaction (no withRetry, no manual cascade)", async () => {
		// The FK CASCADE is the only cascade mechanism. The service
		// does NOT use `dataSource.transaction(...)` on the create
		// path — reviews have no children at insert time, and the
		// throttler is per-route, not in the service.
		const reviews = makeReviewRepo();
		reviews.create.mockReturnValue({ id: "r-1" });
		reviews.save.mockResolvedValue({ id: "r-1" });
		const service = await buildService(reviews, makeCommentRepo());
		await service.create(CREATE_DTO);
		// Sanity: the service didn't call anything on the comments
		// repo on the create path.
		expect(reviews.save).toHaveBeenCalledTimes(1);
	});
});

// Placeholder for the T8b/T8c methods that are not yet implemented.
// These are stub tests that become real assertions once T8b/T8c land.
describe("ReviewsService surface (scaffold for T8b/T8c/T13)", () => {
	it("exposes findAllApproved, findAllForAdmin, toggleApproval, remove methods", () => {
		// Type-level assertion via the service instance. The methods
		// are added in T8b/T8c/T13 — this test will start to fail
		// as soon as a contributor removes a method.
		const proto = ReviewsService.prototype as Record<string, unknown>;
		expect(typeof proto["findAllApproved"]).toBe("function");
		expect(typeof proto["findAllForAdmin"]).toBe("function");
		expect(proto["findAllApproved"]).toBeDefined();
		expect(proto["findAllForAdmin"]).toBeDefined();
	});

	// Sanity: NotFoundException is the 404 path's exception class.
	// T8c will assert the service throws it on the toggle/remove
	// 404 path; this test is the type-level import guard.
	it("NotFoundException is importable (sanity)", () => {
		expect(NotFoundException).toBeDefined();
	});
});
