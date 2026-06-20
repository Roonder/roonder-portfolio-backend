import { Throttle } from "@nestjs/throttler";

/**
 * Per-route `@Throttle()` decorator factories for the public
 * Reviews surface. The factories read the throttler env vars
 * directly from `process.env` (NOT via `ConfigService`) because
 * decorator factories run at class-decoration time, before the DI
 * container is built.
 *
 * The values are still validated by Joi at boot via `ConfigModule`
 * (see `src/config/env.config.ts`), so a typo in the env var name
 * or an out-of-range value would prevent the app from starting.
 * The factory's `?? 5 / ?? 60 / ?? 60_000` fallbacks match the Joi
 * defaults exactly, so runtime behavior is identical to the
 * typed `ConfigService` read at module boot.
 *
 * Per ADR-4:
 *   - `ThrottledWrite()` is applied to the two write routes
 *     (`POST /reviews`, `POST /reviews/:id/comments`) and reads
 *     `REVIEWS_THROTTLE_WRITE_LIMIT`.
 *   - `ThrottledRead()` is applied to the two read routes
 *     (`GET /reviews`, `GET /reviews/:id/comments`) and reads
 *     `REVIEWS_THROTTLE_READ_LIMIT`.
 *   - `REVIEWS_THROTTLE_TTL_MS` is the shared TTL window.
 *
 * Per ADR-2, `ThrottlerGuard` is NOT registered as a global
 * `APP_GUARD`; the throttler is per-route via these factories.
 * Admin routes (`/admin/reviews/*`) carry no `@Throttle()` decorator.
 */
export function ThrottledWrite(): MethodDecorator {
	const limit = Number(process.env.REVIEWS_THROTTLE_WRITE_LIMIT ?? 5);
	const ttl = Number(process.env.REVIEWS_THROTTLE_TTL_MS ?? 60_000);
	return Throttle({ default: { limit, ttl } });
}

export function ThrottledRead(): MethodDecorator {
	const limit = Number(process.env.REVIEWS_THROTTLE_READ_LIMIT ?? 60);
	const ttl = Number(process.env.REVIEWS_THROTTLE_TTL_MS ?? 60_000);
	return Throttle({ default: { limit, ttl } });
}
