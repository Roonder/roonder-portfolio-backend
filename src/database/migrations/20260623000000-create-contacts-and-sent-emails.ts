import { MigrationInterface, QueryRunner } from "typeorm";

// Hand-written migration (no live Postgres available in this environment
// to run `typeorm migration:generate`). The SQL below mirrors what
// `typeorm schema:log` would emit against the entities committed in
// T2.2 (ContactEntity) and T2.3 (SentEmailEntity), plus the destructive
// changes the user-locked proposal §6 #2 + §6 decisions introduce:
//
//   1. DROP COLUMN email_sent_log on `contacts` (the destructive
//      change; the `down` step recreates it).
//   2. ADD COLUMN updated_at on `contacts` (the additive change).
//   3. CREATE TYPE sent_emails_status_enum ('accepted', 'failed').
//   4. CREATE TYPE sent_emails_kind_enum ('contact_notification',
//      'contact_auto_reply').
//   5. CREATE TABLE sent_emails with 10 columns + PK.
//   6. CREATE INDEX on kind, status, created_at DESC + a partial
//      unique index on resend_id WHERE NOT NULL.
//
// To re-verify against a real Postgres:
//
//   docker run --rm -d --name pg-verify -p 5432:5432 \
//     -e POSTGRES_PASSWORD=postgres postgres:16
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres \
//     npx typeorm schema:log src/data-source.ts
//
// Then run `migration:run` against the same database. The expected DDL
// in `schema:log` is the SQL below. `DROP COLUMN IF EXISTS` and
// `ADD COLUMN IF NOT EXISTS` are belt-and-braces safety nets for
// partial re-runs; the `CREATE TYPE` and `CREATE TABLE` statements
// are NOT idempotent — dev workflow is `migration:revert` then
// `migration:run` for re-application, matching the reviews precedent.

export class CreateContactsAndSentEmails20260623000000 implements MigrationInterface {
	name = "CreateContactsAndSentEmails20260623000000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		// --- 1. Modify the `contacts` table: drop the boolean audit, add updated_at.
		await queryRunner.query(
			`ALTER TABLE "contacts" DROP COLUMN IF EXISTS "email_sent_log"`,
		);
		await queryRunner.query(
			`ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP NOT NULL DEFAULT now()`,
		);

		// --- 2. Create the 2 Postgres-native enums for `sent_emails`.
		// Postgres has no native "CREATE TYPE IF NOT EXISTS" syntax; the
		// matching `DROP TYPE IF EXISTS` in the `down` step is the
		// rollback path.
		await queryRunner.query(
			`CREATE TYPE "sent_emails_status_enum" AS ENUM ('accepted', 'failed')`,
		);
		await queryRunner.query(
			`CREATE TYPE "sent_emails_kind_enum" AS ENUM ('contact_notification', 'contact_auto_reply')`,
		);

		// --- 3. Create the `sent_emails` table.
		await queryRunner.query(`
			CREATE TABLE "sent_emails" (
				"id" uuid NOT NULL DEFAULT uuid_generate_v4(),
				"subject" varchar NOT NULL,
				"from" varchar NOT NULL,
				"to" varchar NOT NULL,
				"resend_id" varchar,
				"status" "sent_emails_status_enum" NOT NULL,
				"kind" "sent_emails_kind_enum" NOT NULL,
				"error_message" text,
				"created_at" TIMESTAMP NOT NULL DEFAULT now(),
				"updated_at" TIMESTAMP NOT NULL DEFAULT now(),
				CONSTRAINT "PK_sent_emails" PRIMARY KEY ("id")
			)
		`);

		// --- 4. Create the 4 indexes (kind, status, created_at DESC,
		// and the partial unique on resend_id).
		await queryRunner.query(
			`CREATE INDEX "idx_sent_emails_kind" ON "sent_emails" ("kind")`,
		);
		await queryRunner.query(
			`CREATE INDEX "idx_sent_emails_status" ON "sent_emails" ("status")`,
		);
		await queryRunner.query(
			`CREATE INDEX "idx_sent_emails_created_at_desc" ON "sent_emails" ("created_at" DESC)`,
		);
		await queryRunner.query(
			`CREATE UNIQUE INDEX "idx_sent_emails_resend_id_unique" ON "sent_emails" ("resend_id") WHERE "resend_id" IS NOT NULL`,
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		// Reverse the 4 indexes, the table, the 2 enums, then the 2
		// column-level changes on `contacts`. The order is the exact
		// mirror of `up` — drop the dependent objects first.
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_sent_emails_resend_id_unique"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_sent_emails_created_at_desc"`,
		);
		await queryRunner.query(
			`DROP INDEX IF EXISTS "idx_sent_emails_status"`,
		);
		await queryRunner.query(`DROP INDEX IF EXISTS "idx_sent_emails_kind"`);
		await queryRunner.query(`DROP TABLE IF EXISTS "sent_emails"`);
		await queryRunner.query(`DROP TYPE IF EXISTS "sent_emails_kind_enum"`);
		await queryRunner.query(
			`DROP TYPE IF EXISTS "sent_emails_status_enum"`,
		);
		await queryRunner.query(
			`ALTER TABLE "contacts" DROP COLUMN IF EXISTS "updated_at"`,
		);
		// Recreate the dropped `email_sent_log` boolean. The default
		// is `true` to match the original DBML contract.
		await queryRunner.query(
			`ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "email_sent_log" boolean NOT NULL DEFAULT true`,
		);
	}
}
