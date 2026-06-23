import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import type { App } from "supertest/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";
import { ContactEntity } from "./entities/contact.entity";
import { SentEmailEntity } from "./entities/sent-email.entity";
import { ENV_CONFIG } from "../config/env.config";

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
process.env.RESEND_FROM_ADDRESS = "Roonder Portfolio <hello@roonder.dev>";
process.env.RESEND_TO_ADDRESS = "admin@roonder.dev";
process.env.FRONTEND_URL = "https://app.example.com";
process.env.NODE_ENV = "test";
// Throttler is permissive in the unit suite (1_000_000 limit). The
// 429 trigger is covered in test/contact.e2e-spec.ts (T11.1).
process.env.CONTACT_THROTTLE_TTL_MS = "1000";
process.env.CONTACT_THROTTLE_WRITE_LIMIT = "1000000";
process.env.CONTACT_THROTTLE_READ_LIMIT = "1000000";

// Mock @nestjs/typeorm so the unit suite never opens a real DB connection.
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

// ---------------------------------------------------------------------------
// Service fake — exposes only the `create` method (the only one the
// public controller calls). The full service surface is exercised
// in contact.service.spec.ts.
// ---------------------------------------------------------------------------

interface ServiceFake {
	create: jest.Mock;
}

function makeServiceFake(): ServiceFake {
	return {
		create: jest.fn(),
	};
}

async function bootstrapTestApp(
	serviceFake: ServiceFake,
): Promise<INestApplication> {
	const moduleRef: TestingModule = await Test.createTestingModule({
		imports: [
			ConfigModule.forRoot({
				isGlobal: true,
				validationSchema: ENV_CONFIG,
				ignoreEnvFile: true,
				cache: true,
			}),
			// Disable the throttler in the unit suite so the per-route
			// `@Throttle()` decorator does not trip the 6th request.
			// The 429 behaviour is covered in test/contact.e2e-spec.ts.
			ThrottlerModule.forRoot([
				{ name: "default", ttl: 1_000, limit: 1_000_000 },
			]),
		],
		controllers: [ContactController],
		providers: [
			{ provide: ContactService, useValue: serviceFake },
			{ provide: getRepositoryToken(ContactEntity), useValue: {} },
			{ provide: getRepositoryToken(SentEmailEntity), useValue: {} },
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
	await app.init();
	return app;
}

// ---------------------------------------------------------------------------
// Tests — HTTP shape (supertest) + metadata (static source read)
// ---------------------------------------------------------------------------

describe("ContactController (HTTP shape — public POST)", () => {
	let app: INestApplication;
	let service: ServiceFake;

	beforeEach(async () => {
		service = makeServiceFake();
		app = await bootstrapTestApp(service);
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	describe("POST /api/v1/contacts", () => {
		it("returns 201 + ContactResponseDto shape on a valid body", async () => {
			service.create.mockResolvedValue({
				id: "c-1",
				name: "Maria Lopez",
				email: "maria@example.com",
				subject: "Question about pricing",
				message: "Hi, I would like to know more.",
				status: "pending",
				createdAt: new Date("2026-06-19T10:00:00.000Z").toISOString(),
				updatedAt: new Date("2026-06-19T10:00:00.000Z").toISOString(),
			});
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "maria@example.com",
					subject: "Question about pricing",
					message: "Hi, I would like to know more.",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
			const body = res.body as {
				id?: string;
				name?: string;
				email?: string;
				subject?: string;
				message?: string;
				status?: string;
				createdAt?: string;
				updatedAt?: string;
			};
			expect(body.id).toBe("c-1");
			// Spec: persists with status='pending' (the public submission
			// contract — no contact is created with a non-pending
			// status).
			expect(body.status).toBe("pending");
			// No `emailSentLog` field on the response (the destructive
			// change).
			expect(
				"emailSentLog" in (res.body as Record<string, unknown>),
			).toBe(false);
			// Service was called with the DTO verbatim.
			expect(service.create).toHaveBeenCalledTimes(1);
			const call = service.create.mock.calls[0] as [
				Record<string, unknown>,
			];
			expect(call[0]).toMatchObject({
				name: "Maria Lopez",
				email: "maria@example.com",
				subject: "Question about pricing",
				message: "Hi, I would like to know more.",
			});
		});

		it("rejects a missing message with 400 (validation pipe)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "maria@example.com",
					subject: "Question",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("rejects a bad email with 400 (DTO @IsEmail)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "not-an-email",
					subject: "Question",
					message: "Hello",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("rejects name > 100 chars with 400 (DTO @MaxLength(100))", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "x".repeat(101),
					email: "maria@example.com",
					subject: "Question",
					message: "Hello",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("rejects an unknown body field with 400 (forbidNonWhitelisted)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "maria@example.com",
					subject: "Question",
					message: "Hello",
					phone: "+1-555-555-5555",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("rejects whitespace-only message with 400 (DTO @Matches(/\\S/))", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "maria@example.com",
					subject: "Question",
					message: "   \n\t  ",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});
	});
});

describe("ContactController metadata — Swagger + Throttle + No-Auth", () => {
	const controllerSource = readFileSync(
		resolve(__dirname, "contact.controller.ts"),
		"utf8",
	);

	it("carries the 'contact' tag at the class level (Swagger)", () => {
		const tags = Reflect.getMetadata(
			"swagger/apiUseTags",
			ContactController,
		) as string[] | undefined;
		expect(tags).toEqual(["contact"]);
	});

	it("declares 1 route: POST only (the public surface — no :id, no PATCH/DELETE)", () => {
		const proto = ContactController.prototype as Record<string, unknown>;
		expect(typeof proto["create"]).toBe("function");
		// No numeric id coercion, no :id param at all.
		expect(controllerSource).not.toMatch(/\+id/);
		expect(controllerSource).not.toMatch(/@Param\("id"/);
	});

	it("POST /contacts is decorated with @ThrottledContactWrite() (per ADR-4, public write)", () => {
		// Static source-text check: the @ThrottledContactWrite()
		// decorator MUST be applied to the `create` method. The
		// runtime 429 behaviour is covered in
		// test/contact.e2e-spec.ts (T11.1).
		expect(controllerSource).toMatch(/@ThrottledContactWrite\(\)/);
		expect(controllerSource).toMatch(/@Post\(\)/);
	});

	it("public route carries NO @UseGuards(JwtAuthGuard) (locked #1: public write)", () => {
		// The public POST is intentionally unauthenticated. A
		// future commit that adds a guard here will trip this
		// assertion.
		expect(controllerSource).not.toMatch(/@UseGuards\(JwtAuthGuard\)/);
	});
});
