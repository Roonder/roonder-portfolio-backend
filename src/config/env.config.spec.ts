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
});
