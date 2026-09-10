import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ReviewsModule", () => {
	describe("TypeOrmModule.forFeature wiring (static contract)", () => {
		// We read the source file and assert the import + feature
		// registration match the spec scenario
		// "DataSource and ReviewsModule register ReviewEntity" in
		// `openspec/changes/reviews-domain/specs/reviews-domain/spec.md`.
		// The 2 entities are both registered (the review AND its
		// child comments) so the @InjectRepository tokens in
		// ReviewsService resolve.
		const source = readFileSync(
			resolve(__dirname, "reviews.module.ts"),
			"utf8",
		);

		it("imports TypeOrmModule from @nestjs/typeorm", () => {
			expect(source).toMatch(/from\s+["']@nestjs\/typeorm["']/);
		});

		it("calls TypeOrmModule.forFeature with both ReviewEntity and ReviewCommentEntity", () => {
			// The exact pattern: `TypeOrmModule.forFeature([ReviewEntity, ReviewCommentEntity])`.
			const regex =
				/TypeOrmModule\.forFeature\(\s*\[\s*ReviewEntity\s*,\s*ReviewCommentEntity\s*\]\s*\)/;
			expect(source).toMatch(regex);
		});

		it("provides ReviewsService", () => {
			expect(source).toMatch(/providers\s*:\s*\[\s*ReviewsService\s*\]/);
		});

		it("declares BOTH controllers at the class level (ReviewsController + ReviewsAdminController)", () => {
			expect(source).toMatch(
				/controllers\s*:\s*\[\s*ReviewsController\s*,\s*ReviewsAdminController\s*\]/,
			);
		});

		it("exports ReviewsService (per ADR-13, the seed CLI consumes it)", () => {
			// Per design ADR-13: `exports: [ReviewsService]` so the
			// `seed-reviews.ts` CLI (added at T17) can import the
			// service directly without re-instantiating a Nest
			// application context.
			expect(source).toMatch(/exports\s*:\s*\[\s*ReviewsService\s*\]/);
		});
	});
});
