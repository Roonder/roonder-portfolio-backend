import type { ProjectEntity } from "./entities/project.entity";
import type { ProjectResponseDto } from "./dto/project-response.dto";
import type { ProjectUrlResponseDto } from "./dto/project-url-response.dto";

/**
 * Project entity → response DTO. Used by every public/admin read
 * (findPublic, findOneBySlug, create, update) and by the
 * controller to shape the body. The mapper is the single point
 * where the response shape is decided — controllers and tests
 * consume the same shape via `ProjectResponseDto`.
 *
 * `urls` defaults to `[]` when the relation was not loaded
 * (e.g. on a write path that returns the row without a re-join).
 * For the DIFF path (Task 2.6), the manager-side save is followed
 * by a manual `applyProjectUrlsDiff`; the response reflects the
 * post-DIFF state.
 */
export function toProjectResponse(row: ProjectEntity): ProjectResponseDto {
	return {
		id: row.id,
		title: row.title,
		slug: row.slug,
		description: row.description,
		content: row.content,
		coverImage: row.coverImage,
		tags: row.tags ?? [],
		isPublished: row.isPublished,
		urls: (row.urls ?? []).map(toProjectUrlResponse),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toProjectUrlResponse(
	row: NonNullable<ProjectEntity["urls"]>[number],
): ProjectUrlResponseDto {
	return {
		id: row.id,
		title: row.title,
		url: row.url,
	};
}
