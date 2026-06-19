import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { ProjectEntity } from "./entities/project.entity";
import { ProjectUrlEntity } from "./entities/project-url.entity";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { ListProjectsQueryDto } from "./dto/list-projects-query.dto";
import type { ListProjectsResult } from "./dto/list-projects-response.dto";
import type { ProjectResponseDto } from "./dto/project-response.dto";
import { toProjectResponse } from "./project-response.mapper";

/**
 * Projects domain service. The methods are filled in by Tasks 2.3
 * (findPublic), 2.4 (findOneBySlug), 2.5 (create), 2.6 (update with
 * DIFF + transaction), and 2.7 (remove). This Task 2.2 wires the 3
 * deps the design locks in:
 *
 *   - `projects` — `Repository<ProjectEntity>` for the projects table.
 *   - `projectUrls` — `Repository<ProjectUrlEntity>` for the child
 *     table (used by the DIFF).
 *   - `dataSource` — the shared `DataSource`, used by
 *     `dataSource.transaction(...)` in the write paths (ADR-4).
 *
 * Replacing the original 5-method stub (which had the
 * `+id` numeric coercion bug and unused DTO params — see the
 * pre-existing 2 lint errors that this rewrite resolves to 0 as
 * a side effect).
 */
@Injectable()
export class ProjectsService {
	constructor(
		@InjectRepository(ProjectEntity)
		private readonly projects: Repository<ProjectEntity>,
		@InjectRepository(ProjectUrlEntity)
		private readonly projectUrls: Repository<ProjectUrlEntity>,
		private readonly dataSource: DataSource,
	) {}

	// --- Public reads (Tasks 2.3, 2.4) --------------------------------

	/**
	 * `GET /api/v1/projects` — paginated, filterable list of projects
	 * for the public surface.
	 *
	 * Defaults (applied here, NOT in the DTO — see `ListProjectsQueryDto`
	 * for the input contract):
	 *   - `isPublished = true`     — anonymous callers see only published
	 *   - `page = 1`
	 *   - `pageSize = 20`
	 *   - `pageSize` capped at 100 (spec scenario "pageSize is capped
	 *     at 100": silently clamp, do NOT 400).
	 *
	 * Tag filter (ADR-3): the Postgres `@>` operator with
	 * `ARRAY[:...tags]` binding. A GIN index on `tags` (added by
	 * the migration in Task 1.5) keeps the operator sub-linear.
	 * A project matches only when EVERY requested tag is present
	 * in its `tags` column.
	 *
	 * @returns envelope `{ data, total, page, pageSize }`. `data` is
	 * the slice for the requested page; `total` is the count of rows
	 * that matched the filter (NOT the length of `data`).
	 */
	async findPublic(query: ListProjectsQueryDto): Promise<ListProjectsResult> {
		const page = query.page ?? 1;
		const pageSize = Math.min(query.pageSize ?? 20, 100);
		const isPublished = query.isPublished ?? true;
		const tags = query.tags ?? [];

		const qb = this.projects
			.createQueryBuilder("project")
			.leftJoinAndSelect("project.urls", "url")
			.where("project.is_published = :isPub", { isPub: isPublished })
			.orderBy("project.created_at", "DESC")
			.skip((page - 1) * pageSize)
			.take(pageSize);

		if (tags.length > 0) {
			qb.andWhere("project.tags @> ARRAY[:...tags]", { tags });
		}

		const [rows, total] = await qb.getManyAndCount();
		return {
			data: rows.map(toProjectResponse),
			total,
			page,
			pageSize,
		};
	}

	/**
	 * `GET /api/v1/projects/:slug` — public read by slug.
	 *
	 * The `isPublished: true` gate is encoded in the `where` clause
	 * so unpublished projects never reach the response shape.
	 * Both "missing" and "unpublished" cases throw the same
	 * `NotFoundException` body — the spec scenario
	 * "Unpublished project returns 404 (no existence leak)" requires
	 * that anonymous callers cannot distinguish the two.
	 *
	 * The error message is identical across both cases
	 * ("Project not found") — that is the byte-equality the
	 * existence-leak guard relies on.
	 */
	async findOneBySlug(slug: string): Promise<ProjectResponseDto> {
		const row = await this.projects.findOne({
			where: { slug, isPublished: true },
			relations: { urls: true },
		});
		if (!row) {
			throw new NotFoundException("Project not found");
		}
		return toProjectResponse(row);
	}

	// --- Admin writes (Tasks 2.5, 2.6, 2.7) --------------------------

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	create(dto: CreateProjectDto): Promise<unknown> {
		// Implemented in Task 2.5 (slug pre-check + 23505 race catch).
		throw new Error("create not implemented yet");
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	update(id: string, dto: UpdateProjectDto): Promise<unknown> {
		// Implemented in Task 2.6 (DIFF + transaction + 3-retry).
		throw new Error("update not implemented yet");
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	remove(id: string): Promise<unknown> {
		// Implemented in Task 2.7 (cascade).
		throw new Error("remove not implemented yet");
	}
}
