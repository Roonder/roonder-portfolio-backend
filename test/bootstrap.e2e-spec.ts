// Set process.env BEFORE the AppModule import so ConfigModule.forRoot()
// at decoration time sees valid values for the app boot tests.
process.env.PORT = "3001";
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test-secret-32-chars-min-..................";
process.env.JWT_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_SECRET = "refresh-secret-32-chars-min-......";
process.env.JWT_REFRESH_EXPIRES_IN = "2592000";
process.env.SUPERUSER_EMAIL = "admin@test.io";
process.env.SUPERUSER_PASSWORD = "test-password";
process.env.RESEND_API_KEY = "re_test";
process.env.FRONTEND_URL = "https://app.example.com";
// reviews-throttling (T1): the three new Joi keys, permissive for
// the e2e suite.
process.env.REVIEWS_THROTTLE_TTL_MS = "1000";
process.env.REVIEWS_THROTTLE_WRITE_LIMIT = "1000000";
process.env.REVIEWS_THROTTLE_READ_LIMIT = "1000000";

// Mock @nestjs/typeorm so the e2e suite never opens a real DB connection.
// The real TypeOrmCoreModule would call dataSource.initialize() at module
// compile time; the e2e suite has no live Postgres. The TypeOrmModule
// wiring itself is verified statically in src/app.module.spec.ts.
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

import "reflect-metadata";
import {
	Body,
	Controller,
	Global,
	INestApplication,
	Module,
	Post,
	ValidationPipe,
} from "@nestjs/common";
import { IsString } from "class-validator";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import request from "supertest";
import type { App } from "supertest/types";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AuthModule } from "../src/auth/auth.module";
import { ProjectsModule } from "../src/projects/projects.module";
import { ReviewsModule } from "../src/reviews/reviews.module";
import { ContactModule } from "../src/contact/contact.module";
import { UserEntity } from "../src/auth/entities/user.entity";
import { RefreshTokenEntity } from "../src/auth/entities/refresh-token.entity";
import { ProjectEntity } from "../src/projects/entities/project.entity";
import { ProjectUrlEntity } from "../src/projects/entities/project-url.entity";
import { ReviewEntity } from "../src/reviews/entities/review.entity";
import { ReviewCommentEntity } from "../src/reviews/entities/review-comment.entity";
import { ENV_CONFIG, EnvConfig } from "../src/config/env.config";

// Fakes for the @InjectRepository() deps. TypeOrmModule is mocked at the
// top of this file so the repository providers must be supplied by hand
// through a @Global() test module so AuthService / ProjectsService can
// be resolved inside AuthModule / ProjectsModule (their parent modules).
const fakeUserRepo = { findOne: jest.fn(), save: jest.fn() };
const fakeRefreshTokenRepo = {
	findOne: jest.fn(),
	insert: jest.fn(),
	update: jest.fn(),
};
// PR3 carryover fix: the projects module was added in PR2 (Tasks 2.2 +
// 2.9) but its repository tokens were never added to this e2e harness.
// Without them, Test.createTestingModule fails to compile because
// ProjectsService's constructor can't be resolved. Empty fakes are
// sufficient here — this spec never exercises the projects endpoints;
// the endpoint-level e2e lives in test/projects.e2e-spec.ts.
const fakeProjectRepo = {};
const fakeProjectUrlRepo = {};
// T11 follow-up: ReviewsModule is in the imports list (T11 added
// it). The module's TypeOrmModule.forFeature registers the review
// repos; in this e2e harness we mock @nestjs/typeorm, so the
// tokens must be supplied by hand. Empty fakes unblock the
// composition; the endpoint-level e2e lives in
// test/reviews.e2e-spec.ts.
const fakeReviewRepo = {};
const fakeReviewCommentRepo = {};
const fakeDataSource = {};

@Global()
@Module({
	providers: [
		{ provide: getRepositoryToken(UserEntity), useValue: fakeUserRepo },
		{
			provide: getRepositoryToken(RefreshTokenEntity),
			useValue: fakeRefreshTokenRepo,
		},
		{
			provide: getRepositoryToken(ProjectEntity),
			useValue: fakeProjectRepo,
		},
		{
			provide: getRepositoryToken(ProjectUrlEntity),
			useValue: fakeProjectUrlRepo,
		},
		{
			provide: getRepositoryToken(ReviewEntity),
			useValue: fakeReviewRepo,
		},
		{
			provide: getRepositoryToken(ReviewCommentEntity),
			useValue: fakeReviewCommentRepo,
		},
		{ provide: DataSource, useValue: fakeDataSource },
	],
	exports: [
		getRepositoryToken(UserEntity),
		getRepositoryToken(RefreshTokenEntity),
		getRepositoryToken(ProjectEntity),
		getRepositoryToken(ProjectUrlEntity),
		getRepositoryToken(ReviewEntity),
		getRepositoryToken(ReviewCommentEntity),
		DataSource,
	],
})
class TestFakesModule {}

