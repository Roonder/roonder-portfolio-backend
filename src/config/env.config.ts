import Joi from "joi";

export interface EnvConfig {
	PORT: number;
	DATABASE_URL: string;
	JWT_SECRET: string;
	JWT_EXPIRES_IN: string;
	JWT_REFRESH_SECRET: string;
	JWT_REFRESH_EXPIRES_IN: string;
	SUPERUSER_EMAIL: string;
	SUPERUSER_PASSWORD: string;
	RESEND_API_KEY: string;
	FRONTEND_URL: string;
}

export const ENV_CONFIG = Joi.object<EnvConfig>({
	PORT: Joi.number().required(),
	DATABASE_URL: Joi.string().required(),
	JWT_SECRET: Joi.string().required(),
	// NestJS duration parser validates the format at issue time, so we only
	// enforce non-emptiness here (e.g. "15m", "1h").
	JWT_EXPIRES_IN: Joi.string().required(),
	// At least 32 chars and MUST be distinct from JWT_SECRET — compromise of
	// one must not compromise the other.
	JWT_REFRESH_SECRET: Joi.string()
		.min(32)
		.invalid(Joi.ref("JWT_SECRET"))
		.required(),
	// Seconds-notation integer string. Drives both the refresh token `exp`
	// claim and the cookie `Max-Age` (direct mapping, no parsing).
	JWT_REFRESH_EXPIRES_IN: Joi.string().pattern(/^\d+$/).required(),
	SUPERUSER_EMAIL: Joi.string().email().required(),
	SUPERUSER_PASSWORD: Joi.string().min(8).required(),
	FRONTEND_URL: Joi.string().required(),
	RESEND_API_KEY: Joi.string().required(),
});
