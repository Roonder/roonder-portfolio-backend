import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import {
	IsArray,
	IsBoolean,
	IsInt,
	IsOptional,
	IsString,
	Max,
	Min,
} from "class-validator";

/**
 * Query string of `GET /api/v1/projects`. Validated by the global
 * `ValidationPipe` with `transform: true` +
 * `enableImplicitConversion: true`, so the `@Type(() => Number)`
 * / `@Type(() => Boolean)` conversions run at request time.
 *
 * Defaults are applied at the service layer (page=1, pageSize=20,
 * tags=[], isPublished=true) so the DTO stays a pure input contract.
 *
 * `pageSize > 100` is silently clamped at the service, NOT rejected
 * with 400 — the spec scenario "pageSize is capped at 100" is
 * permissive on the wire.
 */
export class ListProjectsQueryDto {
	@ApiPropertyOptional({ minimum: 1, default: 1 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number;

	@ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	pageSize?: number;

	@ApiPropertyOptional({ type: [String] })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	@Transform(({ value }: { value: unknown }): string[] => {
		// Query params arrive as either an array (repeated ?tags=a&tags=b)
		// or a single string (single ?tags=a or csv ?tags=a,b). The
		// class-transformer pipeline hands us the raw value BEFORE
		// the array-shape coercion, so we normalise here.
		if (Array.isArray(value)) {
			return value as string[];
		}
		if (typeof value !== "string") return [];
		return value
			.split(",")
			.map((t) => t.trim().toLowerCase())
			.filter((t) => t.length > 0);
	})
	tags?: string[];

	@ApiPropertyOptional({ type: Boolean, default: true })
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		// Query params arrive as strings. `Boolean("false")` is `true`
		// (any non-empty string is truthy), so we cannot rely on the
		// implicit conversion alone — we explicitly parse the
		// "true"/"false" strings and any other truthy/falsy value.
		if (typeof value === "boolean") return value;
		if (typeof value === "string") {
			if (value.toLowerCase() === "true") return true;
			if (value.toLowerCase() === "false") return false;
		}
		return Boolean(value);
	})
	@IsBoolean()
	isPublished?: boolean;
}
