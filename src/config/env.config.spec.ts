// Set process.env BEFORE the ENV_CONFIG import is exercised so the
// Joi schema's `.default()` rules see a deterministic baseline.
process.env.PORT = "3000";
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test-secret-32-chars-min-..................";
process.env.JWT_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_SECRET = "refresh-secret-32-chars-min-......";
process.env.JWT_REFRESH_EXPIRES_IN = "2592000";
process.env.SUPERUSER_EMAIL = "admin@test.io";
process.env.SUPERUSER_PASSWORD = "test-password";
process.env.RESEND_API_KEY = "re_test";
process.env.FRONTEND_URL = "https://app.example.com";

import { ENV_CONFIG, EnvConfig } from "./env.config";

describe("EnvConfig Joi schema", () => {
	const baseValidEnv: Record<string, string> = {
		PORT: "3000",
		DATABASE_URL: "postgres://test:test@localhost:5432/test",
		JWT_SECRET: "test-secret-32-chars-min-..................",
		JWT_EXPIRES_IN: "15m",
		JWT_REFRESH_SECRET: "refresh-secret-32-chars-min-......",
		JWT_REFRESH_EXPIRES_IN: "2592000",
		SUPERUSER_EMAIL: "admin@test.io",
		SUPERUSER_PASSWORD: "test-password",
		RESEND_API_KEY: "re_test",
		FRONTEND_URL: "https://app.example.com",
	};

	it("accepts NODE_ENV=production", () => {
		const result = ENV_CONFIG.validate({
			...baseValidEnv,
			NODE_ENV: "production",
		});
		expect(result.error).toBeUndefined();
		expect((result.value as EnvConfig).NODE_ENV).toBe("production");
	});

	it("accepts NODE_ENV=development", () => {
		const result = ENV_CONFIG.validate({
			...baseValidEnv,
			NODE_ENV: "development",
		});
		expect(result.error).toBeUndefined();
		expect((result.value as EnvConfig).NODE_ENV).toBe("development");
	});

	it("accepts NODE_ENV=test", () => {
		const result = ENV_CONFIG.validate({
			...baseValidEnv,
			NODE_ENV: "test",
		});
		expect(result.error).toBeUndefined();
		expect((result.value as EnvConfig).NODE_ENV).toBe("test");
	});

	it("defaults NODE_ENV to 'development' when absent", () => {
		const result = ENV_CONFIG.validate({ ...baseValidEnv });
		expect(result.error).toBeUndefined();
		expect((result.value as EnvConfig).NODE_ENV).toBe("development");
	});

	it("rejects NODE_ENV with an invalid value", () => {
		const result = ENV_CONFIG.validate({
			...baseValidEnv,
			NODE_ENV: "staging",
		});
		expect(result.error).toBeDefined();
		// Joi.valid() emits a `any.only` error code.
		expect(result.error?.message).toMatch(/NODE_ENV/);
	});

	// --- reviews-throttling: Configurable Limits via Joi (T1) -----------

	it("applies the default REVIEWS_THROTTLE_TTL_MS (60_000) when env var is absent", () => {
		const result = ENV_CONFIG.validate({ ...baseValidEnv });
		expect(result.error).toBeUndefined();
		expect((result.value as EnvConfig).REVIEWS_THROTTLE_TTL_MS).toBe(60_000);
	});

	it("round-trips an explicit REVIEWS_THROTTLE_TTL_MS / _WRITE_LIMIT / _READ_LIMIT triple", () => {
		const result = ENV_CONFIG.validate({
			...baseValidEnv,
			REVIEWS_THROTTLE_TTL_MS: "30000",
			REVIEWS_THROTTLE_WRITE_LIMIT: "10",
			REVIEWS_THROTTLE_READ_LIMIT: "120",
		});
		expect(result.error).toBeUndefined();
		const v = result.value as EnvConfig;
		expect(v.REVIEWS_THROTTLE_TTL_MS).toBe(30_000);
		expect(v.REVIEWS_THROTTLE_WRITE_LIMIT).toBe(10);
		expect(v.REVIEWS_THROTTLE_READ_LIMIT).toBe(120);
	});

	it("rejects REVIEWS_THROTTLE_TTL_MS below the 1_000 floor (e.g. 500)", () => {
		const result = ENV_CONFIG.validate({
			...baseValidEnv,
			REVIEWS_THROTTLE_TTL_MS: "500",
		});
		expect(result.error).toBeDefined();
		expect(result.error?.message).toMatch(/REVIEWS_THROTTLE_TTL_MS/);
	});

	it("rejects REVIEWS_THROTTLE_WRITE_LIMIT below the 1 floor (e.g. 0)", () => {
		const result = ENV_CONFIG.validate({
			...baseValidEnv,
			REVIEWS_THROTTLE_WRITE_LIMIT: "0",
		});
		expect(result.error).toBeDefined();
		expect(result.error?.message).toMatch(/REVIEWS_THROTTLE_WRITE_LIMIT/);
	});

	it("rejects a non-integer REVIEWS_THROTTLE_READ_LIMIT", () => {
		const result = ENV_CONFIG.validate({
			...baseValidEnv,
			REVIEWS_THROTTLE_READ_LIMIT: "fast",
		});
		expect(result.error).toBeDefined();
		expect(result.error?.message).toMatch(/REVIEWS_THROTTLE_READ_LIMIT/);
	});
});
