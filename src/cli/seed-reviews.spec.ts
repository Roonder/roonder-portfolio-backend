import { Repository } from "typeorm";
import { AppDataSource } from "../data-source";
import { ReviewEntity } from "../reviews/entities/review.entity";
import { ReviewCommentEntity } from "../reviews/entities/review-comment.entity";
import { seedReviews } from "./seed-reviews";

/**
 * Unit suite for the reviews seed script. Mirrors the
 * `seed-projects.spec.ts` pattern: the pure function
 * `seedReviews` is the testable seam; the `main()` I/O wrapper
 * is exercised only at the import / `AppDataSource` shape
 * level.
 *
 * The `process.env.SEED_DRY_RUN=1` path asserts the script
 * NEVER touches the repositories when dry-run is on — a safe
 * local verification mode.
 */
describe("seedReviews (pure function)", () => {
	const ORIGINAL_DRY_RUN = process.env.SEED_DRY_RUN;

	afterEach(() => {
		if (ORIGINAL_DRY_RUN === undefined) {
			delete process.env.SEED_DRY_RUN;
		} else {
			process.env.SEED_DRY_RUN = ORIGINAL_DRY_RUN;
		}
	});

	it("(1) is importable — the module loads + exports `seedReviews`", () => {
		// The import above would have failed at module load if
		// the file is missing or has a syntax error. The
		// `seedReviews` symbol must be a function.
		expect(typeof seedReviews).toBe("function");
		expect(typeof AppDataSource.initialize).toBe("function");
		expect(typeof AppDataSource.getRepository).toBe("function");
	});

	it("(2) happy-path inserts 3 approved + 2 pending reviews (5 total)", async () => {
		const { repo: reviewRepo } = makeFakeReviewRepo();
		const { repo: commentRepo } = makeFakeCommentRepo();
		delete process.env.SEED_DRY_RUN;

		const result = await seedReviews({
			reviewRepo: reviewRepo as unknown as Repository<ReviewEntity>,
			commentRepo: commentRepo as unknown as Repository<ReviewCommentEntity>,
		});

		expect(result.reviews).toHaveLength(5);
		const approved = result.reviews.filter((r) => r.isApproved).length;
		const pending = result.reviews.filter((r) => !r.isApproved).length;
		expect(approved).toBe(3);
		expect(pending).toBe(2);
	});

	it("(3) all comment rows have isApproved=false (locked #3)", async () => {
		const { repo: reviewRepo } = makeFakeReviewRepo();
		const { repo: commentRepo, insertCalls } = makeFakeCommentRepo();
		delete process.env.SEED_DRY_RUN;

		const result = await seedReviews({
			reviewRepo: reviewRepo as unknown as Repository<ReviewEntity>,
			commentRepo: commentRepo as unknown as Repository<ReviewCommentEntity>,
		});

		// Total comments = 1 (Maria) + 2 (Juan) + 0 (Ana) +
		// 1 (Luis) + 0 (Sofia) = 4.
		expect(result.comments).toHaveLength(4);
		for (const c of result.comments) {
			expect(c.isApproved).toBe(false);
		}
		// The repo insert MUST have been called with isApproved=false
		// for every comment row.
		for (const call of insertCalls) {
			for (const row of call) {
				expect((row as { isApproved?: boolean }).isApproved).toBe(
					false,
				);
			}
		}
	});

	it("(4) SEED_DRY_RUN=1 short-circuits — repos are NOT touched", async () => {
		const {
			repo: reviewRepo,
			createCalls: reviewCreateCalls,
			saveCalls: reviewSaveCalls,
		} = makeFakeReviewRepo();
		const { repo: commentRepo, insertCalls: commentInsertCalls } =
			makeFakeCommentRepo();
		process.env.SEED_DRY_RUN = "1";

		const result = await seedReviews({
			reviewRepo: reviewRepo as unknown as Repository<ReviewEntity>,
			commentRepo: commentRepo as unknown as Repository<ReviewCommentEntity>,
		});

		// Summary still includes the intended shape.
		expect(result.reviews).toHaveLength(5);
		expect(result.comments).toHaveLength(4);
		// BUT the repos were never called.
		expect(reviewCreateCalls).toHaveLength(0);
		expect(reviewSaveCalls).toHaveLength(0);
		expect(commentInsertCalls).toHaveLength(0);
	});

	it("(5) summary shape: { reviews: [...], comments: [...] }", async () => {
		const { repo: reviewRepo } = makeFakeReviewRepo();
		const { repo: commentRepo } = makeFakeCommentRepo();
		delete process.env.SEED_DRY_RUN;

		const result = await seedReviews({
			reviewRepo: reviewRepo as unknown as Repository<ReviewEntity>,
			commentRepo: commentRepo as unknown as Repository<ReviewCommentEntity>,
		});

		expect(result).toHaveProperty("reviews");
		expect(result).toHaveProperty("comments");
		expect(Array.isArray(result.reviews)).toBe(true);
		expect(Array.isArray(result.comments)).toBe(true);
	});

	it("(6) the pure function NEVER calls findOne (insert-only contract)", async () => {
		const { repo: reviewRepo, findOneCalls } = makeFakeReviewRepo();
		const { repo: commentRepo } = makeFakeCommentRepo();
		delete process.env.SEED_DRY_RUN;

		await seedReviews({
			reviewRepo: reviewRepo as unknown as Repository<ReviewEntity>,
			commentRepo: commentRepo as unknown as Repository<ReviewCommentEntity>,
		});

		// The seed is single-shot: it inserts rows, never reads
		// the DB. This is the idempotency contract — the I/O
		// wrapper is the idempotency layer (it doesn't migrate
		// the existing rows; the operator is expected to clear
		// the tables before re-running).
		expect(findOneCalls).toHaveLength(0);
	});

	it("(7) idempotency contract: the I/O wrapper is the idempotency layer; the pure function is single-shot", () => {
		// The pure `seedReviews` always calls `.create` + `.save`
		// on every run (no upsert, no ON CONFLICT). The operator
		// is expected to truncate the `review_comments` +
		// `reviews` tables before re-running. The `SEED_DRY_RUN=1`
		// path is a safe preview that does NOT touch the repos.
		const { repo: reviewRepo, saveCalls } = makeFakeReviewRepo();
		const { repo: commentRepo } = makeFakeCommentRepo();
		delete process.env.SEED_DRY_RUN;

		// Run twice — save should be called 10 times total
		// (5 reviews × 2 runs).
		return seedReviews({
			reviewRepo: reviewRepo as unknown as Repository<ReviewEntity>,
			commentRepo: commentRepo as unknown as Repository<ReviewCommentEntity>,
		})
			.then(() =>
				seedReviews({
					reviewRepo: reviewRepo as unknown as Repository<ReviewEntity>,
					commentRepo:
						commentRepo as unknown as Repository<ReviewCommentEntity>,
				}),
			)
			.then(() => {
				expect(saveCalls).toHaveLength(10);
			});
	});
});

