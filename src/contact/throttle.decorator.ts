import { Throttle } from "@nestjs/throttler";

/**
 * Per-route `@Throttle()` decorator factory for the public Contact
 * surface. Mirrors `src/reviews/throttle.decorator.ts` (the
 * `ThrottledWrite` factory) — reads the throttler env vars
 * directly from `process.env` (NOT via `ConfigService`) because
 * decorator factories run at class-decoration time, before the DI
 * container is built.
 *
 * The values are still validated by Joi at boot via `ConfigModule`
 * (see `src/config/env.config.ts`), so a typo in the env var name
 * or an out-of-range value would prevent the app from starting.
 * The factory's `?? 5 / ?? 60_000` fallbacks match the Joi
 * defaults exactly, so runtime behavior is identical to the typed
 * `ConfigService` read at module boot.
 *
 * Per ADR-2 / ADR-4: `ThrottlerGuard` is NOT registered as a global
 * `APP_GUARD`; the throttler is per-route via this factory. The
 * admin routes (`/admin/contacts/*`) carry no `@Throttle()`
 * decorator (verified by the static metadata assertion in
 * `src/contact/contact-admin.controller.spec.ts`).
 *
 * The runtime 429 trigger is covered end-to-end in
 * `test/contact.e2e-spec.ts` (T11.1) which builds a parallel app
 * composition with `CONTACT_THROTTLE_WRITE_LIMIT=5` and issues
 * the 6th request.
 */
export function ThrottledContactWrite(): MethodDecorator {
	const limit = Number(process.env["CONTACT_THROTTLE_WRITE_LIMIT"] ?? 5);
	const ttl = Number(process.env["CONTACT_THROTTLE_TTL_MS"] ?? 60_000);
	return Throttle({ default: { limit, ttl } });
}
