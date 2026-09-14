import type { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written migration mirroring `UserEntity` / `RefreshTokenEntity`
// (src/auth/entities/*.entity.ts) and the `users` table in
// openspec/specs/database-schema.dbml. This was the one table pair
// that predated the migration-driven workflow (it shipped under
// `synchronize: true` during early auth-domain work) and never got a
// migration of its own — added now because the Supabase target
// database has no drift-created schema to fall back on.

export class CreateUsersAndRefreshTokens20260610000000 implements MigrationInterface {
	name = "CreateUsersAndRefreshTokens20260610000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		// Every migration in this glob calls `uuid_generate_v4()` as a
		// column default. This is the first migration to run, so it
		// guards the whole chain regardless of whether the target
		// Postgres (Supabase or a fresh local instance) has the
		// extension pre-enabled.
		await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
		await queryRunner.query(`
			CREATE TABLE "users" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"email" varchar NOT NULL,
				"password" varchar NOT NULL,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP NOT NULL DEFAULT now(),
				CONSTRAINT "PK_users" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_users_email" UNIQUE ("email")
			)
		`);
		await queryRunner.query(`
			CREATE TABLE "refresh_tokens" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"user_id" uuid NOT NULL,
				"family_id" uuid NOT NULL,
				"hashed_token" varchar NOT NULL,
				"expires_at" TIMESTAMP NOT NULL,
				"revoked_at" TIMESTAMP,
				"replaced_by" uuid,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
				CONSTRAINT "UQ_refresh_tokens_hashed_token" UNIQUE ("hashed_token")
			)
		`);
		await queryRunner.query(`
			CREATE INDEX "idx_refresh_tokens_family_id" ON "refresh_tokens" ("family_id")
		`);
		await queryRunner.query(`
			CREATE INDEX "idx_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_refresh_tokens_user_id"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_refresh_tokens_family_id"`,
		);
		await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
	}
}
