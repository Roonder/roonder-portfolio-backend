import {
	Injectable,
	ConflictException,
	NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
	DataSource,
	type EntityManager,
	QueryFailedError,
	Repository,
} from "typeorm";
import { ProjectEntity } from "./entities/project.entity";
import { ProjectUrlEntity } from "./entities/project-url.entity";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { ListProjectsQueryDto } from "./dto/list-projects-query.dto";
import type { ListProjectsResult } from "./dto/list-projects-response.dto";
import type { ProjectResponseDto } from "./dto/project-response.dto";
import type { ProjectUrlDto } from "./dto/project-url.dto";
import { toProjectResponse } from "./project-response.mapper";
import { withRetry } from "../common/with-retry";

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

	/**
	 * `POST /api/v1/projects` — admin create.
	 *
	 * Flow:
	 *   1. Pre-check `slug` uniqueness via `findOne` with
	 *      `select: { id: true }`. If a row already exists, throw
	 *      `ConflictException("Slug already in use")` BEFORE the
	 *      transaction (saves a wasted transaction).
	 *   2. Open `dataSource.transaction(...)` and persist the
	 *      project row + initial `project_urls` rows inside it.
	 *   3. On `QueryFailedError` with PG code `23505` (unique
	 *      violation) re-throw `ConflictException` — the spec
	 *      scenario "Duplicate slug returns 409" requires the same
	 *      response body for the pre-check and the race-catch.
	 *   4. Any other error re-throws untouched (the filter renders
	 *      a 500 with full diagnostics in dev, sanitised in prod).
	 *
	 * The transaction is `READ COMMITTED` (Postgres default; ADR-4).
	 * The pre-check is NOT inside the transaction — it is a fast
	 * optimistic check. The race-catch covers the case where two
	 * admins POST the same slug at the same time.
	 */
	async create(dto: CreateProjectDto): Promise<ProjectResponseDto> {
		const existing = await this.projects.findOne({
			where: { slug: dto.slug },
			select: { id: true },
		});
		if (existing) {
			throw new ConflictException("Slug already in use");
		}
		try {
			const saved = await withRetry(() =>
				this.dataSource.transaction(
					async (manager): Promise<ProjectEntity> => {
						const row = manager.create(ProjectEntity, {
							title: dto.title,
							slug: dto.slug,
							description: dto.description,
							content: dto.content ?? null,
							coverImage: dto.coverImage ?? null,
							tags: dto.tags ?? [],
							isPublished: dto.isPublished ?? false,
						});
						const persisted = await manager.save(row);
						if (dto.urls && dto.urls.length > 0) {
							await manager.insert(
								ProjectUrlEntity,
								dto.urls.map((u) => ({
									projectId: persisted.id,
									title: u.title,
									url: u.url,
								})),
							);
						}
						return persisted;
					},
				),
			);
			// Re-fetch with the urls relation so the response body
			// matches `ProjectResponseDto.urls` shape.
			const withUrls = await this.projects.findOne({
				where: { id: saved.id },
				relations: { urls: true },
			});
			return toProjectResponse(withUrls ?? saved);
		} catch (e) {
			// Postgres code 23505 = unique_violation. We only
			// translate it to a 409 when the violation is on the
			// slug (the only unique constraint we touch here).
			if (this.isSlugUniqueViolation(e)) {
				throw new ConflictException("Slug already in use");
			}
			throw e;
		}
	}

	/**
	 * Returns true if `e` is a `QueryFailedError` whose driver
	 * error has code `23505` AND the message mentions `slug`
	 * (the only unique index this service writes to). Other
	 * unique violations (e.g. a future `project_urls.url` index)
	 * would still 500 — the spec only locks the slug case.
	 */
	private isSlugUniqueViolation(e: unknown): boolean {
		if (!(e instanceof QueryFailedError)) return false;
		const code = (e as QueryFailedError & { code?: string }).code;
		const message = e.message ?? "";
		return code === "23505" && /slug/i.test(message);
	}

	/**
	 * `PATCH /api/v1/projects/:id` — admin update.
	 *
	 * Field semantics (per ADR-1):
	 *   - `dto.urls` is `undefined` (field absent) → no urls change.
	 *   - `dto.urls` is `[]` (empty array) → remove ALL urls for the project.
	 *   - `dto.urls` is `[{...}, ...]` (non-empty) → apply DIFF.
	 *
	 * The pre-check for the project's existence runs BEFORE the
	 * transaction (404 fast path). The slug uniqueness pre-check
	 * also runs inside the same transaction so a concurrent create
	 * on the same slug is covered by the 23505 race-catch.
	 *
	 * The transaction is `READ COMMITTED` (Postgres default; ADR-4)
	 * wrapped in `withRetry` (3 attempts on PG `40001`/`40P01`).
	 * Single-admin contention is rare; the retry handles the
	 * `serialization_failure` and `deadlock_detected` cases that
	 * would otherwise surface as a 500 to the user.
	 */
	async update(
		id: string,
		dto: UpdateProjectDto,
	): Promise<ProjectResponseDto> {
		// Pre-check: 404 fast path. Inside the transaction the same
		// row would be re-fetched, but a missing project cannot be
		// updated, so we exit before opening the transaction.
		const existing = await this.projects.findOne({ where: { id } });
		if (!existing) {
			throw new NotFoundException("Project not found");
		}
		try {
			return await withRetry(() =>
				this.dataSource.transaction(
					async (manager): Promise<ProjectResponseDto> => {
						const row =
							(await manager.findOne(ProjectEntity, {
								where: { id },
							})) ?? existing;
						if (dto.slug && dto.slug !== row.slug) {
							const collision = await manager.findOne(
								ProjectEntity,
								{
									where: { slug: dto.slug },
									select: { id: true },
								},
							);
							if (collision && collision.id !== id) {
								throw new ConflictException(
									"Slug already in use",
								);
							}
							row.slug = dto.slug;
						}
						if (dto.title !== undefined) row.title = dto.title;
						if (dto.description !== undefined) {
							row.description = dto.description;
						}
						if (dto.content !== undefined) {
							row.content = dto.content;
						}
						if (dto.coverImage !== undefined) {
							row.coverImage = dto.coverImage;
						}
						if (dto.tags !== undefined) row.tags = dto.tags;
						if (dto.isPublished !== undefined) {
							row.isPublished = dto.isPublished;
						}
						await manager.save(row);
						// ADR-1: `'urls' in dto` distinguishes field-absent
						// (no change) from empty-array (remove all). We
						// operate on the dto's own properties, not the
						// entity's `urls` field (the entity always has
						// `urls: ProjectUrlEntity[]` regardless).
						if (Object.prototype.hasOwnProperty.call(dto, "urls")) {
							const desired = dto.urls ?? [];
							await this.applyProjectUrlsDiff(
								id,
								desired,
								manager,
							);
						}
						// Re-fetch with the relation so the response body
						// matches the response DTO shape.
						const refreshed =
							(await manager.findOne(ProjectEntity, {
								where: { id },
								relations: { urls: true },
							})) ?? row;
						return toProjectResponse(refreshed);
					},
				),
			);
		} catch (e) {
			if (this.isSlugUniqueViolation(e)) {
				throw new ConflictException("Slug already in use");
			}
			throw e;
		}
	}

	/**
	 * Apply a DIFF between the project's current `project_urls` rows
	 * and the desired set. Match by `(title, lower(url))` pair per
	 * ADR-1. The diff is computed in-memory and then translated to
	 * `manager.insert` (added) and `manager.delete` (removed) calls.
	 *
	 * Empty `desired` removes all rows for the project (the
	 * `urls: []` signal in the update path). Non-empty `desired`
	 * preserves any existing rows whose `(title, lower(url))` pair
	 * matches an incoming entry.
	 *
	 * The DIFF runs inside a caller-provided `EntityManager` so the
	 * caller can compose it with the project-row update in a single
	 * `dataSource.transaction(...)`. The 23505 race-catch on the
	 * slug path is the caller's responsibility (the URL DIFF itself
	 * has no unique constraints to violate).
	 */
	async applyProjectUrlsDiff(
		projectId: string,
		desired: ProjectUrlDto[],
		manager: EntityManager,
	): Promise<void> {
		const existing = await manager.find(ProjectUrlEntity, {
			where: { projectId },
		});
		const keyOf = (title: string, url: string): string =>
			`${title}|${url.toLowerCase()}`;
		const existingByKey = new Map(
			existing.map((r) => [keyOf(r.title, r.url), r] as const),
		);
		const desiredByKey = new Map(
			desired.map((d) => [keyOf(d.title, d.url), d] as const),
		);
		const toInsert = desired.filter(
			(d) => !existingByKey.has(keyOf(d.title, d.url)),
		);
		const toDelete = existing.filter(
			(r) => !desiredByKey.has(keyOf(r.title, r.url)),
		);
		if (toInsert.length > 0) {
			await manager.insert(
				ProjectUrlEntity,
				toInsert.map((u) => ({
					projectId,
					title: u.title,
					url: u.url,
				})),
			);
		}
		if (toDelete.length > 0) {
			await manager.delete(
				ProjectUrlEntity,
				toDelete.map((r) => r.id),
			);
		}
	}

	/**
	 * `DELETE /api/v1/projects/:id` — admin hard delete.
	 *
	 * `this.projects.delete({ id })` returns a `DeleteResult` with
	 * `affected: number | undefined`. We treat 0 OR undefined as
	 * "no row matched" and throw `NotFoundException` — the same
	 * body as the `findOneBySlug` 404, defensive consistency.
	 *
	 * The cascade to `project_urls` is at the DB layer: the FK in
	 * `ProjectUrlEntity.project` is configured with
	 * `onDelete: 'CASCADE'` (Task 1.2), so the `project_urls` rows
	 * are removed in the same DB operation. The service does NOT
	 * issue a manual `manager.delete` for the child rows.
	 */
	async remove(id: string): Promise<void> {
		const result = await this.projects.delete({ id });
		const affected = result.affected ?? 0;
		if (affected === 0) {
			throw new NotFoundException("Project not found");
		}
	}
}
