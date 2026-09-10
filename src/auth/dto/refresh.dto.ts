import { ApiProperty } from "@nestjs/swagger";

/**
 * Body of `POST /api/v1/auth/refresh`. The refresh token is taken
 * from the `rt` HttpOnly cookie, NOT the body. The empty class
 * exists so Swagger documents the endpoint and the global
 * `forbidNonWhitelisted` validation pipe accepts an empty body.
 */
export class RefreshDto {
	@ApiProperty({
		required: false,
		description: "Unused. The refresh token is read from the rt cookie.",
	})
	_placeholder?: never;
}
