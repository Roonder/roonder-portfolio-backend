import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written migration (no live Postgres available in this environment
// to run `typeorm migration:generate`). The SQL below mirrors what
// `typeorm schema:log` would emit against the entities committed in
// Tasks 1.1 + 1.2 (ProjectEntity, ProjectUrlEntity) and the DBML delta
// in Task 1.4 (`tags text[]`, ON DELETE CASCADE, two indexes).
//
// To re-verify against a real Postgres:
//
//   docker run --rm -d --name pg-verify -p 5432:5432 \
//     -e POSTGRES_PASSWORD=postgres postgres:16
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
//     npx typeorm schema:log src/data-source.ts
//
// Then run `migration:run` against the same database. The expected DDL
// in `schema:log` is the SQL below.

export class CreateProjectsAndProjectUrls20260618205116 implements MigrationInterface {
	name = "CreateProjectsAndProjectUrls20260618205116";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE "projects" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"title" varchar NOT NULL,
				"slug" varchar NOT NULL,
				"description" text NOT NULL,
				"content" text,
				"cover_image" varchar,
				"tags" text[] NOT NULL DEFAULT ARRAY[]::text[],
				"is_published" boolean NOT NULL DEFAULT false,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP NOT NULL DEFAULT now(),
				CONSTRAINT "PK_projects" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_projects_slug" UNIQUE ("slug")
			)
		`);
		await queryRunner.query(`
			CREATE TABLE "project_urls" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"project_id" uuid NOT NULL,
				"title" varchar NOT NULL,
				"url" varchar NOT NULL,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP NOT NULL DEFAULT now(),
				CONSTRAINT "PK_project_urls" PRIMARY KEY ("id"),
				CONSTRAINT "FK_project_urls_project"
					FOREIGN KEY ("project_id")
					REFERENCES "projects"("id")
					ON DELETE CASCADE
			)
		`);
		// Case-insensitive read optimisation for the slug lookups the
		// service performs (DBML Indexes block; design §TypeORM Data Model).
		await queryRunner.query(`
			CREATE INDEX "idx_projects_slug_lower" ON "projects" (LOWER("slug"))
		`);
		// GIN index for the @> array-contains operator used by the
		// `tags` filter on the list endpoint (DBML Indexes block; ADR-3).
		await queryRunner.query(`
			CREATE INDEX "idx_projects_tags_gin" ON "projects" USING GIN ("tags")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_projects_tags_gin"`);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_projects_slug_lower"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS "project_urls"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "projects"`);
	}
}
