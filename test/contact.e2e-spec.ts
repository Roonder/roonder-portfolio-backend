// Set process.env BEFORE any module import so ConfigModule.forRoot()
// at decoration time sees valid values. Mirrors the pattern in
// test/reviews.e2e-spec.ts. The throttler env vars are PERMISSIVE
// for the public contact tests (1_000_000 limit) so the throttler
// is effectively disabled; the dedicated 429 scenario in T11.1c
// (defined at the bottom of this file) flips the env to the spec
// default (`CONTACT_THROTTLE_WRITE_LIMIT=5`) to assert the 429
// path.

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
// T11.1: throttler is permissive by default; the dedicated
// `throttler shape` describe at the bottom of this file flips
// `CONTACT_THROTTLE_WRITE_LIMIT` to 5 to assert the 429
// behaviour end-to-end.
process.env.CONTACT_THROTTLE_TTL_MS = "1000";
process.env.CONTACT_THROTTLE_WRITE_LIMIT = "1000000";
process.env.CONTACT_THROTTLE_READ_LIMIT = "1000000";

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
import { UserEntity } from "../src/auth/entities/user.entity";
import { RefreshTokenEntity } from "../src/auth/entities/refresh-token.entity";
import { ProjectEntity } from "../src/projects/entities/project.entity";
import { ProjectUrlEntity } from "../src/projects/entities/project-url.entity";
import { ReviewEntity } from "../src/reviews/entities/review.entity";
import { ReviewCommentEntity } from "../src/reviews/entities/review-comment.entity";
import { ENV_CONFIG } from "../src/config/env.config";
import { configureApp } from "../src/main";

// ---------------------------------------------------------------------------
// In-memory contact repository. The contact service uses
// `create + save + createQueryBuilder` (the `findAllForAdmin`
// path is exercised in the admin e2e, not here).
// ---------------------------------------------------------------------------

interface ContactRow {
	id: string;
	name: string;
	email: string;
	subject: string | null;
	message: string;
	status: string;
	createdAt: Date;
	updatedAt: Date;
}

function newId(): string {
	return globalThis.crypto.randomUUID();
}

function makeContactRepo(): {
	repo: Record<string, jest.Mock>;
	state: { rows: Map<string, ContactRow> };
} {
	const state = { rows: new Map<string, ContactRow>() };
	const repo: Record<string, jest.Mock> = {
		create: jest.fn((dto: Partial<ContactRow>) => dto),
		save: jest.fn(async (row: Partial<ContactRow>) => {
			const id = row.id ?? newId();
			const saved: ContactRow = {
				id,
				name: row.name ?? "",
				email: row.email ?? "",
				subject: row.subject ?? null,
				message: row.message ?? "",
				status: row.status ?? "pending",
				createdAt: row.createdAt ?? new Date(),
				updatedAt: row.updatedAt ?? new Date(),
			};
			state.rows.set(id, saved);
			return saved;
		}),
		findOne: jest.fn(async (q: { where: { id: string } }) => {
			const r = state.rows.get(q.where.id);
			return r ?? null;
		}),
	};
	return { repo, state };
}

// In-memory sent_emails repo. The EmailService writes one row
// per send attempt; the e2e asserts the rows are populated.
function makeSentEmailRepo(): {
	repo: Record<string, jest.Mock>;
	state: { rows: Array<Record<string, unknown>> };
} {
	const state = { rows: [] as Array<Record<string, unknown>> };
	const repo: Record<string, jest.Mock> = {
		create: jest.fn((data: Record<string, unknown>) => data),
		save: jest.fn(async (row: Record<string, unknown>) => {
			state.rows.push(row);
			return row;
		}),
	};
	return { repo, state };
}

