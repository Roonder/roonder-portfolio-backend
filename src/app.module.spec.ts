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

// Mock @nestjs/typeorm so the unit suite never opens a real DB connection.
// The real TypeOrmCoreModule would call dataSource.initialize() at module
// compile time; the unit suite has no live Postgres. The TypeOrmModule
// wiring itself (forRootAsync, AppDataSource.options) is verified
// statically below in a dedicated test that reads src/app.module.ts.
jest.mock("@nestjs/typeorm", () => {
	const actual: Record<string, unknown> =
		jest.requireActual("@nestjs/typeorm");
	return {
		...actual,
		TypeOrmModule: {
			forRoot: () => ({ module: class NoopRootModule {} }),
			forRootAsync: () => ({ module: class NoopRootAsyncModule {} }),
			forFeature: () => ({ module: class NoopFeatureModule {} }),
		},
	};
});

import { Test, TestingModule } from "@nestjs/testing";
import { Global, Injectable, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ENV_CONFIG } from "./config/env.config";
import { EnvConfig } from "./config/env.config";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ContactModule } from "./contact/contact.module";
import { UserEntity } from "./auth/entities/user.entity";
import { RefreshTokenEntity } from "./auth/entities/refresh-token.entity";

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

// Fakes for the @InjectRepository() deps. TypeOrmModule is mocked above so
// the repository tokens are not provided by the real forFeature — we
// supply them through a @Global() TestFakesModule so AuthService can be
// resolved inside AuthModule.
const fakeUserRepo = { findOne: jest.fn(), save: jest.fn() };
const fakeRefreshTokenRepo = {
	findOne: jest.fn(),
	insert: jest.fn(),
	update: jest.fn(),
};

@Global()
@Module({
	providers: [
		{ provide: getRepositoryToken(UserEntity), useValue: fakeUserRepo },
		{
			provide: getRepositoryToken(RefreshTokenEntity),
			useValue: fakeRefreshTokenRepo,
		},
	],
	exports: [
		getRepositoryToken(UserEntity),
		getRepositoryToken(RefreshTokenEntity),
	],
})
class TestFakesModule {}

describe("AppModule", () => {
	let module: TestingModule;

	beforeAll(async () => {
		// This test mirrors the AppModule composition (ConfigModule global,
		// four domain modules). TypeOrmModule is mocked at the top of this
		// file so the unit suite never opens a real DB connection. The
		// production wiring is verified statically below.
		module = await Test.createTestingModule({
			imports: [
				ConfigModule.forRoot({
					isGlobal: true,
					validationSchema: ENV_CONFIG,
					ignoreEnvFile: true,
					cache: true,
				}),
				TestFakesModule,
				AuthModule,
				ProjectsModule,
				ReviewsModule,
				ContactModule,
				ConsumerModule,
			],
		}).compile();
	});

	afterAll(async () => {
		if (module) await module.close();
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

	it("AppModule source includes TypeOrmModule.forRootAsync wiring (static contract)", () => {
		// Per the auth-domain change, AppModule MUST wire TypeOrmModule
		// with the shared AppDataSource. This is a static-text assertion
		// to avoid requiring a live database in the unit suite.
		const source = readFileSync(
			resolve(__dirname, "app.module.ts"),
			"utf8",
		);
		expect(source).toMatch(/TypeOrmModule\.forRootAsync/);
		expect(source).toMatch(/AppDataSource\.options/);
	});

	it("AppModule does NOT register JwtAuthGuard as a global APP_GUARD (per-controller only)", () => {
		// Per design ADR-6 and spec §Requirement: JwtAuthGuard, the guard
		// MUST be applied per-controller with `@UseGuards(JwtAuthGuard)`
		// on `AuthController` only — NOT as a global `APP_GUARD` provider
		// in `AppModule`. A global guard would force every future
		// public endpoint (e.g. `GET /projects`) to opt out explicitly.
		// This static assertion is the guard rail: any future change
		// that adds a global JwtAuthGuard will trip it.
		const source = readFileSync(
			resolve(__dirname, "app.module.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/APP_GUARD[\s\S]*JwtAuthGuard/);
	});
});
