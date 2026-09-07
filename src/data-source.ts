import { join } from "node:path";
import { DataSource } from "typeorm";
import { UserEntity } from "./auth/entities/user.entity";
import { RefreshTokenEntity } from "./auth/entities/refresh-token.entity";
import { ProjectEntity } from "./projects/entities/project.entity";
import { ProjectUrlEntity } from "./projects/entities/project-url.entity";
import { ReviewEntity } from "./reviews/entities/review.entity";
import { ReviewCommentEntity } from "./reviews/entities/review-comment.entity";
import { ContactEntity } from "./contact/entities/contact.entity";
import { SentEmailEntity } from "./contact/entities/sent-email.entity";

/**
 * Shared TypeORM DataSource. The seed CLI in `src/cli/seed-superuser.ts`
 * and the runtime Nest application both consume this file so the entity
 * list, `synchronize: false`, and connection config stay in one place.
 *
 * NOTE: `synchronize: false` is intentional — schema is owned by the
 * DBML in `openspec/specs/database-schema.dbml` and is applied via
 * explicit migrations. The projects-domain migration lands in Task 1.5
 * and is registered via the `migrations` glob below. The reviews-domain
 * migration (T3) is picked up by the same glob.
 */
export const AppDataSource = new DataSource({
	type: "postgres",
	url: process.env.DATABASE_URL,
	entities: [
		UserEntity,
		RefreshTokenEntity,
		ProjectEntity,
		ProjectUrlEntity,
		ReviewEntity,
		ReviewCommentEntity,
		ContactEntity,
		SentEmailEntity,
	],
	migrations: [join(process.cwd(), "src/database/migrations/*.{ts,js}")],
	synchronize: false,
	// Supabase's single "postgres" database hosts both the dev and
	// prod schemas side by side — `DB_SCHEMA` picks which one this
	// process targets. Defaults to "public" for local docker Postgres.
	schema: process.env.DB_SCHEMA || "public",
	// Supabase's direct connection (port 5432) requires TLS; the
	// local docker Postgres does not speak TLS at all, so this is
	// derived from the connection target rather than a NODE_ENV
	// switch. `rejectUnauthorized: false` matches Supabase's docs —
	// it terminates TLS with a cert not in Node's default trust
	// store.
	ssl: process.env.DATABASE_URL?.includes("supabase.co")
		? { rejectUnauthorized: false }
		: false,
	// Bound the `pg` pool: without these, a dropped/stale connection
	// (e.g. behind a pooler that recycles idle sockets) leaves queries
	// hanging forever instead of failing fast.
	extra: {
		max: 10,
		connectionTimeoutMillis: 5000,
		idleTimeoutMillis: 10000,
		keepAlive: true,
		// The `schema` option above only qualifies identifiers TypeORM
		// itself generates (e.g. the migrations tracking table); the
		// hand-written migrations in src/database/migrations run raw
		// SQL with unqualified table names, so they land wherever the
		// session's `search_path` resolves. Setting it explicitly here
		// (via the Postgres `options` startup parameter) is what
		// actually routes those CREATE TABLE statements into the
		// right schema. `extensions` is appended because Supabase
		// installs extensions (uuid-ossp, pgcrypto, ...) there rather
		// than into the active schema — `uuid_generate_v4()` would
		// otherwise be unresolvable.
		options: `-c search_path=${process.env.DB_SCHEMA || "public"},extensions,public`,
	},
});
