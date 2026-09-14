import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StatsService } from "./stats.service";
import { StatsController } from "./stats.controller";
import { ProjectEntity } from "../projects/entities/project.entity";
import { ReviewEntity } from "../reviews/entities/review.entity";
import { ContactEntity } from "../contact/entities/contact.entity";

/**
 * Cross-domain aggregate stats for the admin overview. Registers the
 * 3 entities it reads via `forFeature` — safe alongside their
 * respective domain modules' own `forFeature` calls since they all
 * share the single `AppDataSource` connection.
 */
@Module({
	imports: [
		TypeOrmModule.forFeature([ProjectEntity, ReviewEntity, ContactEntity]),
	],
	controllers: [StatsController],
	providers: [StatsService],
})
export class StatsModule {}