// ---------------------------------------------------------------------------
// ADR-1 synthetic fixture: declared in the test file (NOT in src/) so the
// global forbidNonWhitelisted test is independent of any domain DTO shape.
// The controller path is `__bootstrap_fixture` so the prefixed route is
// `/api/v1/__bootstrap_fixture`.
// ---------------------------------------------------------------------------
class FixtureDto {
	@IsString()
	name!: string;
}

@Controller("__bootstrap_fixture")
class FixtureController {
	@Post()
	post(@Body() dto: FixtureDto): FixtureDto {
		return dto;
	}
}

@Module({
	controllers: [FixtureController],
})
class FixtureModule {}

// Mirrors src/main.ts bootstrap but uses Test.createTestingModule + init()
// so the test process never calls process.exit on unhandled errors. We can
// still attach supertest to app.getHttpServer() without calling listen().
async function bootstrapTestApp(): Promise<INestApplication> {
	const moduleRef: TestingModule = await Test.createTestingModule({
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
			FixtureModule,
		],
	}).compile();
	const app = moduleRef.createNestApplication({ logger: false });
	app.setGlobalPrefix("api/v1");
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			forbidNonWhitelisted: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);
	const cs = app.get(ConfigService<EnvConfig>);
	const frontendUrl = cs.get("FRONTEND_URL", { infer: true });
	app.enableCors({
		origin: (
			requestOrigin: string | undefined,
			callback: (err: Error | null, allow: string | false) => void,
		) => {
			if (!requestOrigin || requestOrigin === frontendUrl) {
				callback(null, frontendUrl as string);
				return;
			}
			callback(null, false);
		},
		credentials: true,
	});
	const swaggerConfig = new DocumentBuilder()
		.setTitle("Roonder Portfolio API")
		.setVersion("1.0")
		.addBearerAuth()
		.build();
	const document = SwaggerModule.createDocument(app, swaggerConfig);
	SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true });
	await app.init();
	return app;
}

