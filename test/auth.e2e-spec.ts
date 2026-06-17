// Set process.env BEFORE the AppModule is imported so that
// ConfigModule.forRoot() at decoration time sees valid values.
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

// Mock @nestjs/typeorm so the e2e suite never opens a real DB connection.
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
import * as bcrypt from "bcrypt";
import { createHash } from "node:crypto";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { UserEntity } from "../src/auth/entities/user.entity";
import { RefreshTokenEntity } from "../src/auth/entities/refresh-token.entity";
import { ENV_CONFIG } from "../src/config/env.config";
import { AuthResponseDto } from "../src/auth/dto/auth-response.dto";

const TEST_PASSWORD = "correct-password";
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);
const FIXED_USER_ID = "11111111-2222-3333-4444-555555555555";
const TEST_EMAIL = "admin@x.io";

function sha256(plain: string): string {
	return createHash("sha256").update(plain).digest("hex");
}

function makeUserRepo() {
	return {
		findOne: jest
			.fn()
			.mockImplementation(
				(opts: {
					where: { email?: string; id?: string };
					select?: Record<string, boolean>;
				}) => {
					const row = {
						id: FIXED_USER_ID,
						email: TEST_EMAIL,
						password: TEST_PASSWORD_HASH,
					};
					if (opts.where.email && row.email === opts.where.email) {
						if (opts.select) {
							const out: Record<string, unknown> = {};
							for (const k of Object.keys(opts.select)) {
								if (opts.select[k])
									out[k] = (row as Record<string, unknown>)[
										k
									];
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
									out[k] = (row as Record<string, unknown>)[
										k
									];
							}
							return Promise.resolve(out);
						}
						return Promise.resolve({ ...row });
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
	const insertCalls: Array<{
		userId: string;
		familyId: string;
		hashedToken: string;
		expiresAt: Date;
	}> = [];
	let nextId = 1;
	return {
		rows,
		insertCalls,
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
					insertCalls.push(data);
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
	const configService = app.get(ConfigService<EnvConfig>);
	const frontendUrl = configService.get("FRONTEND_URL", {
		infer: true,
	}) as string;
	app.enableCors({
		origin: (
			requestOrigin: string | undefined,
			callback: (err: Error | null, allow: boolean | string) => void,
		) => {
			if (!requestOrigin || requestOrigin === frontendUrl) {
				callback(null, frontendUrl);
				return;
			}
			callback(null, false);
		},
		credentials: true,
	});
	await app.init();
	return app;
}

describe("auth (e2e)", () => {
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

	// (a) login happy
	it("POST /api/v1/auth/login: 200 + accessToken body + rt Set-Cookie + refresh_tokens row", async () => {
		const res = await request(app.getHttpServer() as App)
			.post("/api/v1/auth/login")
			.send({ email: TEST_EMAIL, password: TEST_PASSWORD })
			.set("Content-Type", "application/json");
		expect(res.status).toBe(200);
		const body = res.body as AuthResponseDto;
		expect(body.accessToken).toEqual(expect.any(String));
		expect(body.expiresIn).toBeGreaterThan(0);
		const setCookie = res.headers["set-cookie"];
		expect(setCookie).toBeDefined();
		const cookieHeader = Array.isArray(setCookie)
			? setCookie.join(",")
			: String(setCookie);
		expect(cookieHeader).toMatch(/^rt=/);
		expect(cookieHeader).toMatch(/HttpOnly/i);
		// The DB row was inserted.
		expect(rtRepo.insertCalls).toHaveLength(1);
		// sha256(refreshToken) is what was stored.
		const oldRt = /rt=([^;]+)/.exec(setCookie?.[0] ?? "")?.[1] ?? "";
		expect(rtRepo.insertCalls[0].hashedToken).toBe(sha256(oldRt));
	});

	// (b) refresh happy
	it("POST /api/v1/auth/refresh: 200 + new accessToken + replaced_by set on the old row", async () => {
		const loginRes = await request(app.getHttpServer() as App)
			.post("/api/v1/auth/login")
			.send({ email: TEST_EMAIL, password: TEST_PASSWORD })
			.set("Content-Type", "application/json");
		const oldRt =
			/rt=([^;]+)/.exec(loginRes.headers["set-cookie"]?.[0] ?? "")?.[1] ??
			"";

		const refreshRes = await request(app.getHttpServer() as App)
			.post("/api/v1/auth/refresh")
			.set("Cookie", `rt=${oldRt}`)
			.set("Content-Type", "application/json");
		expect(refreshRes.status).toBe(200);
		const refreshBody = refreshRes.body as AuthResponseDto;
		expect(refreshBody.accessToken).toEqual(expect.any(String));
		const newCookie = refreshRes.headers["set-cookie"]?.[0] ?? "";
		expect(newCookie).toMatch(/^rt=/);
		// Old row revoked + replaced_by points to the new row.
		const oldRow = rtRepo.rows.get("rt-1");
		expect(oldRow?.revokedAt).toBeInstanceOf(Date);
		expect(oldRow?.replacedBy).toBe("rt-2");
		const newRow = rtRepo.rows.get("rt-2");
		expect(newRow?.familyId).toBe(oldRow?.familyId);
	});

	// (c) logout happy
	it("POST /api/v1/auth/logout: 200 + Set-Cookie clears the rt cookie (Max-Age=0)", async () => {
		const loginRes = await request(app.getHttpServer() as App)
			.post("/api/v1/auth/login")
			.send({ email: TEST_EMAIL, password: TEST_PASSWORD })
			.set("Content-Type", "application/json");
		const oldRt =
			/rt=([^;]+)/.exec(loginRes.headers["set-cookie"]?.[0] ?? "")?.[1] ??
			"";

		const logoutRes = await request(app.getHttpServer() as App)
			.post("/api/v1/auth/logout")
			.set("Cookie", `rt=${oldRt}`)
			.set("Content-Type", "application/json");
		expect(logoutRes.status).toBe(200);
		const setCookie = logoutRes.headers["set-cookie"]?.[0] ?? "";
		expect(setCookie).toMatch(/^rt=/);
		expect(setCookie).toMatch(/Max-Age=0/);
		// The presented refresh row was revoked.
		expect(rtRepo.rows.get("rt-1")?.revokedAt).toBeInstanceOf(Date);
	});

	// (d) profile — guarded in Commit 5
	it.skip("GET /api/v1/auth/profile: 401 without Authorization (handled by JwtAuthGuard in Commit 5)", async () => {
		const res = await request(app.getHttpServer() as App).get(
			"/api/v1/auth/profile",
		);
		expect(res.status).toBe(401);
	});
});