// Fake Resend SDK client — exposes the same `emails.send` shape
// the real SDK does. The send behaviour is configurable per-test
// (success, { error }, throw).
function makeResendFake(): {
	emails: { send: jest.Mock };
	state: { mode: "ok" | "error" | "throw" };
} {
	const state: { mode: "ok" | "error" | "throw" } = { mode: "ok" };
	const fake: { emails: { send: jest.Mock } } = {
		emails: {
			send: jest.fn(),
		},
	};
	fake.emails.send.mockImplementation(async () => {
		if (state.mode === "ok") {
			return {
				data: { id: "resend-" + Math.random().toString(36).slice(2) },
				error: null,
				headers: null,
			};
		}
		if (state.mode === "error") {
			return {
				data: null,
				error: {
					name: "invalid_from_address",
					message: "Domain not verified",
					statusCode: 422,
				},
				headers: null,
			};
		}
		throw new Error("Network unreachable");
	});
	return { ...fake, state };
}

// Shared fakes for the auth + projects + reviews repos (the
// contact e2e does NOT touch those domains, but the bootstrap
// composition still imports their modules through `ContactModule`
// is NOT imported — see below for the parallel composition).
// Actually we do NOT import any other domain module; we just
// register the contact module's classes directly.
const { repo: contactRepo, state: contactState } = makeContactRepo();
const { repo: sentEmailRepo, state: sentEmailState } = makeSentEmailRepo();
const resendFake = makeResendFake();

@Global()
@Module({
	providers: [
		{ provide: getRepositoryToken(ContactEntity), useValue: contactRepo },
		{
			provide: getRepositoryToken(SentEmailEntity),
			useValue: sentEmailRepo,
		},
		{ provide: RESEND_CLIENT, useValue: resendFake },
		// Provide a no-op DataSource so any service that injects it
		// (none of the contact classes do, but keeping it here
		// matches the test/reviews.e2e pattern for future-proofing).
		{ provide: DataSource, useValue: {} },
		// Provide empty fakes for the auth/projects/reviews repos
		// in case any other module from the parallel composition
		// reaches for them. The contact e2e DOES NOT import
		// any of those modules — see `bootstrapTestApp` below.
		{ provide: getRepositoryToken(UserEntity), useValue: {} },
		{
			provide: getRepositoryToken(RefreshTokenEntity),
			useValue: {},
		},
		{ provide: getRepositoryToken(ProjectEntity), useValue: {} },
		{ provide: getRepositoryToken(ProjectUrlEntity), useValue: {} },
		{ provide: getRepositoryToken(ReviewEntity), useValue: {} },
		{
			provide: getRepositoryToken(ReviewCommentEntity),
			useValue: {},
		},
	],
	exports: [
		getRepositoryToken(ContactEntity),
		getRepositoryToken(SentEmailEntity),
		RESEND_CLIENT,
		DataSource,
	],
})
class TestFakesModule {}

// Parallel app composition: builds a minimal app that
// registers ONLY the contact-domain controllers + providers
// (no AppModule, no ContactModule — the spec asserts the
// module surface via `ContactModule.spec.ts`; the e2e asserts
// the HTTP behaviour). EventEmitter2 is registered globally
// so the `@OnEvent("contact.created")` listener fires.
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
			TestFakesModule,
		],
		controllers: [ContactController],
		providers: [
			ContactService,
			EmailService,
			ContactEmailListener,
		],
	}).compile();
	const app = moduleRef.createNestApplication({ logger: false });
	configureApp(app);
	await app.init();
	return app;
}

// ---------------------------------------------------------------------------
// Tests — public POST route (T11.1)
// ---------------------------------------------------------------------------

