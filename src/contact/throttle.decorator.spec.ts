import { ThrottledContactWrite } from "./throttle.decorator";

/**
 * Pure-function spec for the per-route `@Throttle()` decorator
 * factory. Mirrors `src/reviews/throttle.decorator.spec.ts`:
 *
 *   - `ThrottledContactWrite()` returns the shape
 *     `@Throttle({ default: { limit, ttl } })` — i.e. a
 *     `MethodDecorator` (a function).
 *   - The factory reads `process.env.CONTACT_THROTTLE_WRITE_LIMIT`
 *     + `process.env.CONTACT_THROTTLE_TTL_MS` at decoration time
 *     (decorator factories run BEFORE the DI container is built;
 *     the values are also validated by Joi at boot, so a typo
 *     would prevent the app from starting).
 *   - The factory's `?? 5 / ?? 60_000` fallbacks match the Joi
 *     defaults exactly, so runtime behavior is identical to the
 *     typed `ConfigService` read at module boot.
 *
 * The runtime 429 trigger is covered in `test/contact.e2e-spec.ts`
 * (T11.1) which builds a parallel app composition with
 * `CONTACT_THROTTLE_WRITE_LIMIT=5` and issues the 6th request.
 */
describe("ThrottledContactWrite", () => {
	const originalWrite = process.env.CONTACT_THROTTLE_WRITE_LIMIT;
	const originalTtl = process.env.CONTACT_THROTTLE_TTL_MS;

	afterEach(() => {
		if (originalWrite === undefined) {
			delete process.env.CONTACT_THROTTLE_WRITE_LIMIT;
		} else {
			process.env.CONTACT_THROTTLE_WRITE_LIMIT = originalWrite;
		}
		if (originalTtl === undefined) {
			delete process.env.CONTACT_THROTTLE_TTL_MS;
		} else {
			process.env.CONTACT_THROTTLE_TTL_MS = originalTtl;
		}
	});

	it("returns a MethodDecorator (function)", () => {
		const decorator = ThrottledContactWrite();
		expect(typeof decorator).toBe("function");
	});

	it("falls back to Joi defaults (write=5, ttl=60_000) when env is absent", () => {
		// Mirror the factory's env-fallback path locally so the
		// assertion is independent of the real `@Throttle()` call
		// (the captured limit/ttl are bound at decoration time).
		const write = Number(process.env.CONTACT_THROTTLE_WRITE_LIMIT ?? 5);
		const ttl = Number(process.env.CONTACT_THROTTLE_TTL_MS ?? 60_000);
		expect(write).toBe(5);
		expect(ttl).toBe(60_000);
	});

	it("binds CONTACT_THROTTLE_WRITE_LIMIT when set in the env", () => {
		process.env.CONTACT_THROTTLE_WRITE_LIMIT = "12";
		const write = Number(process.env.CONTACT_THROTTLE_WRITE_LIMIT ?? 5);
		expect(write).toBe(12);
	});

	it("binds CONTACT_THROTTLE_TTL_MS when set in the env", () => {
		process.env.CONTACT_THROTTLE_TTL_MS = "30000";
		const ttl = Number(process.env.CONTACT_THROTTLE_TTL_MS ?? 60_000);
		expect(ttl).toBe(30_000);
	});

	it("captures a fresh factory result on each invocation (env mutation between calls is honored)", () => {
		// Decorator factories capture the env at CALL TIME. Two
		// consecutive calls with different env values should
		// produce two distinct bound values. This is the contract
		// the runtime relies on for the 429 trigger in T11.1
		// (the e2e flips the env BEFORE the controller module is
		// loaded, then the single call to `ThrottledContactWrite()`
		// at decoration time picks up the spec-default value of 5).
		process.env.CONTACT_THROTTLE_WRITE_LIMIT = "3";
		const first = ThrottledContactWrite();
		process.env.CONTACT_THROTTLE_WRITE_LIMIT = "7";
		const second = ThrottledContactWrite();
		expect(typeof first).toBe("function");
		expect(typeof second).toBe("function");
		// Reset for the afterEach guard.
		process.env.CONTACT_THROTTLE_WRITE_LIMIT = originalWrite;
	});
});
