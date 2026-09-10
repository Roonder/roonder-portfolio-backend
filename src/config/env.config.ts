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
	// contact-domain (T1.1): the `from` address MUST allow the
	// friendly-name form `"Name <email@domain>"` that Resend's API
	// accepts. Joi's `.email()` would reject the angle brackets,
	// so the schema uses `.string()` only and the runtime trusts
	// the operator to put a valid address. The `to` address is a
	// bare email (Resend rejects the friendly-name form on `to`),
	// so the schema enforces `.email()`.
	RESEND_FROM_ADDRESS: string;
	RESEND_TO_ADDRESS: string;
	FRONTEND_URL: string;
	// `NODE_ENV` is consumed by the global exception filter (Task 1.6/1.7)
	// to choose the prod vs dev 5xx sanitization branch. Joi's `.default()`
	// keeps the field present at runtime; the optional `?` in the
	// interface reflects the fact that the env var is NOT required.
	NODE_ENV?: string;
	// reviews-throttling (T1): the three knobs that tune
	// `@nestjs/throttler` at boot. Floors prevent the operator from
	// accidentally setting a zero-millisecond window (TTL < 1_000) or
	// a zero-limit (limit < 1). Defaults match the spec proposal.
	REVIEWS_THROTTLE_TTL_MS: number;
	REVIEWS_THROTTLE_WRITE_LIMIT: number;
	REVIEWS_THROTTLE_READ_LIMIT: number;
	// contact-throttling (T1.1): same shape as the reviews knobs.
	// The `_READ_LIMIT` is reserved for forward-compat (no public
	// contact read is throttled today; if a `GET /api/v1/contacts/:id`
	// route is added later, the env-var naming is already consistent).
	// Floors match the reviews precedent exactly.
	CONTACT_THROTTLE_TTL_MS: number;
	CONTACT_THROTTLE_WRITE_LIMIT: number;
	CONTACT_THROTTLE_READ_LIMIT: number;
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
	// contact-domain addressing (T1.1, proposal §6 #4).
	// `RESEND_FROM_ADDRESS` is `.string()` (NOT `.email()`) so the
	// friendly-name form `"Name <email@domain>"` passes. Resend
	// will reject the send at runtime if the address is unverified.
	// `RESEND_TO_ADDRESS` is a bare email; Resend rejects the
	// friendly-name form on `to`, so the schema enforces `.email()`.
	RESEND_FROM_ADDRESS: Joi.string().required(),
	RESEND_TO_ADDRESS: Joi.string().email().required(),
	NODE_ENV: Joi.string()
		.valid("development", "test", "production")
		.default("development"),
	// reviews-throttling: throttler configuration (T1, ADR-3 / ADR-4).
	// `min(1_000)` on the TTL prevents a zero-millisecond window; the
	// limit floors prevent the operator from accidentally disabling the
	// throttler via a 0 (the documented "disable" knob is to set the
	// limit to 1_000_000 — see the README).
	REVIEWS_THROTTLE_TTL_MS: Joi.number().integer().min(1_000).default(60_000),
	REVIEWS_THROTTLE_WRITE_LIMIT: Joi.number().integer().min(1).default(5),
	REVIEWS_THROTTLE_READ_LIMIT: Joi.number().integer().min(1).default(60),
	// contact-throttling (T1.1): same shape + floors as reviews.
	CONTACT_THROTTLE_TTL_MS: Joi.number().integer().min(1_000).default(60_000),
	CONTACT_THROTTLE_WRITE_LIMIT: Joi.number().integer().min(1).default(5),
	CONTACT_THROTTLE_READ_LIMIT: Joi.number().integer().min(1).default(60),
});
