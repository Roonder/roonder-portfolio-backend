import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { ProjectEntity } from "./entities/project.entity";
import { ProjectUrlEntity } from "./entities/project-url.entity";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";

/**
 * Projects domain service. Methods are populated in the per-task
 * commits (2.3 findPublic, 2.4 findOneBySlug, 2.5 create, 2.6 update
 * with DIFF + transaction, 2.7 remove). This Task 2.2 wires the 3
 * deps the design locks in:
 *
 *   - `projects` — `Repository<ProjectEntity>` for the projects table.
 *   - `projectUrls` — `Repository<ProjectUrlEntity>` for the child
 *     table (used by the DIFF).
 *   - `dataSource` — the shared `DataSource`, used by
 *     `dataSource.transaction(...)` in the write paths (ADR-4).
 *
 * Replaces the original 5-method scaffold that had the `+id` numeric
 * coercion bug and unused DTO params. The 2 pre-existing lint errors
 * (`'createProjectDto' is defined but never used`,
 * `'updateProjectDto' is defined but never used`) resolve to 0 as a
 * side effect of this rewrite — the new methods USE the DTOs even
 * before their bodies are filled in.
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

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	findPublic(query: unknown): Promise<unknown> {
		// Implemented in Task 2.3 (envelope + tags filter + pageSize cap).
		throw new Error("findPublic not implemented yet");
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	findOneBySlug(slug: string): Promise<unknown> {
		// Implemented in Task 2.4 (no-existence-leak 404).
		throw new Error("findOneBySlug not implemented yet");
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
