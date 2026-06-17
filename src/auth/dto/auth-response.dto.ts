import { ApiProperty } from "@nestjs/swagger";

/**
 * Response body of `POST /api/v1/auth/login` and
 * `POST /api/v1/auth/refresh`. The refresh token is delivered via
 * the `rt` HttpOnly cookie, not in the body — the body carries
 * only the short-lived access token and its TTL.
 */
export class AuthResponseDto {
	@ApiProperty({
		description: "Signed JWT access token (Bearer). Short-lived.",
	})
	accessToken!: string;

	@ApiProperty({ description: "Access token TTL in seconds." })
	expiresIn!: number;
}