describe("Contact e2e — public POST (T11.1)", () => {
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
		resendFake.state.mode = "ok";
		app = await bootstrapTestApp();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	describe("POST /api/v1/contacts — happy path", () => {
		it("valid body returns 201 + the response DTO shape", async () => {
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
			expect(body.id).toBeDefined();
			expect(body.name).toBe("Maria Lopez");
			expect(body.email).toBe("maria@example.com");
			expect(body.status).toBe("pending");
			// Persisted with status='pending' (the public submission
			// contract).
			const saved = (contactRepo.save.mock.calls[0] as [
				Partial<ContactRow>,
			])[0];
			expect(saved?.status).toBe("pending");
		});

		it("201 triggers a ContactCreatedEvent + the listener fires + 2 sent_emails rows are persisted", async () => {
			// The listener is async (@OnEvent with async: true).
			// The test polls the sent_email rows briefly because
			// the event dispatch is microtask-deferred.
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "maria@example.com",
					subject: "Question",
					message: "Hello",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
			// Wait for the async listener to fire and write 2 rows.
			await new Promise((r) => setTimeout(r, 50));
			expect(sentEmailState.rows).toHaveLength(2);
			const kinds = sentEmailState.rows.map(
				(r) => r["kind"] as string,
			);
			expect(kinds).toContain("contact_notification");
			expect(kinds).toContain("contact_auto_reply");
			// Both rows are 'accepted' (the fake Resend returns
			// success by default).
			for (const row of sentEmailState.rows) {
				expect(row["status"]).toBe("accepted");
				expect(row["resendId"]).not.toBeNull();
			}
			// The notification row was sent to RESEND_TO_ADDRESS.
			const notif = sentEmailState.rows.find(
				(r) => r["kind"] === "contact_notification",
			);
			expect(notif?.["to"]).toBe("admin@roonder.dev");
			expect(notif?.["from"]).toBe(
				"Roonder Portfolio <hello@roonder.dev>",
			);
			// The auto-reply was sent to the submitter's email.
			const reply = sentEmailState.rows.find(
				(r) => r["kind"] === "contact_auto_reply",
			);
			expect(reply?.["to"]).toBe("maria@example.com");
		});
	});

	describe("POST /api/v1/contacts — validation 400s", () => {
		it("missing message returns 400 with the canonical envelope", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "maria@example.com",
					subject: "Question",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
			const body = res.body as {
				statusCode?: number;
				error?: string;
				message?: string;
				path?: string;
				timestamp?: string;
			};
			expect(body.statusCode).toBe(400);
			expect(body.error).toBe("Bad Request");
			expect(body.path).toBe("/api/v1/contacts");
			expect(typeof body.timestamp).toBe("string");
		});

		it("bad email returns 400", async () => {
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

		it("extra field 'phone' returns 400 (forbidNonWhitelisted)", async () => {
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
	});

	describe("Resend failure path — the locked user decision #7", () => {
		it("Resend returns { error } → POST still returns 201 + 2 'failed' sent_emails rows are persisted", async () => {
			// Flip the Resend fake to return { data: null, error }.
			resendFake.state.mode = "error";
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "maria@example.com",
					subject: "Question",
					message: "Hello",
				})
				.set("Content-Type", "application/json");
			// CRITICAL: 201, NOT 5xx. The global filter is NOT
			// invoked on a Resend failure (the EmailService is
			// non-throwing; locked #7 / design §8).
			expect(res.status).toBe(201);
			// Wait for the async listener to write 2 failed rows.
			await new Promise((r) => setTimeout(r, 50));
			expect(sentEmailState.rows).toHaveLength(2);
			for (const row of sentEmailState.rows) {
				expect(row["status"]).toBe("failed");
				expect(row["resendId"]).toBeNull();
				expect(row["errorMessage"]).toBe("Domain not verified");
			}
		});

		it("Resend throws → POST still returns 201 + 2 'failed' sent_emails rows are persisted", async () => {
			resendFake.state.mode = "throw";
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/contacts")
				.send({
					name: "Maria Lopez",
					email: "maria@example.com",
					subject: "Question",
					message: "Hello",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
			await new Promise((r) => setTimeout(r, 50));
			expect(sentEmailState.rows).toHaveLength(2);
			for (const row of sentEmailState.rows) {
				expect(row["status"]).toBe("failed");
				expect(row["resendId"]).toBeNull();
				expect(row["errorMessage"]).toBe("Network unreachable");
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Throttler shape (T11.1c): a SEPARATE file
// (`test/contact-throttler.e2e-spec.ts`) covers the 6th-
// request 429 trigger. The decorator factory captures the
// env at decoration time (when the controller class is
// first loaded), so a single file cannot switch between
// permissive and strict limits without a fresh module
// graph.
// ---------------------------------------------------------------------------
