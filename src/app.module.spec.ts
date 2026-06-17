// Set process.env BEFORE the AppModule is imported so that
// ConfigModule.forRoot() at decoration time sees valid values.
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

import { Test, TestingModule } from "@nestjs/testing";
import { Injectable, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { EnvConfig } from "./config/env.config";

// A throwaway downstream consumer that depends on ConfigService.
// Because ConfigModule is wired with isGlobal: true, this consumer
// does NOT need to import ConfigModule — it just injects the service.
@Injectable()
class ConfigConsumer {
	constructor(public readonly config: ConfigService<EnvConfig>) {}
}

@Module({
	providers: [ConfigConsumer],
	exports: [ConfigConsumer],
})
class ConsumerModule {}

describe("AppModule", () => {
	let module: TestingModule;

	beforeAll(async () => {
		module = await Test.createTestingModule({
			imports: [AppModule, ConsumerModule],
		}).compile();
	});

	afterAll(async () => {
		await module.close();
	});

	it("registers ConfigModule globally so ConfigService is injectable in any module", () => {
		// If ConfigModule were NOT global, ConsumerModule would fail to
		// resolve ConfigService because it does not re-import ConfigModule.
		const consumer = module.get(ConfigConsumer);
		expect(consumer.config).toBeInstanceOf(ConfigService);
	});

	it("ConfigService returns values validated by the Joi schema (PORT coerced to number)", () => {
		const consumer = module.get(ConfigConsumer);
		const port = consumer.config.get("PORT", { infer: true });
		expect(port).toBe(3000);
	});
});
