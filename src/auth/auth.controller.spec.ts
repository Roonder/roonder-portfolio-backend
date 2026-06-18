// Set process.env BEFORE the AuthModule is imported so that
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
import * as bcrypt from "bcrypt";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { UserEntity } from "./entities/user.entity";
import { RefreshTokenEntity } from "./entities/refresh-token.entity";
import { ENV_CONFIG } from "../config/env.config";
import { AuthResponseDto } from "./dto/auth-response.dto";

// ---------------------------------------------------------------------------
// Test fixture helpers (mirror the auth.service.spec.ts pattern)
// ---------------------------------------------------------------------------

const TEST_PASSWORD = "correct-password";
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);
const FIXED_USER_ID = "11111111-2222-3333-4444-555555555555";
const TEST_EMAIL = "admin@x.io";

function makeUserRepo(): {
	findOne: jest.Mock;
	rows: Map<string, { id: string; email: string; password: string }>;
} {
	const rows = new Map<
		string,
		{ id: string; email: string; password: string }
	>();
	rows.set(FIXED_USER_ID, {
		id: FIXED_USER_ID,
		email: TEST_EMAIL,
		password: TEST_PASSWORD_HASH,
	});
	return {
		rows,
		findOne: jest
			.fn()
			.mockImplementation(
				(opts: {
					where: { email?: string; id?: string };
					select?: Record<string, boolean>;
				}) => {
					for (const row of rows.values()) {
						if (
							opts.where.email &&
							row.email === opts.where.email
						) {
							if (opts.select) {
								const out: Record<string, unknown> = {};
								for (const k of Object.keys(opts.select)) {
									if (opts.select[k])
										out[k] = (
											row as Record<string, unknown>
										)[k];
								}
								return Promise.resolve(out);
							}
							return Promise.resolve({ ...row });
						}
						if (opts.where.id && row.id === opts.where.id) {
							if (opts.select) {
								const out: Record<string, unknown> = {};
								for (const k of Object.keys(opts.select)) {
									if (opts.select[k])
										out[k] = (
											row as Record<string, unknown>
										)[k];
								}
								return Promise.resolve(out);
							}
							return Promise.resolve({ ...row });
						}
					}
					return Promise.resolve(null);
				},
			),
	};
}

function makeRefreshTokenRepo() {
	const rows = new Map<
		string,
		{
			id: string;
			revokedAt: Date | null;
			replacedBy: string | null;
			familyId: string;
			userId: string;
			expiresAt: Date;
			hashedToken: string;
		}
	>();
	let nextId = 1;
	return {
		rows,
		findOne: jest
			.fn()
			.mockImplementation((opts: { where: { hashedToken: string } }) => {
				for (const row of rows.values()) {
					if (row.hashedToken === opts.where.hashedToken)
						return Promise.resolve({ ...row });
				}
				return Promise.resolve(null);
			}),
		insert: jest
			.fn()
			.mockImplementation(
				(data: {
					userId: string;
					familyId: string;
					hashedToken: string;
					expiresAt: Date;
				}) => {
					const id = `rt-${nextId++}`;
					rows.set(id, {
						id,
						revokedAt: null,
						replacedBy: null,
						...data,
					});
					return Promise.resolve({ identifiers: [{ id }] });
				},
			),
		update: jest
			.fn()
			.mockImplementation((criteria: unknown, partial: unknown) => {
				if (typeof criteria === "string") {
					const row = rows.get(criteria);
					if (row) Object.assign(row, partial);
				} else if (typeof criteria === "object" && criteria !== null) {
					const c = criteria as {
						familyId?: string;
						revokedAt?: null;
					};
					for (const row of rows.values()) {
						if (
							c.familyId !== undefined &&
							row.familyId !== c.familyId
						)
							continue;
						if (c.revokedAt === null && row.revokedAt !== null)
							continue;
						Object.assign(row, partial);
					}
				}
				return Promise.resolve({ affected: 1 });
			}),
	};
}

