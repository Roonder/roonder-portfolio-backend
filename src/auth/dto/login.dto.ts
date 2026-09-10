import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

/**
 * Body of `POST /api/v1/auth/login`. Validated by the global
 * `ValidationPipe` (whitelist + forbidNonWhitelisted + transform).
 * The `password` minimum matches the env schema's
 * `SUPERUSER_PASSWORD` requirement (8 chars).
 */
export class LoginDto {
	@ApiProperty({ format: "email" })
	@IsEmail()
	email!: string;

	@ApiProperty({ minLength: 8 })
	@IsString()
	@MinLength(8)
	password!: string;
}
