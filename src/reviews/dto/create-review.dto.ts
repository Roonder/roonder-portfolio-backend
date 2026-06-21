import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
	IsInt,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
	MinLength,
} from "class-validator";

/**
 * Body of `POST /api/v1/reviews` (public). Validated by the global
 * `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` +
 * `transform` (configured in main.ts).
 *
 * Field caps (per the spec lock + the ADR-9 DTO-only rating gate):
 *   - `content` is required, 10..2000 chars.
 *   - `rating` is required, integer 1..5 (no DB CHECK; the DTO is
 *     the only gate).
 *   - `authorName` is optional, max 100 chars.
 *   - `authorRole` is optional, max 120 chars.
 *
 * NO `projectId` / `ownerUserId` / `subjectType` (locked #1, ADR-1).
 * The DTO is the canonical proof at the API surface: any future
 * commit that adds one of those fields will be rejected by the
 * spec scenario "Unknown body field returns 400 (forbidNonWhitelisted)".
 */
export class CreateReviewDto {
	@ApiPropertyOptional({ maxLength: 100 })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	authorName?: string;

	@ApiPropertyOptional({ maxLength: 120 })
	@IsOptional()
	@IsString()
	@MaxLength(120)
	authorRole?: string;

	@ApiProperty({ minLength: 10, maxLength: 2_000 })
	@IsString()
	@MinLength(10)
	@MaxLength(2_000)
	content!: string;

	@ApiProperty({ minimum: 1, maximum: 5 })
	@IsInt()
	@Min(1)
	@Max(5)
	rating!: number;
}
