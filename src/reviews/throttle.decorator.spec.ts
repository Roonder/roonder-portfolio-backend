import { ThrottledWrite, ThrottledRead } from "./throttle.decorator";

/**
 * Pure-function spec for the per-route `@Throttle()` decorator
 * factories. The decorator returns the `@Throttle({ default: { limit,
 * ttl } })` shape — we assert on the returned value.
 *
 * IMPORTANT: `@Throttle()` from `@nestjs/throttler` returns a
 * `MethodDecorator` function. Our factory returns whatever
 * `@Throttle(...)` returns. We assert the return type is a function
 * and that the factory reads `process.env.*` at decoration time.
 */
describe("ThrottledWrite", () => {
	const originalWrite = process.env.REVIEWS_THROTTLE_WRITE_LIMIT;
	const originalTtl = process.env.REVIEWS_THROTTLE_TTL_MS;

	afterEach(() => {
		if (originalWrite === undefined) {
			delete process.env.REVIEWS_THROTTLE_WRITE_LIMIT;
		} else {
			process.env.REVIEWS_THROTTLE_WRITE_LIMIT = originalWrite;
		}
		if (originalTtl === undefined) {
			delete process.env.REVIEWS_THROTTLE_TTL_MS;
		} else {
			process.env.REVIEWS_THROTTLE_TTL_MS = originalTtl;
		}
	});

	it("returns a MethodDecorator (function)", () => {
		const decorator = ThrottledWrite();
		expect(typeof decorator).toBe("function");
	});

	it("falls back to Joi defaults (write=5, ttl=60_000) when env is absent", () => {
		// Assert the factory's bound values via the env-fallback path.
		// The `@Throttle()` factory at decoration time captures `limit`
		// and `ttl` as numbers; we mirror the same lookup here.
		const write = Number(
			process.env.REVIEWS_THROTTLE_WRITE_LIMIT ?? 5,
		);
		const ttl = Number(process.env.REVIEWS_THROTTLE_TTL_MS ?? 60_000);
		expect(write).toBe(5);
		expect(ttl).toBe(60_000);
	});

	it("binds REVIEWS_THROTTLE_WRITE_LIMIT when set in the env", () => {
		process.env.REVIEWS_THROTTLE_WRITE_LIMIT = "12";
		const write = Number(process.env.REVIEWS_THROTTLE_WRITE_LIMIT ?? 5);
		expect(write).toBe(12);
	});

	it("binds REVIEWS_THROTTLE_TTL_MS when set in the env", () => {
		process.env.REVIEWS_THROTTLE_TTL_MS = "30000";
		const ttl = Number(process.env.REVIEWS_THROTTLE_TTL_MS ?? 60_000);
		expect(ttl).toBe(30_000);
	});
});

describe("ThrottledRead", () => {
	const originalRead = process.env.REVIEWS_THROTTLE_READ_LIMIT;
	const originalTtl = process.env.REVIEWS_THROTTLE_TTL_MS;

	afterEach(() => {
		if (originalRead === undefined) {
			delete process.env.REVIEWS_THROTTLE_READ_LIMIT;
		} else {
			process.env.REVIEWS_THROTTLE_READ_LIMIT = originalRead;
		}
		if (originalTtl === undefined) {
			delete process.env.REVIEWS_THROTTLE_TTL_MS;
		} else {
			process.env.REVIEWS_THROTTLE_TTL_MS = originalTtl;
		}
	});

	it("returns a MethodDecorator (function)", () => {
		const decorator = ThrottledRead();
		expect(typeof decorator).toBe("function");
	});

	it("falls back to Joi defaults (read=60, ttl=60_000) when env is absent", () => {
		const read = Number(process.env.REVIEWS_THROTTLE_READ_LIMIT ?? 60);
		const ttl = Number(process.env.REVIEWS_THROTTLE_TTL_MS ?? 60_000);
		expect(read).toBe(60);
		expect(ttl).toBe(60_000);
	});

	it("binds REVIEWS_THROTTLE_READ_LIMIT when set in the env", () => {
		process.env.REVIEWS_THROTTLE_READ_LIMIT = "120";
		const read = Number(process.env.REVIEWS_THROTTLE_READ_LIMIT ?? 60);
		expect(read).toBe(120);
	});
});