describe("bootstrap (e2e)", () => {
	let app: INestApplication;

	beforeAll(async () => {
		app = await bootstrapTestApp();
	});

	afterAll(async () => {
		if (app) await app.close();
	});

	// (a) prefix reachability
	describe("global /api/v1 prefix", () => {
		it("reaches POST /api/v1/__bootstrap_fixture (prefixed) and returns 201", async () => {
			// Per design ADR-8: the prefix probe targets the test-only
			// `__bootstrap_fixture` controller (declared in this file,
			// registered via FixtureModule) so the assertion is decoupled
			// from any domain DTO shape. The auth domain's own endpoints
			// are covered in test/auth.e2e-spec.ts.
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/__bootstrap_fixture")
				.send({ name: "x" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
		});

		it("rejects POST /__bootstrap_fixture (unprefixed) with 404", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/__bootstrap_fixture")
				.send({ name: "x" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(404);
		});
	});

	// (b) forbidNonWhitelisted — uses the synthetic fixture module
	describe("forbidNonWhitelisted on @Body() DTOs", () => {
		let fixtureApp: INestApplication;

		beforeAll(async () => {
			const moduleRef: TestingModule = await Test.createTestingModule({
				imports: [FixtureModule],
			}).compile();
			fixtureApp = moduleRef.createNestApplication();
			fixtureApp.setGlobalPrefix("api/v1");
			fixtureApp.useGlobalPipes(
				new ValidationPipe({
					whitelist: true,
					transform: true,
					forbidNonWhitelisted: true,
					transformOptions: { enableImplicitConversion: true },
				}),
			);
			await fixtureApp.init();
		});

		afterAll(async () => {
			if (fixtureApp) await fixtureApp.close();
		});

		it("rejects an unknown field with 400 Bad Request", async () => {
			const res = await request(fixtureApp.getHttpServer() as App)
				.post("/api/v1/__bootstrap_fixture")
				.send({ name: "ok", isAdmin: true })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("accepts a body with only the declared field", async () => {
			const res = await request(fixtureApp.getHttpServer() as App)
				.post("/api/v1/__bootstrap_fixture")
				.send({ name: "ok" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
			expect(res.body).toMatchObject({ name: "ok" });
		});
	});

	// (c) CORS preflight echo — configured origin echoes the headers
	describe("CORS preflight echoes FRONTEND_URL", () => {
		it("OPTIONS from the configured origin includes Access-Control-Allow-Origin + Allow-Credentials", async () => {
			const res = await request(app.getHttpServer() as App)
				.options("/api/v1/__bootstrap_fixture")
				.set("Origin", "https://app.example.com")
				.set("Access-Control-Request-Method", "POST");
			expect(res.headers["access-control-allow-origin"]).toBe(
				"https://app.example.com",
			);
			expect(res.headers["access-control-allow-credentials"]).toBe(
				"true",
			);
		});
	});

	// (d) CORS preflight non-echo — mismatched origin / unprefixed URL
	describe("CORS preflight does not echo a mismatched origin", () => {
		it("OPTIONS from a different origin to an unprefixed URL does NOT carry the configured origin", async () => {
			const res = await request(app.getHttpServer() as App)
				.options("/__bootstrap_fixture")
				.set("Origin", "https://evil.example.com")
				.set("Access-Control-Request-Method", "POST");
			// Per ADR-5: assert on the header, not the status code.
			expect(res.headers["access-control-allow-origin"]).toBeUndefined();
		});
	});

	// (e) Swagger UI + JSON
	describe("Swagger surface", () => {
		it("GET /api/v1/docs returns the Swagger UI HTML (200)", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/docs",
			);
			expect(res.status).toBe(200);
			expect(res.headers["content-type"]).toMatch(/text\/html/);
		});

		it("GET /api/v1/docs-json returns the OpenAPI document with the right shape", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/docs-json",
			);
			expect(res.status).toBe(200);
			// Per ADR-4: assert on the JSON body, not the URL suffix.
			const body = res.body as {
				openapi?: string;
				info?: { title?: string; version?: string };
				components?: { securitySchemes?: { bearer?: unknown } };
			};
			expect(body.openapi).toBeDefined();
			expect(body.info).toMatchObject({
				title: "Roonder Portfolio API",
				version: "1.0",
			});
			// Per ADR-4: bearer auth must be registered through addBearerAuth().
			expect(body.components?.securitySchemes?.bearer).toBeDefined();
		});
	});
});

// (f) Missing-env-var rejection — per ADR-3: in-test approach.
//     Test.createTestingModule with ConfigModule.forRoot({ ignoreEnvFile: true })
//     and stubbed process.env that omits JWT_SECRET must reject.
describe("missing required env var prevents boot", () => {
	const ORIGINAL_ENV = process.env;

	afterEach(() => {
		process.env = ORIGINAL_ENV;
	});

	it("rejects with a Joi validation error when JWT_SECRET is absent", async () => {
		process.env = {
			...ORIGINAL_ENV,
			PORT: "3000",
			DATABASE_URL: "postgres://test:test@localhost:5432/test",
			RESEND_API_KEY: "re_test",
			FRONTEND_URL: "https://app.example.com",
		};
		// Ensure no leftover JWT_SECRET from the host process.
		delete process.env.JWT_SECRET;

		await expect(
			Test.createTestingModule({
				imports: [
					ConfigModule.forRoot({
						isGlobal: true,
						validationSchema: ENV_CONFIG,
						ignoreEnvFile: true,
						cache: true,
					}),
				],
			}).compile(),
		).rejects.toThrow(/JWT_SECRET/);
	});

	// New keys added by the auth-domain change. The env stub above omits them
	// so each one is independently missing — each test must reject with a Joi
	// error referencing the missing key name.
	const NEW_AUTH_KEYS = [
		"JWT_EXPIRES_IN",
		"JWT_REFRESH_SECRET",
		"JWT_REFRESH_EXPIRES_IN",
		"SUPERUSER_EMAIL",
		"SUPERUSER_PASSWORD",
	] as const;

	for (const missingKey of NEW_AUTH_KEYS) {
		it(`rejects with a Joi validation error when ${missingKey} is absent`, async () => {
			process.env = {
				...ORIGINAL_ENV,
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
			// Ensure the key under test is missing.
			delete process.env[missingKey];

			await expect(
				Test.createTestingModule({
					imports: [
						ConfigModule.forRoot({
							isGlobal: true,
							validationSchema: ENV_CONFIG,
							ignoreEnvFile: true,
							cache: true,
						}),
					],
				}).compile(),
			).rejects.toThrow(new RegExp(missingKey));
		});
	}
});
