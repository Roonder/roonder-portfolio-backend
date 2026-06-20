import type { Repository } from "typeorm";
import { AppDataSource } from "../data-source";
import { ReviewEntity } from "../reviews/entities/review.entity";
import { ReviewCommentEntity } from "../reviews/entities/review-comment.entity";

/**
 * Pure seam for the reviews seed script. Mirrors the
 * `seed-projects.ts` shape: a pure function that takes its
 * repositories as parameters (so the unit suite can pass Jest
 * fakes) and an I/O wrapper that owns the `AppDataSource`
 * lifecycle.
 *
 * Insert 3 approved reviews + 2 pending reviews, each with 0–2
 * sample `review_comments` rows. **All comment rows have
 * `isApproved: false`** (locked #3 — the public read of comments
 * filters to `isApproved: true` at the query level, so the
 * moderation queue is implicitly seeded for the admin queue).
 * The author names, content, and ratings are short and
 * self-explanatory so the e2e + dev environments have
 * realistic data to render.
 *
 * @param reviewRepo   TypeORM repository for `ReviewEntity`.
 * @param commentRepo  TypeORM repository for `ReviewCommentEntity`.
 * @returns The list of inserted reviews + the list of inserted
 *          comments. Returned even in `SEED_DRY_RUN=1` so the
 *          caller can log the intended shape; in dry-run mode
 *          the repositories are NEVER touched.
 */
export interface SeedReviewsDeps {
	reviewRepo: Repository<ReviewEntity>;
	commentRepo: Repository<ReviewCommentEntity>;
}

export interface SeedReviewsSummary {
	reviews: Array<{
		authorName: string;
		isApproved: boolean;
	}>;
	comments: Array<{
		reviewAuthorName: string;
		authorName: string;
		isApproved: boolean;
	}>;
}

interface ReviewSeed {
	authorName: string;
	authorRole: string | null;
	content: string;
	rating: number;
	isApproved: boolean;
	comments: Array<{ authorName: string; content: string }>;
}

const SEED: ReadonlyArray<ReviewSeed> = [
	{
		authorName: "Maria",
		authorRole: "PM",
		content:
			"Excellent work on the dashboard redesign — the new layout is much more intuitive.",
		rating: 5,
		isApproved: true,
		comments: [
			{
				authorName: "Pedro",
				content: "Agreed, the new layout is much cleaner.",
			},
		],
	},
	{
		authorName: "Juan",
		authorRole: "Designer",
		content:
			"The portfolio site is well-structured and the content caps are clear.",
		rating: 4,
		isApproved: true,
		comments: [
			{
				authorName: "Maria",
				content: "Thanks Juan — happy to iterate if you have feedback.",
			},
			{
				authorName: "Carlos",
				content: "I agree, the design system is solid.",
			},
		],
	},
	{
		authorName: "Ana",
		authorRole: null,
		content:
			"Great communication throughout the project. The deliverables were on time.",
		rating: 5,
		isApproved: true,
		comments: [],
	},
	{
		authorName: "Luis",
		authorRole: "Engineer",
		content:
			"The codebase is well-organized. A few tests could use more edge cases.",
		rating: 3,
		isApproved: false,
		comments: [
			{
				authorName: "Sofia",
				content:
					"Working on those edge cases — will be in the next PR.",
			},
		],
	},
	{
		authorName: "Sofia",
		authorRole: null,
		content: "Pending review — would like to see a demo before approving.",
		rating: 4,
		isApproved: false,
		comments: [],
	},
];

export async function seedReviews(
	deps: SeedReviewsDeps,
): Promise<SeedReviewsSummary> {
	const isDryRun = process.env.SEED_DRY_RUN === "1";
	const reviewsSummary: SeedReviewsSummary["reviews"] = [];
	const commentsSummary: SeedReviewsSummary["comments"] = [];

	if (isDryRun) {
		// Return the intended shape WITHOUT touching the repos.
		for (const seed of SEED) {
			reviewsSummary.push({
				authorName: seed.authorName,
				isApproved: seed.isApproved,
			});
			for (const c of seed.comments) {
				commentsSummary.push({
					reviewAuthorName: seed.authorName,
					authorName: c.authorName,
					isApproved: false,
				});
			}
		}
		return { reviews: reviewsSummary, comments: commentsSummary };
	}

	for (const seed of SEED) {
		const row = deps.reviewRepo.create({
			authorName: seed.authorName,
			authorRole: seed.authorRole,
			content: seed.content,
			rating: seed.rating,
			isApproved: seed.isApproved,
		});
		const saved = await deps.reviewRepo.save(row);
		reviewsSummary.push({
			authorName: saved.authorName,
			isApproved: saved.isApproved,
		});
		if (seed.comments.length > 0) {
			await deps.commentRepo.insert(
				seed.comments.map((c) => ({
					reviewId: saved.id,
					authorName: c.authorName,
					content: c.content,
					// Locked #3: all comment rows start with
					// isApproved=false. The admin moderation queue
					// approves them in a follow-up.
					isApproved: false,
				})),
			);
			for (const c of seed.comments) {
				commentsSummary.push({
					reviewAuthorName: saved.authorName,
					authorName: c.authorName,
					isApproved: false,
				});
			}
		}
	}

	return { reviews: reviewsSummary, comments: commentsSummary };
}

/**
 * I/O wrapper. Reads `SEED_DRY_RUN` from the process environment,
 * initializes the shared `AppDataSource` (so the entity list /
 * connection config match the runtime Nest app — see
 * `src/data-source.ts`), invokes the pure `seedReviews`, logs the
 * inserted author names, and tears the connection down. Exits
 * non-zero with the error message on failure — no DB connection
 * is left open in that path.
 *
 * NOT wired into `npm run start:prod` (per design ADR-13: it is
 * a standalone dev tool). The `package.json` script
 * `seed:reviews` (added at T1) invokes this file via ts-node.
 */
async function main(): Promise<void> {
	const isDryRun = process.env.SEED_DRY_RUN === "1";
	try {
		await AppDataSource.initialize();
		const reviewRepo = AppDataSource.getRepository(ReviewEntity);
		const commentRepo = AppDataSource.getRepository(ReviewCommentEntity);
		const summary = await seedReviews({ reviewRepo, commentRepo });
		await AppDataSource.destroy();
		const mode = isDryRun ? "[DRY RUN] " : "";
		const authors = summary.reviews.map((r) => r.authorName).join(", ");
		console.log(
			`\u2713 ${mode}Seeded ${summary.reviews.length} reviews and ${summary.comments.length} review_comments rows.`,
		);
		console.log(`  Authors: ${authors}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(message);
		process.exit(1);
	}
}

if (require.main === module) {
	void main();
}
