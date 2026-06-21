import { join } from "node:path";
import { DataSource } from "typeorm";
import { UserEntity } from "./auth/entities/user.entity";
import { RefreshTokenEntity } from "./auth/entities/refresh-token.entity";
import { ProjectEntity } from "./projects/entities/project.entity";
import { ProjectUrlEntity } from "./projects/entities/project-url.entity";
import { ReviewEntity } from "./reviews/entities/review.entity";
import { ReviewCommentEntity } from "./reviews/entities/review-comment.entity";

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
	],
	migrations: [join(process.cwd(), "src/database/migrations/*.{ts,js}")],
	synchronize: false,
});
