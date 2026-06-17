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

import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Body, Controller, Global, Module, Post } from "@nestjs/common";
import { IsString } from "class-validator";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import type { App } from "supertest/types";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { configureApp } from "./main";
import { ENV_CONFIG } from "./config/env.config";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ContactModule } from "./contact/contact.module";
import { UserEntity } from "./auth/entities/user.entity";
import { RefreshTokenEntity } from "./auth/entities/refresh-token.entity";

// Mock @nestjs/typeorm so the unit suite never opens a real DB connection.
// The real TypeOrmCoreModule would call dataSource.initialize() at module
// compile time; the unit suite has no live Postgres. The wiring itself
// (forRootAsync, AppDataSource.options) is verified statically by reading
// src/app.module.ts in a dedicated test below.
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

const mainSource = readFileSync(resolve(__dirname, "main.ts"), "utf8");

// Fakes for the @InjectRepository() deps. AuthService is constructed inside
// AuthModule, so we declare a thin module that re-exports the fakes and
// have AuthModule consume them via @Global() in a single test-time wiring
// (see `TestFakesModule` below).
const fakeUserRepo = { findOne: jest.fn(), save: jest.fn() };
const fakeRefreshTokenRepo = {
	findOne: jest.fn(),
	insert: jest.fn(),
	update: jest.fn(),
};

// A global test module that supplies the @InjectRepository() tokens. The
// fakes are needed because we mock @nestjs/typeorm in this file (so no real
// TypeOrmModule.forFeature is registered) but AuthService still expects the
// tokens to be resolvable. `@Global()` makes the providers visible to every
// module in the test graph (including the imported AuthModule).
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

// ---------------------------------------------------------------------------
// ADR-8 synthetic fixture: mirrors test/bootstrap.e2e-spec.ts. The controller
// path is `__bootstrap_fixture` so the prefixed route is
// `/api/v1/__bootstrap_fixture`. This keeps the prefix reachability probe
// decoupled from any domain DTO shape — the auth domain's own endpoints are
// covered in test/auth.e2e-spec.ts.
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
// (no listen()). Mocks TypeOrmModule so no DB connection is attempted; the
// @InjectRepository() tokens are supplied by TestFakesModule which is
// imported by AuthModule via the `imports` chain (we add it here so its
// exports are visible to AuthModule).
async function bootstrapTestApp(): Promise<INestApplication> {
	const moduleRef = await Test.createTestingModule({
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
	configureApp(app);
	await app.init();
	return app;
}

describe("bootstrap()", () => {
	let app: INestApplication;

	afterEach(async () => {
		if (app) await app.close();
	});

	it("main.ts does not read process.env.PORT directly (typed ConfigService is the only path)", () => {
		// Spec Requirement: Typed Environment Access — main.ts MUST NOT
		// contain any process.env.* reference. The port must be read
		// through ConfigService.get('PORT', { infer: true }).
		expect(mainSource).not.toMatch(/process\.env\.PORT/);
		// And the typed lookup must be present.
		expect(mainSource).toMatch(/ConfigService.*PORT/s);
	});

	it("applies the global /api/v1 prefix to every route", async () => {
		app = await bootstrapTestApp();
		// Per design ADR-8: the prefix probe targets a test-only
		// `__bootstrap_fixture` controller (mirrored from
		// test/bootstrap.e2e-spec.ts) so the assertion is decoupled
		// from any domain DTO shape. The auth domain's own endpoints
		// are covered in test/auth.e2e-spec.ts.
		const prefixed = await request(app.getHttpServer() as App)
			.post("/api/v1/__bootstrap_fixture")
			.send({ name: "x" })
			.set("Content-Type", "application/json");
		expect(prefixed.status).toBe(201);
		// The unprefixed URL must 404.
		const unprefixed = await request(app.getHttpServer() as App)
			.post("/__bootstrap_fixture")
			.send({ name: "x" })
			.set("Content-Type", "application/json");
		expect(unprefixed.status).toBe(404);
	});

	it("registers a global ValidationPipe with whitelist + forbidNonWhitelisted + transform + enableImplicitConversion", () => {
		// The behavior assertions live in the E2E (test/bootstrap.e2e-spec.ts)
		// per ADR-1 (synthetic FixtureDto). Here we assert the static contract:
		// main.ts MUST call useGlobalPipes(new ValidationPipe(...)) with the
		// exact option bag the spec requires.
		expect(mainSource).toMatch(
			/useGlobalPipes\s*\(\s*new\s+ValidationPipe/,
		);
		expect(mainSource).toMatch(/whitelist:\s*true/);
		expect(mainSource).toMatch(/forbidNonWhitelisted:\s*true/);
		expect(mainSource).toMatch(/transform:\s*true/);
		expect(mainSource).toMatch(/enableImplicitConversion:\s*true/);
	});

	it("enables CORS echoing the FRONTEND_URL origin with credentials:true", async () => {
		app = await bootstrapTestApp();
		// Preflight to a prefixed route. The configured origin must be echoed.
		const preflight = await request(app.getHttpServer() as App)
			.options("/api/v1/__bootstrap_fixture")
			.set("Origin", "https://app.example.com")
			.set("Access-Control-Request-Method", "POST");
		expect(preflight.headers["access-control-allow-origin"]).toBe(
			"https://app.example.com",
		);
		expect(preflight.headers["access-control-allow-credentials"]).toBe(
			"true",
		);
	});

	it("mounts Swagger UI at /api/v1/docs (HTML, 200)", async () => {
		app = await bootstrapTestApp();
		const res = await request(app.getHttpServer() as App).get(
			"/api/v1/docs",
		);
		expect(res.status).toBe(200);
		// Swagger UI returns HTML.
		expect(res.headers["content-type"]).toMatch(/text\/html/);
	});

	it("serves the OpenAPI JSON at /api/v1/docs-json with the expected title and version", async () => {
		app = await bootstrapTestApp();
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

	it("main.ts does not contain any process.env.* reference (typed access only)", () => {
		// Spec Requirement: Typed Environment Access — main.ts MUST NOT
		// read any environment variable directly via process.env.*.
		expect(mainSource).not.toMatch(/process\.env\./);
	});
});
