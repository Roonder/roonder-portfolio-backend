// Set process.env BEFORE the AppModule is imported so that
// ConfigModule.forRoot() at decoration time sees valid values.
process.env.PORT = "3000";
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test-secret";
process.env.RESEND_API_KEY = "re_test";
process.env.FRONTEND_URL = "https://app.example.com";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import type { App } from "supertest/types";
import { NestApplication } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { bootstrap } from "./main";

const mainSource = readFileSync(resolve(__dirname, "main.ts"), "utf8");

describe("bootstrap()", () => {
	let app: INestApplication;

	afterEach(async () => {
		if (app) await app.close();
	});

	it("returns a fully initialized NestApplication instance", async () => {
		app = await bootstrap();
		expect(app).toBeInstanceOf(NestApplication);
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
		app = await bootstrap();
		// The AuthController declares @Controller('auth') @Post().
		// With the global prefix, the route resolves under /api/v1/auth.
		// The current CreateAuthDto accepts any body, so the route returns 201.
		const prefixed = await request(app.getHttpServer() as App)
			.post("/api/v1/auth")
			.send({})
			.set("Content-Type", "application/json");
		expect(prefixed.status).toBe(201);
		// The unprefixed URL must 404.
		const unprefixed = await request(app.getHttpServer() as App)
			.post("/auth")
			.send({})
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
		app = await bootstrap();
		// Preflight to a prefixed route. The configured origin must be echoed.
		const preflight = await request(app.getHttpServer() as App)
			.options("/api/v1/auth")
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
		app = await bootstrap();
		const res = await request(app.getHttpServer() as App).get(
			"/api/v1/docs",
		);
		expect(res.status).toBe(200);
		// Swagger UI returns HTML.
		expect(res.headers["content-type"]).toMatch(/text\/html/);
	});

	it("serves the OpenAPI JSON at /api/v1/docs-json with the expected title and version", async () => {
		app = await bootstrap();
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
