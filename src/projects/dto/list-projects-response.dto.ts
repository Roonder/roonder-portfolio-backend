import { ApiProperty } from "@nestjs/swagger";
import { ProjectResponseDto } from "./project-response.dto";

/**
 * Plain result interface for `findPublic`. The service returns this
 * (NOT a class instance) — the controller wraps it in
 * `ListProjectsResponseDto` for the response body. The interface
 * keeps the service signature stable without forcing a class
 * construction at every call.
 */
export interface ListProjectsResult {
	data: ProjectResponseDto[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * Envelope for `GET /api/v1/projects`. Shape is locked by the
 * product decision: `{ data, total, page, pageSize }`. The
 * `data` array holds `ProjectResponseDto`; the other three fields
 * are the pagination metadata. `total` is the count of rows that
 * matched the filter, NOT the length of `data` (which is capped at
 * `pageSize`).
 */
export class ListProjectsResponseDto implements ListProjectsResult {
	@ApiProperty({ type: [ProjectResponseDto] })
	data!: ProjectResponseDto[];

	@ApiProperty({ minimum: 0 })
	total!: number;

	@ApiProperty({ minimum: 1, default: 1 })
	page!: number;

	@ApiProperty({ minimum: 1, maximum: 100, default: 20 })
	pageSize!: number;
}
