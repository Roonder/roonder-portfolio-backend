import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Body of `POST /api/v1/reviews/:id/comments` (public). Validated
 * by the global `ValidationPipe` with `whitelist` +
 * `forbidNonWhitelisted` + `transform` (configured in main.ts).
 *
 * Field caps (per the spec lock + ADR-1 no-subject-polymorphism):
 *   - `content` is required, 2..1_000 chars.
 *   - `authorName` is optional, max 100 chars (defaults to
 *     `'Anónimo'` at the DB level).
 *
 * NO `projectId` / `ownerUserId` / `subjectType` (locked #1,
 * ADR-1). The DTO is the canonical proof at the API surface:
 * any future commit that adds one of those fields will be
 * rejected by the spec scenario "Unknown body field returns 400
 * (forbidNonWhitelisted)".
 */
export class CreateReviewCommentDto {
	@ApiPropertyOptional({ maxLength: 100 })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	authorName?: string;

	@ApiProperty({ minLength: 2, maxLength: 1_000 })
	@IsString()
	@MinLength(2)
	@MaxLength(1_000)
	content!: string;
}
