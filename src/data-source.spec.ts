import { join } from "node:path";
import { readdirSync, readFileSync } from "node:fs";
import { AppDataSource } from "./data-source";
import { ReviewEntity } from "./reviews/entities/review.entity";
import { ReviewCommentEntity } from "./reviews/entities/review-comment.entity";

describe("DataSource migrations registration", () => {
	it("AppDataSource.options.migrations is a non-empty array of file globs", () => {
		const migrations = AppDataSource.options.migrations as string[];
		expect(Array.isArray(migrations)).toBe(true);
		expect(migrations.length).toBeGreaterThan(0);
	});

	it("the migration glob resolves to at least one existing .ts file under src/database/migrations", () => {
		// The `migrations` option can be a glob string OR an array of
		// MigrationClass entries. We assert the SOURCE-DIRECTORY contains
		// at least one migration file (the runtime path is exercised by
		// `typeorm migration:run` in environments that have Postgres;
		// here we only assert the file is on disk and its up() is non-empty).
		const dir = join(process.cwd(), "src/database/migrations");
		const files = readdirSync(dir).filter(
			(f) => f.endsWith(".ts") || f.endsWith(".js"),
		);
		expect(files.length).toBeGreaterThan(0);
	});

	it("the migration file defines a non-empty up() string body (no-op would catch a bad generation run)", () => {
		const dir = join(process.cwd(), "src/database/migrations");
		const files = readdirSync(dir).filter(
			(f) => f.endsWith(".ts") || f.endsWith(".js"),
		);
		// We don't need to require() the file (the unit suite does
		// not transpile the migrations dir); we read the source and
		// assert the `up()` body is non-empty.
		const source = readFileSync(join(dir, files[0]), "utf8");
		// `up(queryRunner: QueryRunner): Promise<void> { ... }` — assert
		// there is a non-trivial body between the `{` after `up(` and
		// the matching `}`.
		const upMatch =
			/up\s*\(\s*[^)]*\)\s*:\s*Promise<void>\s*\{([\s\S]*?)\n\}/.exec(
				source,
			);
		expect(upMatch).not.toBeNull();
		const body = (upMatch?.[1] ?? "").trim();
		expect(body.length).toBeGreaterThan(0);
		// Sanity: the body should mention the `projects` table (this is
		// the projects-domain migration; a future migration for another
		// domain would not satisfy this assertion and is out of PR1 scope).
		expect(body).toMatch(/projects/);
	});
});

describe("DataSource entities registration", () => {
	// reviews-domain (T4): ReviewEntity and ReviewCommentEntity are
	// registered in AppDataSource.entities. The static guard-rail
	// below matches the spec scenario
	// "DataSource and ReviewsModule register ReviewEntity".
	it("AppDataSource.entities includes ReviewEntity and ReviewCommentEntity", () => {
		const entities = (AppDataSource.options.entities ?? []) as unknown[];
		expect(entities).toContain(ReviewEntity);
		expect(entities).toContain(ReviewCommentEntity);
	});
});