async function bootstrapTestApp(
	userRepo: ReturnType<typeof makeUserRepo>,
	rtRepo: ReturnType<typeof makeRefreshTokenRepo>,
): Promise<INestApplication> {
	const moduleRef: TestingModule = await Test.createTestingModule({
		imports: [
			ConfigModule.forRoot({
				isGlobal: true,
				validationSchema: ENV_CONFIG,
				ignoreEnvFile: true,
				cache: true,
			}),
			JwtModule.register({
				secret: "test-secret-32-chars-min-..................",
				signOptions: { expiresIn: "15m" },
			}),
		],
		controllers: [AuthController],
		providers: [
			AuthService,
			JwtStrategy,
			JwtAuthGuard,
			{ provide: getRepositoryToken(UserEntity), useValue: userRepo },
			{
				provide: getRepositoryToken(RefreshTokenEntity),
				useValue: rtRepo,
			},
		],
	}).compile();
	const app = moduleRef.createNestApplication({ logger: false });
	app.setGlobalPrefix("api/v1");
	app.use(cookieParser());
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
// Tests
// ---------------------------------------------------------------------------

describe("AuthController (HTTP shape)", () => {
	let app: INestApplication;
	let userRepo: ReturnType<typeof makeUserRepo>;
	let rtRepo: ReturnType<typeof makeRefreshTokenRepo>;

	beforeEach(async () => {
		userRepo = makeUserRepo();
		rtRepo = makeRefreshTokenRepo();
		app = await bootstrapTestApp(userRepo, rtRepo);
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	describe("POST /api/v1/auth/login", () => {
		it("happy path: returns 200 + accessToken body + rt Set-Cookie (HttpOnly, Secure, SameSite=Lax, Path=/)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/auth/login")
				.send({ email: TEST_EMAIL, password: TEST_PASSWORD })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(200);
			const body = res.body as AuthResponseDto;
			expect(typeof body.accessToken).toBe("string");
			expect(body.accessToken.length).toBeGreaterThan(0);
			expect(typeof body.expiresIn).toBe("number");
			expect(body.expiresIn).toBeGreaterThan(0);
			// The refresh token lives in the cookie, never the body.
			const setCookie = res.headers["set-cookie"];
			expect(setCookie).toBeDefined();
			const cookieHeader = Array.isArray(setCookie)
				? setCookie.join(",")
				: String(setCookie);
			expect(cookieHeader).toMatch(/^rt=/);
			expect(cookieHeader).toMatch(/HttpOnly/i);
			expect(cookieHeader).toMatch(/Secure/i);
			expect(cookieHeader).toMatch(/SameSite=Lax/i);
			expect(cookieHeader).toMatch(/Path=\//);
			expect(cookieHeader).toMatch(/Max-Age=2592000/);
		});

		it("bad credentials: returns 401, NO Set-Cookie", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/auth/login")
				.send({ email: TEST_EMAIL, password: "wrong-password" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(401);
			expect(res.headers["set-cookie"]).toBeUndefined();
		});

		it("malformed body (bad email + short password): returns 400 (validation pipe)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/auth/login")
				.send({ email: "not-an-email", password: "short" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});
	});

	describe("POST /api/v1/auth/refresh", () => {
		it("happy path: presents rt cookie → 200 + new accessToken + new rt Set-Cookie", async () => {
			// First, login to mint a refresh cookie.
			const loginRes = await request(app.getHttpServer() as App)
				.post("/api/v1/auth/login")
				.send({ email: TEST_EMAIL, password: TEST_PASSWORD })
				.set("Content-Type", "application/json");
			expect(loginRes.status).toBe(200);
			const oldCookie = loginRes.headers["set-cookie"]?.[0] ?? "";
			const rtMatch = /rt=([^;]+)/.exec(oldCookie);
			expect(rtMatch).not.toBeNull();
			const oldRt = rtMatch?.[1] ?? "";

			// Now refresh.
			const refreshRes = await request(app.getHttpServer() as App)
				.post("/api/v1/auth/refresh")
				.set("Cookie", `rt=${oldRt}`)
				.set("Content-Type", "application/json");
			expect(refreshRes.status).toBe(200);
			const refreshBody = refreshRes.body as AuthResponseDto;
			expect(refreshBody.accessToken).toEqual(expect.any(String));
			const newCookie = refreshRes.headers["set-cookie"]?.[0] ?? "";
			expect(newCookie).toMatch(/^rt=/);
			expect(newCookie).not.toBe(oldCookie);
		});
	});

	describe("POST /api/v1/auth/logout", () => {
		it("happy path: presents rt cookie → 200 + clears rt cookie (Max-Age=0)", async () => {
			// Login first.
			const loginRes = await request(app.getHttpServer() as App)
				.post("/api/v1/auth/login")
				.send({ email: TEST_EMAIL, password: TEST_PASSWORD })
				.set("Content-Type", "application/json");
			const oldCookie = loginRes.headers["set-cookie"]?.[0] ?? "";
			const oldRt = /rt=([^;]+)/.exec(oldCookie)?.[1] ?? "";

			const logoutRes = await request(app.getHttpServer() as App)
				.post("/api/v1/auth/logout")
				.set("Cookie", `rt=${oldRt}`)
				.set("Content-Type", "application/json");
			expect(logoutRes.status).toBe(200);
			const setCookie = logoutRes.headers["set-cookie"]?.[0] ?? "";
			expect(setCookie).toMatch(/^rt=/);
			// express cookie clear: Max-Age=0 and the value is empty.
			expect(setCookie).toMatch(/Max-Age=0/);
		});
	});

	describe("GET /api/v1/auth/profile", () => {
		// Guard lands in Commit 5 — skipped here because the controller is
		// still public. Commit 5 re-enables this test and adds the missing/
		// expired/bad-sig/valid branches.
		it.skip("returns 401 without Authorization header (handled by JwtAuthGuard in Commit 5)", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/auth/profile",
			);
			expect(res.status).toBe(401);
		});
	});
});
