import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsNotEmpty,
	IsOptional,
	IsString,
	IsUrl,
	Matches,
	MaxLength,
	ValidateNested,
} from "class-validator";
import { IsUniqueUrlInArray } from "./validators/is-unique-url-in-array.validator";
import { ProjectUrlDto } from "./project-url.dto";

/**
 * Body of `POST /api/v1/projects` (admin). Validated by the global
 * `ValidationPipe` with `whitelist` + `forbidNonWhitelisted` +
 * `transform` + `enableImplicitConversion` (configured in main.ts).
 *
 * Field notes:
 * - `slug` must be kebab-case (`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`).
 *   Uniqueness is enforced in the service (slug pre-check + 23505
 *   race-catch) — not here — because the DTO has no DB context.
 * - `tags` is normalised at transform time: trim, lowercase, dedupe.
 *   The transform runs even when the field is `@IsOptional` and the
 *   value is undefined, so the result is always an array.
 * - `urls` is dedup'd by the `@IsUniqueUrlInArray` constraint
 *   (ADR-2). Empty array is allowed; service interprets it as
 *   "no urls to attach" on create (vs. PATCH, where empty is
 *   "remove all").
 */
export class CreateProjectDto {
	@ApiProperty({ maxLength: 200 })
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	title!: string;

	@ApiProperty({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" })
	@IsString()
	@IsNotEmpty()
	@Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	slug!: string;

	@ApiProperty({ maxLength: 500 })
	@IsString()
	@IsNotEmpty()
	@MaxLength(500)
	description!: string;

	@ApiProperty({ maxLength: 50_000, required: false })
	@IsString()
	@IsOptional()
	@MaxLength(50_000)
	content?: string;

	@ApiProperty({ required: false, format: "uri" })
	@IsOptional()
	@IsUrl({ require_protocol: true, protocols: ["http", "https"] })
	coverImage?: string;

	@ApiProperty({ type: [String], required: false, maxItems: 20 })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	@ArrayMaxSize(20)
	@Transform(({ value }: { value: unknown }) => {
		if (!Array.isArray(value)) return value;
		const out: string[] = [];
		const seen = new Set<string>();
		for (const t of value) {
			if (typeof t !== "string") continue;
			const norm = t.trim().toLowerCase();
			if (!norm || seen.has(norm)) continue;
			seen.add(norm);
			out.push(norm);
		}
		return out;
	})
	tags?: string[];

	@ApiProperty({ required: false, default: false })
	@IsOptional()
	@IsBoolean()
	isPublished?: boolean;

	@ApiProperty({ type: [ProjectUrlDto], required: false, maxItems: 50 })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProjectUrlDto)
	@ArrayMaxSize(50)
	@IsUniqueUrlInArray()
	urls?: ProjectUrlDto[];
}
