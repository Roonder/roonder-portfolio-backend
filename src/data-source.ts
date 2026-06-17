import { DataSource } from "typeorm";
import { UserEntity } from "./auth/entities/user.entity";
import { RefreshTokenEntity } from "./auth/entities/refresh-token.entity";

/**
 * Shared TypeORM DataSource. The seed CLI in `src/cli/seed-superuser.ts`
 * and the runtime Nest application both consume this file so the entity
 * list, `synchronize: false`, and connection config stay in one place.
 *
 * NOTE: `synchronize: false` is intentional — schema is owned by the
 * DBML in `openspec/specs/database-schema.dbml` and is applied via
 * explicit migrations (out of scope for the auth-domain change).
 */
export const AppDataSource = new DataSource({
	type: "postgres",
	url: process.env.DATABASE_URL,
	entities: [UserEntity, RefreshTokenEntity],
	migrations: [],
	synchronize: false,
});
