import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, IsUrl, MaxLength } from "class-validator";

/**
 * Nested payload for a single `project_urls` row. Used inside
 * `CreateProjectDto.urls` and `UpdateProjectDto.urls`. The uniqueness
 * rule (no two entries with the same `url`) is enforced at the array
 * level by `@IsUniqueUrlInArray` — see ADR-2.
 */
export class ProjectUrlDto {
	@ApiProperty({ maxLength: 100 })
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	title!: string;

	@ApiProperty({
		maxLength: 2048,
		format: "uri",
		description: "http or https URL",
	})
	@IsString()
	@IsUrl({ require_protocol: true, protocols: ["http", "https"] })
	@MaxLength(2048)
	url!: string;
}
