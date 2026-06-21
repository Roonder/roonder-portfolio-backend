import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written migration (no live Postgres available in this environment
// to run `typeorm migration:generate`). The SQL below mirrors what
// `typeorm schema:log` would emit against the entities committed in
// Task 2 (ReviewEntity, ReviewCommentEntity) and the locked #3 + #4
// design decisions (is_approved default false, ON DELETE CASCADE).
//
// To re-verify against a real Postgres:
//
//   docker run --rm -d --name pg-verify -p 5432:5432 \
//     -e POSTGRES_PASSWORD=postgres postgres:16
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
//     npx typeorm schema:log src/data-source.ts
//
// Then run `migration:run` against the same database. The expected DDL
// in `schema:log` is the SQL below. The `ADD COLUMN IF NOT EXISTS` on
// `is_approved` is a belt-and-braces safety net for partial re-runs;
// the `CREATE TABLE` statements are NOT idempotent — dev workflow is
// `migration:revert` + `migration:run` for re-application, matching
// the projects precedent.

export class CreateReviewsAndReviewComments20260620020316 implements MigrationInterface {
	name = "CreateReviewsAndReviewComments20260620020316";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "reviews" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"author_name" varchar NOT NULL DEFAULT 'Anónimo',
				"author_role" varchar,
				"content" text NOT NULL,
				"rating" integer NOT NULL,
				"is_approved" boolean NOT NULL DEFAULT false,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				CONSTRAINT "PK_reviews" PRIMARY KEY ("id")
			)
		`);
		await queryRunner.query(`
			CREATE TABLE "review_comments" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"review_id" uuid NOT NULL,
				"author_name" varchar NOT NULL DEFAULT 'Anónimo',
				"content" text NOT NULL,
				"is_approved" boolean NOT NULL DEFAULT false,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				CONSTRAINT "PK_review_comments" PRIMARY KEY ("id"),
				CONSTRAINT "FK_review_comments_review"
					FOREIGN KEY ("review_id")
					REFERENCES "reviews"("id")
					ON DELETE CASCADE
			)
		`);
		// Idempotent safety net for partial re-runs (locked #3, ADR-7).
		// The CREATE TABLE above already declares `is_approved`, but if a
		// future change reverts the column but keeps the table, this
		// ADD COLUMN re-creates it without error.
		await queryRunner.query(`
			ALTER TABLE "review_comments"
			ADD COLUMN IF NOT EXISTS "is_approved" boolean NOT NULL DEFAULT false
		`);
		// Index for the public list filter `WHERE is_approved = true`.
		await queryRunner.query(`
			CREATE INDEX "idx_reviews_is_approved" ON "reviews" ("is_approved")
		`);
		// Index for the parent-id lookup in
		// `findApprovedCommentsByReviewId` (WHERE review_id = ?).
		await queryRunner.query(`
			CREATE INDEX "idx_review_comments_review_id" ON "review_comments" ("review_id")
		`);
		// Index for the public comments list filter
		// `WHERE review_id = ? AND is_approved = true`.
		await queryRunner.query(`
			CREATE INDEX "idx_review_comments_is_approved" ON "review_comments" ("is_approved")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_review_comments_is_approved"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_review_comments_review_id"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_reviews_is_approved"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS "review_comments"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "reviews"`);
	}
}
