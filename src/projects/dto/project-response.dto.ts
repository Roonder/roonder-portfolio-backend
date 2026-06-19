import { ApiProperty } from "@nestjs/swagger";
import { ProjectUrlResponseDto } from "./project-url-response.dto";

/**
 * Single project in response bodies. Used by `findPublic`,
 * `findOneBySlug`, `create`, and `update`. Field set is the spec
 * scenario "Published project is returned by slug" — id, title,
 * slug, description, content, coverImage, tags, isPublished, urls,
 * and timestamps. `tags` is `string[]` (not `text[]` — at the API
 * boundary we render the array the same way the entity holds it).
 */
export class ProjectResponseDto {
	@ApiProperty({ format: "uuid" })
	id!: string;

	@ApiProperty({ maxLength: 200 })
	title!: string;

	@ApiProperty({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" })
	slug!: string;

	@ApiProperty({ maxLength: 500 })
	description!: string;

	@ApiProperty({ maxLength: 50_000, nullable: true })
	content!: string | null;

	@ApiProperty({ format: "uri", nullable: true })
	coverImage!: string | null;

	@ApiProperty({ type: [String] })
	tags!: string[];

	@ApiProperty()
	isPublished!: boolean;

	@ApiProperty({ type: [ProjectUrlResponseDto] })
	urls!: ProjectUrlResponseDto[];

	@ApiProperty({ format: "date-time" })
	createdAt!: Date;

	@ApiProperty({ format: "date-time" })
	updatedAt!: Date;
}
