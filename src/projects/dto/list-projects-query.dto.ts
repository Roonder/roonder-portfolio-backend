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
	@Transform(({ obj }: { value: unknown; obj: unknown }) => {
		// The global ValidationPipe runs with `transformOptions:
		// { enableImplicitConversion: true }`, which class-transformer
		// applies BEFORE our @Transform. For a `boolean`-typed field,
		// implicit conversion calls `Boolean(value)`. The string "false"
		// becomes `true` (any non-empty string is truthy), so by the
		// time this @Transform runs the original "true"/"false"
		// distinction is lost — `value` is already the wrong boolean.
		//
		// We recover the original by reading `obj[key]`, which is the
		// pre-transform source object passed by class-transformer.
		const original = (obj as Record<string, unknown> | undefined)?.[
			"isPublished"
		];
		if (typeof original === "string") {
			const lower = original.toLowerCase();
			if (lower === "true") return true;
			if (lower === "false") return false;
			// Any other non-empty string is ambiguous; fall through
			// to the Boolean() coercion for backward compat.
			if (original.length > 0) return Boolean(original);
			return false;
		}
		if (typeof original === "boolean") return original;
		// Defensive: if the original is missing (e.g. the field was
		// not sent), return undefined so the service can apply its
		// default of `true`.
		return undefined;
	})
	@IsBoolean()
	isPublished?: boolean;
}
