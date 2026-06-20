import { ApiProperty } from "@nestjs/swagger";

/**
 * Single `project_urls` row in response bodies. The controller's
 * `findPublic`, `findOneBySlug`, `create`, and `update` return
 * projects with their `urls` shaped as `ProjectUrlResponseDto[]`
 * — this class is the response-side mirror of `ProjectUrlDto` (the
 * input DTO in `src/projects/dto/project-url.dto.ts`).
 */
export class ProjectUrlResponseDto {
	@ApiProperty({ format: "uuid" })
	id!: string;

	@ApiProperty({ maxLength: 100 })
	title!: string;

	@ApiProperty({ maxLength: 2048, format: "uri" })
	url!: string;
}
