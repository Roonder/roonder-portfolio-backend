import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * Query string of `GET /api/v1/admin/contacts`. Validated by the
 * global `ValidationPipe` with `transform: true` +
 * `enableImplicitConversion: true`, so the `@Type(() => Number)`
 * conversion runs at request time.
 *
 * Defaults (applied at the service, NOT the DTO — same shape as
 * `ListReviewsQueryDto`):
 *   - `page = 1`
 *   - `pageSize = 20`
 *   - `pageSize` is silently capped at 100 (the DTO has
 *     `@Max(100)` to fail-fast on the wire; the service re-clamps
 *     for the in-spec "silently capped" contract).
 */
export class ListContactsQueryDto {
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
}
