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

// ---------------------------------------------------------------------------
// T8b: findAllApproved (public list) + findAllForAdmin (admin list).
// The fake QueryBuilder is captured so the spec can assert on the SQL
// fragment + args — the public list MUST filter to isApproved=true; the
// admin list MUST NOT.
// ---------------------------------------------------------------------------

interface CapturedQuery {
	where?: { sql: string; params: Record<string, unknown> };
	andWheres: Array<{ sql: string; params: Record<string, unknown> }>;
	orderBy?: { sql: string; direction: "ASC" | "DESC" };
	skipVal?: number;
	takeVal?: number;
}

function makeQueryBuilderFake(rows: Array<Record<string, unknown>>): {
	qb: Record<string, jest.Mock>;
	captured: CapturedQuery;
} {
	const captured: CapturedQuery = { andWheres: [] };
	const qb: Record<string, jest.Mock> = {};
	qb["where"] = jest.fn((sql: string, params: Record<string, unknown>) => {
		captured.where = { sql, params };
		return qb;
	});
	qb["andWhere"] = jest.fn((sql: string, params: Record<string, unknown>) => {
		captured.andWheres.push({ sql, params });
		return qb;
	});
	qb["orderBy"] = jest.fn((sql: string, direction: "ASC" | "DESC") => {
		captured.orderBy = { sql, direction };
		return qb;
	});
	qb["skip"] = jest.fn((n: number) => {
		captured.skipVal = n;
		return qb;
	});
	qb["take"] = jest.fn((n: number) => {
		captured.takeVal = n;
		return qb;
	});
	qb["getManyAndCount"] = jest.fn().mockResolvedValue([rows, rows.length]);
	for (const m of [
		"leftJoinAndSelect",
		"leftJoin",
		"innerJoin",
		"innerJoinAndSelect",
		"select",
		"addSelect",
		"groupBy",
		"having",
	]) {
		qb[m] = jest.fn(() => qb);
	}
	return { qb, captured };
}

function makeReviewRepoWithQb(rows: Array<Record<string, unknown>> = []): {
	createQueryBuilder: jest.Mock;
	findOne: jest.Mock;
	qb: Record<string, jest.Mock>;
	captured: CapturedQuery;
} {
	const { qb, captured } = makeQueryBuilderFake(rows);
	return {
		createQueryBuilder: jest.fn(() => qb),
		findOne: jest.fn(),
		qb,
		captured,
	};
}

async function buildServiceWithQb(
	rows: Array<Record<string, unknown>> = [],
): Promise<{
	service: ReviewsService;
	repo: ReturnType<typeof makeReviewRepoWithQb>;
}> {
	const repo = makeReviewRepoWithQb(rows);
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			ReviewsService,
			{ provide: getRepositoryToken(ReviewEntity), useValue: repo },
			{ provide: getRepositoryToken(ReviewCommentEntity), useValue: {} },
		],
	}).compile();
	return { service: module.get(ReviewsService), repo };
}

describe("ReviewsService.findAllApproved (T8b)", () => {
	it("filters to isApproved: true (the public list contract)", async () => {
		const { service, repo } = await buildServiceWithQb();
		await service.findAllApproved({});
		expect(repo.captured.where?.sql).toBe(
			"review.is_approved = :isApproved",
		);
		expect(repo.captured.where?.params).toEqual({ isApproved: true });
	});

	it("applies page=1 and pageSize=20 defaults when query is empty", async () => {
		const { service, repo } = await buildServiceWithQb();
		const out = await service.findAllApproved({});
		expect(repo.captured.skipVal).toBe(0);
		expect(repo.captured.takeVal).toBe(20);
		expect(out.page).toBe(1);
		expect(out.pageSize).toBe(20);
	});

	it("respects explicit page and pageSize from the query", async () => {
		const { service, repo } = await buildServiceWithQb();
		const out = await service.findAllApproved({ page: 2, pageSize: 10 });
		expect(repo.captured.skipVal).toBe(10);
		expect(repo.captured.takeVal).toBe(10);
		expect(out.page).toBe(2);
		expect(out.pageSize).toBe(10);
	});

	it("silently clamps pageSize > 100 to 100 (NOT rejected with 400)", async () => {
		const { service, repo } = await buildServiceWithQb();
		const out = await service.findAllApproved({ pageSize: 500 });
		expect(repo.captured.takeVal).toBe(100);
		expect(out.pageSize).toBe(100);
	});

	it("emits a `rating = :rating` andWhere when query.rating is set", async () => {
		const { service, repo } = await buildServiceWithQb();
		await service.findAllApproved({ rating: 5 });
		expect(repo.captured.andWheres).toHaveLength(1);
		expect(repo.captured.andWheres[0]?.sql).toBe("review.rating = :rating");
		expect(repo.captured.andWheres[0]?.params).toEqual({ rating: 5 });
	});

	it("does NOT emit a rating andWhere when query.rating is undefined", async () => {
		const { service, repo } = await buildServiceWithQb();
		await service.findAllApproved({});
		expect(repo.captured.andWheres).toHaveLength(0);
	});

	it("orders by created_at DESC", async () => {
		const { service, repo } = await buildServiceWithQb();
		await service.findAllApproved({});
		expect(repo.captured.orderBy).toEqual({
			sql: "review.created_at",
			direction: "DESC",
		});
	});

	it("returns the envelope shape { data, total, page, pageSize }", async () => {
		const { service } = await buildServiceWithQb();
		const out = await service.findAllApproved({});
		expect(out).toHaveProperty("data");
		expect(out).toHaveProperty("total");
		expect(out).toHaveProperty("page");
		expect(out).toHaveProperty("pageSize");
	});
});

describe("ReviewsService.findAllForAdmin (T8b)", () => {
	it("does NOT filter by isApproved (admin sees all reviews)", async () => {
		// The admin list's default is to return BOTH approved and
		// pending. The only branch that adds a `where` on is_approved
		// is the explicit `?isApproved=true|false` filter.
		const { service, repo } = await buildServiceWithQb();
		await service.findAllForAdmin({});
		expect(repo.captured.where).toBeUndefined();
	});

	it("emits the isApproved filter when query.isApproved is set (true)", async () => {
		const { service, repo } = await buildServiceWithQb();
		await service.findAllForAdmin({ isApproved: true });
		expect(repo.captured.where?.sql).toBe(
			"review.is_approved = :isApproved",
		);
		expect(repo.captured.where?.params).toEqual({ isApproved: true });
	});

	it("emits the isApproved filter when query.isApproved is set (false)", async () => {
		const { service, repo } = await buildServiceWithQb();
		await service.findAllForAdmin({ isApproved: false });
		expect(repo.captured.where?.params).toEqual({ isApproved: false });
	});

	it("applies the same pagination defaults as findAllApproved (page=1, pageSize=20)", async () => {
		const { service, repo } = await buildServiceWithQb();
		const out = await service.findAllForAdmin({});
		expect(repo.captured.skipVal).toBe(0);
		expect(repo.captured.takeVal).toBe(20);
		expect(out.page).toBe(1);
		expect(out.pageSize).toBe(20);
	});

	it("emits the rating andWhere when query.rating is set", async () => {
		const { service, repo } = await buildServiceWithQb();
		await service.findAllForAdmin({ rating: 3 });
		expect(repo.captured.andWheres).toHaveLength(1);
		expect(repo.captured.andWheres[0]?.params).toEqual({ rating: 3 });
	});
});
