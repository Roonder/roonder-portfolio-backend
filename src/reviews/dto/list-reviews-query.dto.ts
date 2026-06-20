import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type, Transform } from "class-transformer";
import {
	IsBoolean,
	IsInt,
	IsOptional,
	Max,
	Min,
} from "class-validator";

/**
 * Query string of `GET /api/v1/reviews` (public). Validated by the
 * global `ValidationPipe` with `transform: true` +
 * `enableImplicitConversion: true`, so the `@Type(() => Number)` /
 * `@Type(() => Boolean)` conversions run at request time.
 *
 * Defaults (applied at the service, NOT the DTO — same shape as
 * `ListProjectsQueryDto`):
 *   - `page = 1`
 *   - `pageSize = 20`
 *   - `pageSize` is silently capped at 100 (the DTO has `@Max(100)`
 *     to fail-fast on the wire; the service re-clamps for the
 *     in-spec "silently capped" contract).
 *
 * `isApproved` is admin-only (the service ignores it on the public
 * list and forces `isApproved: true`). The DTO still declares the
 * field so the admin controller can reuse this DTO with the
 * override.
 */
export class ListReviewsQueryDto {
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

	@ApiPropertyOptional({ minimum: 1, maximum: 5 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(5)
	rating?: number;

	@ApiPropertyOptional({ type: Boolean, default: true })
	@IsOptional()
	@Transform(({ obj }: { value: unknown; obj: unknown }) => {
		// The global ValidationPipe runs with
		// `transformOptions: { enableImplicitConversion: true }`, so
		// for a `boolean`-typed field, implicit conversion calls
		// `Boolean(value)`. The string "false" becomes `true` BEFORE
		// the @Transform runs. Recover the original via the `obj`
		// parameter (mirrors the projects DTO pattern).
		const original = (obj as Record<string, unknown> | undefined)?.[
			"isApproved"
		];
		if (typeof original === "string") {
			const lower = original.toLowerCase();
			if (lower === "true") return true;
			if (lower === "false") return false;
			if (original.length > 0) return Boolean(original);
			return false;
		}
		if (typeof original === "boolean") return original;
		return undefined;
	})
	@IsBoolean()
	isApproved?: boolean;
}
