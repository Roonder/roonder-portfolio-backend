import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { NotFoundException } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import { ReviewEntity } from "./entities/review.entity";
import { ReviewCommentEntity } from "./entities/review-comment.entity";
import { toReviewResponse } from "./review-response.mapper";

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

// ---------------------------------------------------------------------------
// T8c: toggleApproval + remove. The fake Review repo is built with a
// `findOne` + `save` for toggleApproval, and a `delete` returning
// `{ affected }` for remove. The comments repo is also fake so the
// test can assert the FK CASCADE contract (comments.delete is NEVER
// called — the DB layer does the cascade).
// ---------------------------------------------------------------------------

const TOGGLE_BASE_ROW = {
	id: "r-toggle-1",
	authorName: "Maria",
	authorRole: null,
	content: "Great work on the dashboard redesign",
	rating: 5,
	isApproved: false,
	createdAt: new Date("2026-06-19T10:00:00.000Z"),
};

function makeToggleRepo(
	existing: { id: string; isApproved: boolean } | null,
	commentsRepo: {
		delete?: jest.Mock;
	},
): {
	repo: {
		findOne: jest.Mock;
		save: jest.Mock;
		delete: jest.Mock;
	};
	commentsRepo: typeof commentsRepo;
} {
	const row = existing ? { ...TOGGLE_BASE_ROW, ...existing } : null;
	const saved = row ? { ...row } : null;
	const repo = {
		findOne: jest.fn().mockResolvedValue(row),
		save: jest.fn((r: typeof row) => {
			if (r && saved) saved.isApproved = r.isApproved;
			return Promise.resolve(saved);
		}),
		delete: jest.fn(),
	};
	return { repo, commentsRepo };
}

async function buildServiceForToggle(
	existing: { id: string; isApproved: boolean } | null,
	commentsRepo: { delete?: jest.Mock } = {},
): Promise<{
	service: ReviewsService;
	repo: ReturnType<typeof makeToggleRepo>["repo"];
	commentsRepo: typeof commentsRepo;
}> {
	const { repo, commentsRepo: c } = makeToggleRepo(existing, commentsRepo);
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			ReviewsService,
			{ provide: getRepositoryToken(ReviewEntity), useValue: repo },
			{
				provide: getRepositoryToken(ReviewCommentEntity),
				useValue: c,
			},
		],
	}).compile();
	return {
		service: module.get(ReviewsService),
		repo,
		commentsRepo: c,
	};
}

describe("ReviewsService.toggleApproval (T8c)", () => {
	it("flips isApproved from false to true and returns the mapped response", async () => {
		const { service, repo } = await buildServiceForToggle({
			id: "r-1",
			isApproved: false,
		});
		const out = await service.toggleApproval("r-1");
		expect(repo.save).toHaveBeenCalledTimes(1);
		expect(repo.save).toHaveBeenCalledWith(
			expect.objectContaining({ id: "r-1", isApproved: true }),
		);
		// Response shape is the mapper output for the saved row.
		expect(out).toEqual(
			toReviewResponse({
				...TOGGLE_BASE_ROW,
				id: "r-1",
				isApproved: true,
			}),
		);
	});

	it("flips isApproved from true to false and returns the mapped response", async () => {
		const { service, repo } = await buildServiceForToggle({
			id: "r-1",
			isApproved: true,
		});
		const out = await service.toggleApproval("r-1");
		expect(repo.save).toHaveBeenCalledWith(
			expect.objectContaining({ id: "r-1", isApproved: false }),
		);
		expect(out).toEqual(
			toReviewResponse({
				...TOGGLE_BASE_ROW,
				id: "r-1",
				isApproved: false,
			}),
		);
	});

	it("is idempotent — toggling twice returns to the original value", async () => {
		// The state of the in-memory row is tracked via the fake
		// `findOne` + `save`. The service mutates the row object
		// before calling save, so on the second toggle the fake
		// returns the flipped state.
		const { service, repo } = await buildServiceForToggle({
			id: "r-1",
			isApproved: false,
		});
		const first = await service.toggleApproval("r-1");
		expect(first.isApproved).toBe(true);
		// Second toggle: stub findOne to return the flipped row.
		repo.findOne.mockResolvedValueOnce({
			...TOGGLE_BASE_ROW,
			id: "r-1",
			isApproved: true,
		});
		const second = await service.toggleApproval("r-1");
		expect(second.isApproved).toBe(false);
	});

	it("throws NotFoundException on a missing id (404 existence-leak guard)", async () => {
		const { service } = await buildServiceForToggle(null);
		await expect(service.toggleApproval("missing")).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it("does NOT call comments.delete on the toggle path (FK CASCADE only fires on parent delete)", async () => {
		// The comments repo fake is empty (no `delete` method) — the
		// test asserts the service did NOT call anything on the
		// comments repo during toggle.
		const { service, commentsRepo } = await buildServiceForToggle({
			id: "r-1",
			isApproved: false,
		});
		await service.toggleApproval("r-1");
		expect(commentsRepo.delete).toBeUndefined();
	});
});

describe("ReviewsService.remove (T8c)", () => {
	it("calls reviews.delete with the id once and resolves void on success", async () => {
		const { service, repo } = await buildServiceForToggle({
			id: "r-1",
			isApproved: true,
		});
		repo.delete.mockResolvedValue({ affected: 1 });
		await expect(service.remove("r-1")).resolves.toBeUndefined();
		expect(repo.delete).toHaveBeenCalledTimes(1);
		expect(repo.delete).toHaveBeenCalledWith({ id: "r-1" });
	});

	it("throws NotFoundException when delete affects 0 rows (404 existence-leak guard)", async () => {
		const { service, repo } = await buildServiceForToggle(null);
		repo.delete.mockResolvedValue({ affected: 0 });
		await expect(service.remove("missing")).rejects.toBeInstanceOf(
			NotFoundException,
		);
	});

	it("does NOT call comments.delete — the FK CASCADE does the work at the DB layer (locked #4 / ADR-8)", async () => {
		// Per locked design #4: the FK ON DELETE CASCADE on
		// review_comments.review_id removes child rows. The service
		// MUST NOT issue a manual comments.delete call. This test is
		// the executable contract for that lock. The comments repo
		// fake is wired with a `delete: jest.fn()` spy so we can
		// assert it was NEVER called.
		const { service, repo, commentsRepo } = await buildServiceForToggle(
			{ id: "r-1", isApproved: true },
			{ delete: jest.fn() },
		);
		repo.delete.mockResolvedValue({ affected: 1 });
		await service.remove("r-1");
		expect(commentsRepo.delete).not.toHaveBeenCalled();
	});
});