// ---------------------------------------------------------------------------
// Test fakes — mirror seed-projects.spec.ts pattern. The repos are
// Jest fakes that capture every call so the spec can assert on
// the surface area.
// ---------------------------------------------------------------------------

// NOTE: keep in sync with the production Repository<T> methods this fake is asked for.
function makeFakeReviewRepo(): {
	repo: Pick<
		Repository<ReviewEntity>,
		"create" | "save" | "findOne" | "insert" | "delete" | "findAndCount" | "createQueryBuilder"
	>;
	createCalls: unknown[][];
	saveCalls: unknown[][];
	findOneCalls: unknown[][];
} {
	const createCalls: unknown[][] = [];
	const saveCalls: unknown[][] = [];
	const findOneCalls: unknown[][] = [];
	const repo = {
		create: jest.fn((dto: unknown) => {
			createCalls.push([dto]);
			return dto;
		}),
		save: jest.fn((row: unknown) => {
			saveCalls.push([row]);
			return Promise.resolve({
				id: "r-1",
				...(row as Record<string, unknown>),
			});
		}),
		findOne: jest.fn((q: unknown) => {
			findOneCalls.push([q]);
			return Promise.resolve(null);
		}),
		insert: jest.fn(),
		delete: jest.fn(),
		findAndCount: jest.fn(),
		createQueryBuilder: jest.fn(),
	} as unknown as Pick<
		Repository<ReviewEntity>,
		"create" | "save" | "findOne" | "insert" | "delete" | "findAndCount" | "createQueryBuilder"
	>;
	return { repo, createCalls, saveCalls, findOneCalls };
}

// NOTE: keep in sync with the production Repository<T> methods this fake is asked for.
function makeFakeCommentRepo(): {
	repo: Pick<
		Repository<ReviewCommentEntity>,
		"create" | "save" | "findOne" | "delete" | "insert" | "findAndCount" | "createQueryBuilder"
	>;
	insertCalls: Array<Array<Record<string, unknown>>>;
} {
	const insertCalls: Array<Array<Record<string, unknown>>> = [];
	const repo = {
		create: jest.fn(),
		save: jest.fn(),
		findOne: jest.fn(),
		delete: jest.fn(),
		insert: jest.fn((rows: Array<Record<string, unknown>>) => {
			insertCalls.push(rows);
			return Promise.resolve({ identifiers: [], generatedMaps: [] });
		}),
		findAndCount: jest.fn(),
		createQueryBuilder: jest.fn(),
	} as unknown as Pick<
		Repository<ReviewCommentEntity>,
		"create" | "save" | "findOne" | "delete" | "insert" | "findAndCount" | "createQueryBuilder"
	>;
	return { repo, insertCalls };
}
