import Joi from "joi";

export interface EnvConfig {
	PORT: number;
	DATABASE_URL: string;
	JWT_SECRET: string;
	RESEND_API_KEY: string;
	FRONTEND_URL: string;
}

export const ENV_CONFIG = Joi.object<EnvConfig>({
	PORT: Joi.number().required(),
	DATABASE_URL: Joi.string().required(),
	JWT_SECRET: Joi.string().required(),
	FRONTEND_URL: Joi.string().required(),
	RESEND_API_KEY: Joi.string().required(),
});
