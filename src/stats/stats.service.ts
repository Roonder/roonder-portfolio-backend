import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ProjectEntity } from "../projects/entities/project.entity";
import { ReviewEntity } from "../reviews/entities/review.entity";
import { ContactEntity } from "../contact/entities/contact.entity";
import { CONTACT_STATUS } from "../contact/dto/update-contact-status.dto";
import { AdminStatsResponseDto } from "./dto/admin-stats-response.dto";

@Injectable()
export class StatsService {
	constructor(
		@InjectRepository(ProjectEntity)
		private readonly projectRepo: Repository<ProjectEntity>,
		@InjectRepository(ReviewEntity)
		private readonly reviewRepo: Repository<ReviewEntity>,
		@InjectRepository(ContactEntity)
		private readonly contactRepo: Repository<ContactEntity>,
	) {}

	async getAdminStats(): Promise<AdminStatsResponseDto> {
		const startOfMonth = new Date();
		startOfMonth.setDate(1);
		startOfMonth.setHours(0, 0, 0, 0);

		const [activeWorks, activeWorksThisMonth, reviewsPending, inboxPending] =
			await Promise.all([
				this.projectRepo.count({ where: { isPublished: true } }),
				this.projectRepo
					.createQueryBuilder("project")
					.where("project.is_published = true")
					.andWhere("project.created_at >= :startOfMonth", { startOfMonth })
					.getCount(),
				this.reviewRepo.count({ where: { isApproved: false } }),
				this.contactRepo.count({
					where: { status: CONTACT_STATUS.PENDING },
				}),
			]);

		return {
			activeWorks,
			activeWorksThisMonth,
			reviewsPending,
			inboxPending,
		};
	}
}
