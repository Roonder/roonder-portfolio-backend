import { Throttle } from "@nestjs/throttler";

/**
 * `POST /auth/login` is the one admin-surface route that stays
 * throttled — it is the brute-force target. Every other admin route
 * (`refresh`, `logout`, `profile`, and the JwtAuthGuard-protected
 * projects writes) carries `@SkipThrottle()` instead: they already
 * require a valid credential, so the global default tracker (tuned
 * for public write abuse — see `reviews/throttle.decorator.ts`) only
 * starved authenticated admin usage without adding real protection.
 */
export function ThrottledLogin(): MethodDecorator {
	const limit = Number(process.env.ADMIN_THROTTLE_LOGIN_LIMIT ?? 10);
	const ttl = Number(process.env.ADMIN_THROTTLE_TTL_MS ?? 60_000);
	return Throttle({ default: { limit, ttl } });
}
