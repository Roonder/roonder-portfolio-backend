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
// reviews-throttling (T1): the three new Joi keys. Values are
// permissive (1_000_000) so the throttler is a no-op in the unit
// suite.
process.env.REVIEWS_THROTTLE_TTL_MS = "1000";
process.env.REVIEWS_THROTTLE_WRITE_LIMIT = "1000000";
process.env.REVIEWS_THROTTLE_READ_LIMIT = "1000000";

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
import { DataSource } from "typeorm";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ENV_CONFIG } from "./config/env.config";
import { EnvConfig } from "./config/env.config";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ContactModule } from "./contact/contact.module";
import { UserEntity } from "./auth/entities/user.entity";
import { RefreshTokenEntity } from "./auth/entities/refresh-token.entity";
import { ProjectEntity } from "./projects/entities/project.entity";
import { ProjectUrlEntity } from "./projects/entities/project-url.entity";

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
const fakeProjectRepo = {};
const fakeProjectUrlRepo = {};
// PR2 Task 2.2: ProjectsService takes a `DataSource` for
// `dataSource.transaction(...)` in the write paths. The class
// itself is provided by `TypeOrmModule` at runtime; in the unit
// suite the module is mocked, so we expose an empty fake through
// `TestFakesModule`. The service spec uses its own richer fake
// (`fakeDataSource`) — see `src/projects/projects.service.spec.ts`.
const fakeDataSource = {};

@Global()
@Module({
	providers: [
		{ provide: getRepositoryToken(UserEntity), useValue: fakeUserRepo },
		{
			provide: getRepositoryToken(RefreshTokenEntity),
			useValue: fakeRefreshTokenRepo,
		},
		// PR2 Task 2.2/2.9: the new ProjectsService constructor takes
		// ProjectEntity + ProjectUrlEntity repos + DataSource. Provide
		// empty fakes so the module composition succeeds; richer
		// fakes (with findPublic, create, etc.) live in the
		// projects.service.spec suite, not here.
		{
			provide: getRepositoryToken(ProjectEntity),
			useValue: fakeProjectRepo,
		},
		{
			provide: getRepositoryToken(ProjectUrlEntity),
			useValue: fakeProjectUrlRepo,
		},
		{ provide: DataSource, useValue: fakeDataSource },
	],
	exports: [
		getRepositoryToken(UserEntity),
		getRepositoryToken(RefreshTokenEntity),
		getRepositoryToken(ProjectEntity),
		getRepositoryToken(ProjectUrlEntity),
		DataSource,
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

	it("AppModule does NOT register AllExceptionsFilter as an APP_FILTER (wired in main.ts only)", () => {
		// Per design ADR-6 and spec §Requirement: Global Exception Filter
		// Registration, the filter MUST be wired via
		// `app.useGlobalFilters(new AllExceptionsFilter(...))` in
		// `main.ts` — NOT as an `APP_FILTER` provider in `AppModule`.
		// Registering it in both places would double-register the
		// filter and produce duplicate 4xx bodies. This static
		// assertion is the guard rail: any future change that
		// re-routes the filter registration into `AppModule.providers`
		// will trip it.
		const source = readFileSync(
			resolve(__dirname, "app.module.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/APP_FILTER[\s\S]*AllExceptionsFilter/);
		// Belt-and-braces: assert `AllExceptionsFilter` is not even
		// imported into `app.module.ts`. If a future change adds the
		// import, that is the first step toward the forbidden wiring.
		expect(source).not.toMatch(/AllExceptionsFilter/);
	});

	// --- reviews-throttling (T6): ThrottlerModule + APP_GUARD guard-rail

	it("AppModule registers ThrottlerModule.forRootAsync with ConfigService injection", () => {
		// Per reviews-throttling spec scenario
		// "ThrottlerModule is registered in AppModule". The factory
		// reads REVIEWS_THROTTLE_TTL_MS / _WRITE_LIMIT / _READ_LIMIT
		// via the typed ConfigService<EnvConfig> and returns a single
		// tracker. The static assertion below checks the wiring; the
		// runtime test (T16 e2e) exercises the 429 path.
		const source = readFileSync(
			resolve(__dirname, "app.module.ts"),
			"utf8",
		);
		expect(source).toMatch(/ThrottlerModule\.forRootAsync/);
		expect(source).toMatch(/inject:\s*\[ConfigService\]/);
		expect(source).toMatch(/useFactory.*ConfigService<EnvConfig>/s);
		expect(source).toMatch(/REVIEWS_THROTTLE_TTL_MS/);
		expect(source).toMatch(/REVIEWS_THROTTLE_WRITE_LIMIT/);
	});

	it("AppModule does NOT register ThrottlerGuard as a global APP_GUARD (per-route only)", () => {
		// Per reviews-throttling spec scenario
		// "ThrottlerGuard is NOT registered as APP_GUARD". A global
		// guard would force every public route to opt out and would
		// trip the per-route contract. The static assertion is the
		// guard rail.
		const source = readFileSync(
			resolve(__dirname, "app.module.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/APP_GUARD[\s\S]*ThrottlerGuard/);
	});
});
