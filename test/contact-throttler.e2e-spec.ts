// Set process.env BEFORE any module import so ConfigModule.forRoot()
// at decoration time sees valid values. The throttler env vars
// here are STRICT (`CONTACT_THROTTLE_WRITE_LIMIT=5`) so the 6th
// request triggers a 429. The controller class is loaded fresh
// for this test file (per Jest's per-file module isolation) so
// the `@ThrottledContactWrite()` factory captures the strict
// limit at decoration time.

/* eslint-disable @typescript-eslint/require-await -- the in-memory
 * repo fakes below are `async` for type compatibility with TypeORM's
 * `Repository<T>` surface even when their body is synchronous. */
process.env.PORT = "3001";
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
// T11.1c: strict throttler. The 6th POST returns 429.
process.env.CONTACT_THROTTLE_TTL_MS = "60000";
process.env.CONTACT_THROTTLE_WRITE_LIMIT = "5";
process.env.CONTACT_THROTTLE_READ_LIMIT = "60";

// Mock @nestjs/typeorm — no real DB. The shared helpers
// (TestFakesModule) provide fake repositories.
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
import { Global, INestApplication, Module } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import request from "supertest";
import type { App } from "supertest/types";
import { ContactEntity } from "../src/contact/entities/contact.entity";
import { SentEmailEntity } from "../src/contact/entities/sent-email.entity";
import { ContactService } from "../src/contact/contact.service";
import { ContactController } from "../src/contact/contact.controller";
import { ContactEmailListener } from "../src/contact/listeners/contact-email.listener";
import { EmailService } from "../src/contact/email/email.service";
import { RESEND_CLIENT } from "../src/contact/email/resend-client.token";
import { ENV_CONFIG } from "../src/config/env.config";
import { configureApp } from "../src/main";

// In-memory contact repo.
const contactState: { rows: Map<string, unknown> } = {
	rows: new Map(),
};
const contactRepo: Record<string, jest.Mock> = {
	create: jest.fn((dto: Record<string, unknown>) => dto),
	save: jest.fn(async (row: Record<string, unknown>) => {
		const id = (row["id"] as string) ?? globalThis.crypto.randomUUID();
		const saved = { ...row, id };
		contactState.rows.set(id, saved);
		return saved;
	}),
	findOne: jest.fn(),
};

const sentEmailState: { rows: Array<Record<string, unknown>> } = {
	rows: [],
};
const sentEmailRepo: Record<string, jest.Mock> = {
	create: jest.fn((data: Record<string, unknown>) => data),
	save: jest.fn(async (row: Record<string, unknown>) => {
		sentEmailState.rows.push(row);
		return row;
	}),
};

const resendFake: { emails: { send: jest.Mock } } = {
	emails: {
		send: jest.fn(async () => ({
			data: { id: "resend-test" },
			error: null,
			headers: null,
		})),
	},
};

@Global()
@Module({
	providers: [
		{ provide: getRepositoryToken(ContactEntity), useValue: contactRepo },
		{
			provide: getRepositoryToken(SentEmailEntity),
			useValue: sentEmailRepo,
		},
		{ provide: RESEND_CLIENT, useValue: resendFake },
		{ provide: DataSource, useValue: {} },
	],
	exports: [
		getRepositoryToken(ContactEntity),
		getRepositoryToken(SentEmailEntity),
		RESEND_CLIENT,
		DataSource,
	],
})
class TestFakesModule {}

async function bootstrapTestApp(): Promise<INestApplication> {
	const moduleRef: TestingModule = await Test.createTestingModule({
		imports: [
			ConfigModule.forRoot({
				isGlobal: true,
				validationSchema: ENV_CONFIG,
				ignoreEnvFile: true,
				cache: true,
			}),
			EventEmitterModule.forRoot(),
			// The @ThrottledContactWrite() decorator requires a
			// ThrottlerModule in scope. The strict limit (5/60_000)
			// is what trips the 6th request to 429. NOTE: the
			// decorator factory captures the env at DECORATION
			// TIME (when the controller class is loaded); the
			// ThrottlerModule.forRoot here provides the runtime
			// throttler config. Both must agree (5/60_000) for
			// the 429 to fire.
			ThrottlerModule.forRoot([
				{ name: "default", ttl: 60_000, limit: 5 },
			]),
			TestFakesModule,
		],
		controllers: [ContactController],
		providers: [
			ContactService,
			EmailService,
			ContactEmailListener,
			// The throttler runtime requires the guard to read
			// the per-route metadata. The production code wires
			// this via `app.useGlobalGuards(new ThrottlerGuard(...))`
			// (future work; ADR-2 keeps it out of the global
			// APP_GUARD). For this e2e we add it as a global
			// guard in the test app only.
			ThrottlerGuard,
		],
	}).compile();
	const app = moduleRef.createNestApplication({ logger: false });
	configureApp(app);
	// Apply the throttler guard globally for this e2e only.
	app.useGlobalGuards(app.get(ThrottlerGuard));
	await app.init();
	return app;
}

describe("Contact e2e — throttler shape (T11.1c)", () => {
	let app: INestApplication;

	beforeEach(async () => {
		contactState.rows.clear();
		sentEmailState.rows.length = 0;
		contactRepo.create.mockClear();
		contactRepo.save.mockClear();
		contactRepo.findOne.mockClear();
		sentEmailRepo.create.mockClear();
		sentEmailRepo.save.mockClear();
		resendFake.emails.send.mockClear();
		app = await bootstrapTestApp();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it("6th POST request with CONTACT_THROTTLE_WRITE_LIMIT=5 returns 429 with the canonical envelope", async () => {
		// Issue 5 valid POSTs (each consumes 1 of the 5 quota).
		for (let i = 0; i < 5; i++) {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: `User ${i}`,
					email: `user${i}@example.com`,
					subject: "Question",
					message: "Hello",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
		}
		// The 6th request trips the throttler.
		const res = await request(app.getHttpServer() as App)
			.post("/api/v1/contacts")
			.send({
				name: "User 6",
				email: "user6@example.com",
				subject: "Question",
				message: "Hello",
			})
			.set("Content-Type", "application/json");
		expect(res.status).toBe(429);
		const body = res.body as {
			statusCode?: number;
			error?: string;
			message?: string;
			path?: string;
			timestamp?: string;
		};
		expect(body.statusCode).toBe(429);
		expect(body.error).toBe("Too Many Requests");
		expect(body.path).toBe("/api/v1/contacts");
		expect(typeof body.timestamp).toBe("string");
	});
});
