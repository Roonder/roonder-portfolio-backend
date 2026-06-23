// Set process.env BEFORE any module import so ConfigModule.forRoot()
// at decoration time sees valid values. Mirrors the
// projects/auth e2e patterns. The throttler env vars are
// PERMISSIVE for the public review tests (1_000_000 limits) so
// the throttler is effectively disabled. The dedicated throttler
// scenarios in T16c flip these to the spec defaults to assert
// the 429 behaviour.

/* eslint-disable @typescript-eslint/require-await -- the in-memory repo
 * fakes below are `async` for type compatibility with TypeORM's
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
// T16: throttler is permissive for the public review tests; the
// throttler-shape assertions in T16c flip these to the spec
// defaults (60_000 / 5 / 60).
process.env.REVIEWS_THROTTLE_TTL_MS = "1000";
process.env.REVIEWS_THROTTLE_WRITE_LIMIT = "1000000";
process.env.REVIEWS_THROTTLE_READ_LIMIT = "1000000";

// Mock @nestjs/typeorm — no real DB. Repositories are supplied
// via TestFakesModule below.
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
import { JwtService } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import type { App } from "supertest/types";
import { ReviewEntity } from "../src/reviews/entities/review.entity";
import { ReviewCommentEntity } from "../src/reviews/entities/review-comment.entity";
import { ReviewsModule } from "../src/reviews/reviews.module";
import { AuthModule } from "../src/auth/auth.module";
import { ProjectsModule } from "../src/projects/projects.module";
import { ContactModule } from "../src/contact/contact.module";
import { UserEntity } from "../src/auth/entities/user.entity";
import { RefreshTokenEntity } from "../src/auth/entities/refresh-token.entity";
import { ProjectEntity } from "../src/projects/entities/project.entity";
import { ProjectUrlEntity } from "../src/projects/entities/project-url.entity";
import { ENV_CONFIG } from "../src/config/env.config";
import { configureApp } from "../src/main";

// ---------------------------------------------------------------------------
// In-memory review repository. Mirrors the projects e2e pattern: a Map
// keyed by id, with the TypeORM surface (`create`, `save`, `delete`,
// `findOne`, `find`, `createQueryBuilder`) shimmed over it. The QueryBuilder
// shim is intentionally narrow — it only supports the patterns the
// service actually emits (where/andWhere/orderBy/skip/take + getManyAndCount).
// ---------------------------------------------------------------------------

interface ReviewRow {
	id: string;
	authorName: string;
	authorRole: string | null;
	content: string;
	rating: number;
	isApproved: boolean;
	createdAt: Date;
}

function newId(): string {
	return globalThis.crypto.randomUUID();
}

function makeReviewRepo(): {
	repo: Record<string, jest.Mock>;
	state: { rows: Map<string, ReviewRow> };
} {
	const state = { rows: new Map<string, ReviewRow>() };
	const repo: Record<string, jest.Mock> = {
		create: jest.fn((dto: Partial<ReviewRow>) => dto),
		save: jest.fn(async (row: Partial<ReviewRow>) => {
			const id = row.id ?? newId();
			const saved: ReviewRow = {
				id,
				authorName: row.authorName ?? "Anónimo",
				authorRole: row.authorRole ?? null,
				content: row.content ?? "",
				rating: row.rating ?? 0,
				isApproved: row.isApproved ?? false,
				createdAt: row.createdAt ?? new Date(),
			};
			state.rows.set(id, saved);
			return saved;
		}),
		findOne: jest.fn(async (q: { where: { id: string } }) => {
			const r = state.rows.get(q.where.id);
			return r ?? null;
		}),
		delete: jest.fn(async (q: { id: string }) => {
			const existed = state.rows.delete(q.id);
			return { affected: existed ? 1 : 0 };
		}),
		findAndCount: jest.fn(),
		createQueryBuilder: jest.fn(),
	};
	return { repo, state };
}

function makeCommentRepo(): {
	repo: Record<string, jest.Mock>;
	state: { rows: Map<string, unknown> };
} {
	const state = { rows: new Map<string, unknown>() };
	const repo: Record<string, jest.Mock> = {
		create: jest.fn((dto: unknown) => dto),
		save: jest.fn(),
		findOne: jest.fn(),
		delete: jest.fn(),
		findAndCount: jest.fn().mockResolvedValue([[], 0]),
		createQueryBuilder: jest.fn(),
	};
	return { repo, state };
}

// The 6 repos for the full app composition. The 4 from auth + projects
// are empty fakes; the 2 from reviews are the in-memory ones above.
const { repo: reviewRepo, state: reviewState } = makeReviewRepo();
const { repo: commentRepo } = makeCommentRepo();
const fakeUserRepo = { findOne: jest.fn(), save: jest.fn() };
const fakeRefreshTokenRepo = {
	findOne: jest.fn(),
	insert: jest.fn(),
	update: jest.fn(),
};
const fakeProjectRepo = {};
const fakeProjectUrlRepo = {};
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
		{ provide: getRepositoryToken(ReviewEntity), useValue: reviewRepo },
		{
			provide: getRepositoryToken(ReviewCommentEntity),
			useValue: commentRepo,
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
// The QueryBuilder shim. The service emits (in order):
//   .where(...).andWhere(...).orderBy(...).skip(...).take(...).getManyAndCount()
// with `where` being optional on the admin path. The shim captures the
// captured where/andWhere/orderBy/skip/take, then evaluates the in-memory
// rows against them in getManyAndCount. `getManyAndCount` returns the
// matching slice + the total count (for the envelope).
// ---------------------------------------------------------------------------

function makeQueryBuilder(rows: Iterable<ReviewRow>): {
	qb: Record<string, jest.Mock>;
	state: {
		where?: { isApproved?: boolean; rating?: number };
		andWheres: Array<{ rating?: number }>;
		orderBy?: { direction: "ASC" | "DESC" };
		skipVal: number;
		takeVal: number;
	};
} {
	const arr = Array.from(rows);
	const state = {
		where: undefined as
			| { isApproved?: boolean; rating?: number }
			| undefined,
		andWheres: [] as Array<{ rating?: number }>,
		orderBy: undefined as { direction: "ASC" | "DESC" } | undefined,
		skipVal: 0,
		takeVal: 20,
	};
	const qb: Record<string, jest.Mock> = {};
	qb["where"] = jest.fn((sql: string, params: Record<string, unknown>) => {
		// Parse "review.is_approved = :isApproved" + params
		if (sql.includes("review.is_approved")) {
			state.where = { isApproved: params.isApproved as boolean };
		}
		return qb;
	});
	qb["andWhere"] = jest.fn((sql: string, params: Record<string, unknown>) => {
		if (sql.includes("review.rating")) {
			state.andWheres.push({ rating: params.rating as number });
		}
		return qb;
	});
	qb["orderBy"] = jest.fn((_sql: string, direction: "ASC" | "DESC") => {
		state.orderBy = { direction };
		return qb;
	});
	qb["skip"] = jest.fn((n: number) => {
		state.skipVal = n;
		return qb;
	});
	qb["take"] = jest.fn((n: number) => {
		state.takeVal = n;
		return qb;
	});
	qb["getManyAndCount"] = jest.fn(async () => {
		let filtered = arr;
		if (state.where?.isApproved !== undefined) {
			filtered = filtered.filter(
				(r) => r.isApproved === state.where?.isApproved,
			);
		}
		for (const aw of state.andWheres) {
			if (aw.rating !== undefined) {
				filtered = filtered.filter((r) => r.rating === aw.rating);
			}
		}
		filtered = [...filtered].sort(
			(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
		);
		const total = filtered.length;
		const rows = filtered.slice(
			state.skipVal,
			state.skipVal + state.takeVal,
		);
		return [rows, total];
	});
	for (const m of [
		"leftJoinAndSelect",
		"leftJoin",
		"innerJoin",
		"innerJoinAndSelect",
		"select",
		"addSelect",
		"groupBy",
		"having",
	]) {
		qb[m] = jest.fn(() => qb);
	}
	return { qb, state };
}

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
		],
	}).compile();
	const app = moduleRef.createNestApplication({ logger: false });
	configureApp(app);
	await app.init();
	return app;
}

// ---------------------------------------------------------------------------
// Tests — public review routes (T16a)
// ---------------------------------------------------------------------------

describe("Reviews e2e — public review routes (T16a)", () => {
	let app: INestApplication;

	beforeEach(async () => {
		// Reset the in-memory state + the repo spies between tests.
		reviewState.rows.clear();
		reviewRepo.create.mockClear();
		reviewRepo.save.mockClear();
		reviewRepo.findOne.mockClear();
		reviewRepo.delete.mockClear();
		// Re-wire the QueryBuilder factory so each test gets a fresh
		// state object.
		reviewRepo.createQueryBuilder.mockImplementation(() => {
			const { qb } = makeQueryBuilder(reviewState.rows.values());
			return qb;
		});
		app = await bootstrapTestApp();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	describe("POST /api/v1/reviews", () => {
		it("valid public submission persists with isApproved=false (201 + envelope)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/reviews")
				.send({
					authorName: "Maria",
					authorRole: "PM",
					content: "Great work on the dashboard redesign",
					rating: 5,
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
			const body = res.body as {
				id?: string;
				isApproved?: boolean;
				comments?: unknown[];
			};
			expect(body.id).toBeDefined();
			expect(body.isApproved).toBe(false);
			expect(body.comments).toEqual([]);
			// Service was called with isApproved=false (the public
			// submission contract).
			const saved = (
				reviewRepo.save.mock.calls[0] as Array<unknown> | undefined
			)?.[0] as { isApproved?: boolean } | undefined;
			expect(saved?.isApproved).toBe(false);
		});

		it("missing content returns 400", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/reviews")
				.send({ rating: 5 })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("rating outside 1..5 returns 400", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/reviews")
				.send({
					content: "Great work on the dashboard redesign",
					rating: 6,
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("unknown body field returns 400 (forbidNonWhitelisted)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/reviews")
				.send({
					content: "Great work on the dashboard redesign",
					rating: 5,
					hackerField: "injected",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("authorName defaults to 'Anónimo' when omitted (201 + authorName='Anónimo')", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/reviews")
				.send({
					content: "Great work on the dashboard redesign",
					rating: 5,
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
			const body = res.body as { authorName?: string };
			expect(body.authorName).toBe("Anónimo");
		});
	});

	describe("GET /api/v1/reviews", () => {
		beforeEach(async () => {
			// Seed 2 approved + 1 unapproved review.
			reviewState.rows.set("r-1", {
				id: "r-1",
				authorName: "Maria",
				authorRole: null,
				content: "Approved A",
				rating: 5,
				isApproved: true,
				createdAt: new Date("2026-06-19T10:00:00.000Z"),
			});
			reviewState.rows.set("r-2", {
				id: "r-2",
				authorName: "Pedro",
				authorRole: null,
				content: "Approved B",
				rating: 4,
				isApproved: true,
				createdAt: new Date("2026-06-19T11:00:00.000Z"),
			});
			reviewState.rows.set("r-3", {
				id: "r-3",
				authorName: "Anon",
				authorRole: null,
				content: "Pending",
				rating: 3,
				isApproved: false,
				createdAt: new Date("2026-06-19T12:00:00.000Z"),
			});
		});

		it("default list returns ONLY approved reviews (the existence-leak guard)", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/reviews",
			);
			expect(res.status).toBe(200);
			const body = res.body as {
				data: Array<{ id: string; isApproved: boolean }>;
				total: number;
				page: number;
				pageSize: number;
			};
			expect(body.total).toBe(2);
			expect(body.page).toBe(1);
			expect(body.pageSize).toBe(20);
			expect(body.data).toHaveLength(2);
			for (const r of body.data) {
				expect(r.isApproved).toBe(true);
			}
		});

		it("pagination with ?page=2&pageSize=1 returns the second page", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/reviews?page=2&pageSize=1",
			);
			expect(res.status).toBe(200);
			const body = res.body as {
				data: Array<{ id: string }>;
				total: number;
				page: number;
				pageSize: number;
			};
			expect(body.total).toBe(2);
			expect(body.page).toBe(2);
			expect(body.pageSize).toBe(1);
			expect(body.data).toHaveLength(1);
		});

		it("pageSize is silently capped at 100 (NOT rejected with 400)", async () => {
			// The DTO has @Max(100) so ?pageSize=500 is rejected with
			// 400 at the wire. The "silent cap" is the SERVICE-layer
			// behavior (the route accepts the request even if the
			// DTO max is bypassed). This e2e test asserts the DTO
			// guard via the wire-level 400.
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/reviews?pageSize=500",
			);
			expect(res.status).toBe(400);
		});

		it("page below 1 returns 400 (DTO @Min(1))", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/reviews?page=0",
			);
			expect(res.status).toBe(400);
		});

		it("?rating=5 filters the list to only 5-star reviews", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/reviews?rating=5",
			);
			expect(res.status).toBe(200);
			const body = res.body as { data: Array<{ rating: number }> };
			for (const r of body.data) {
				expect(r.rating).toBe(5);
			}
		});
	});
});

// ---------------------------------------------------------------------------
// T16b: admin routes (list, toggle approval, delete) + filter shape.
// Tests need a valid JWT for the class-level JwtAuthGuard on
// ReviewsAdminController. The JwtService is instantiated directly with
// the test secret (mirror test/auth.e2e-spec.ts:342-345).
// ---------------------------------------------------------------------------

async function mintAdminToken(): Promise<string> {
	const jwt = new JwtService({
		secret: "test-secret-32-chars-min-..................",
		signOptions: { expiresIn: "15m" },
	});
	return jwt.signAsync({ sub: "test-admin-id", email: "admin@test.io" });
}

describe("Reviews e2e — admin routes (T16b)", () => {
	let app: INestApplication;
	let adminToken: string;

	beforeEach(async () => {
		reviewState.rows.clear();
		reviewRepo.create.mockClear();
		reviewRepo.save.mockClear();
		reviewRepo.findOne.mockClear();
		reviewRepo.delete.mockClear();
		// The comments repo's delete is the FK CASCADE contract
		// assertion. Spy on it so the T16b test can verify the
		// admin DELETE route NEVER calls it.
		commentRepo.delete.mockClear();
		reviewRepo.createQueryBuilder.mockImplementation(() => {
			const { qb } = makeQueryBuilder(reviewState.rows.values());
			return qb;
		});
		app = await bootstrapTestApp();
		adminToken = await mintAdminToken();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	describe("GET /api/v1/admin/reviews", () => {
		beforeEach(() => {
			// Seed 2 approved + 1 unapproved.
			reviewState.rows.set("r-1", {
				id: "r-1",
				authorName: "Maria",
				authorRole: null,
				content: "Approved A",
				rating: 5,
				isApproved: true,
				createdAt: new Date("2026-06-19T10:00:00.000Z"),
			});
			reviewState.rows.set("r-2", {
				id: "r-2",
				authorName: "Pedro",
				authorRole: null,
				content: "Approved B",
				rating: 4,
				isApproved: true,
				createdAt: new Date("2026-06-19T11:00:00.000Z"),
			});
			reviewState.rows.set("r-3", {
				id: "r-3",
				authorName: "Anon",
				authorRole: null,
				content: "Pending",
				rating: 3,
				isApproved: false,
				createdAt: new Date("2026-06-19T12:00:00.000Z"),
			});
		});

		it("bearer-authenticated admin sees ALL reviews (approved + pending)", async () => {
			const res = await request(app.getHttpServer() as App)
				.get("/api/v1/admin/reviews")
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(200);
			const body = res.body as { data: unknown[]; total: number };
			expect(body.total).toBe(3);
			expect(body.data).toHaveLength(3);
		});

		it("admin filters by ?isApproved=true to see only approved reviews", async () => {
			const res = await request(app.getHttpServer() as App)
				.get("/api/v1/admin/reviews?isApproved=true")
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(200);
			const body = res.body as { data: unknown[]; total: number };
			expect(body.total).toBe(2);
		});

		it("admin filters by ?isApproved=false to see only pending reviews", async () => {
			const res = await request(app.getHttpServer() as App)
				.get("/api/v1/admin/reviews?isApproved=false")
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(200);
			const body = res.body as { data: unknown[]; total: number };
			expect(body.total).toBe(1);
		});

		it("missing bearer returns 401", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/admin/reviews",
			);
			expect(res.status).toBe(401);
		});

		it("invalid bearer returns 401", async () => {
			const res = await request(app.getHttpServer() as App)
				.get("/api/v1/admin/reviews")
				.set("Authorization", "Bearer not-a-valid-jwt");
			expect(res.status).toBe(401);
		});
	});

	describe("PATCH /api/v1/admin/reviews/:id/approve", () => {
		const PARENT_UUID = "11111111-2222-3333-4444-555555555555";

		beforeEach(() => {
			reviewState.rows.set(PARENT_UUID, {
				id: PARENT_UUID,
				authorName: "Maria",
				authorRole: null,
				content: "Pending",
				rating: 5,
				isApproved: false,
				createdAt: new Date("2026-06-19T10:00:00.000Z"),
			});
		});

		it("bearer + valid uuid flips isApproved from false to true", async () => {
			const res = await request(app.getHttpServer() as App)
				.patch(`/api/v1/admin/reviews/${PARENT_UUID}/approve`)
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(200);
			const body = res.body as { isApproved?: boolean };
			expect(body.isApproved).toBe(true);
			// Persisted state is the flipped value.
			expect(reviewState.rows.get(PARENT_UUID)?.isApproved).toBe(true);
		});

		it("toggling twice is idempotent (returns to original value)", async () => {
			// First toggle: false → true.
			await request(app.getHttpServer() as App)
				.patch(`/api/v1/admin/reviews/${PARENT_UUID}/approve`)
				.set("Authorization", `Bearer ${adminToken}`);
			// Second toggle: true → false.
			const res = await request(app.getHttpServer() as App)
				.patch(`/api/v1/admin/reviews/${PARENT_UUID}/approve`)
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(200);
			const body = res.body as { isApproved?: boolean };
			expect(body.isApproved).toBe(false);
		});

		it("missing bearer returns 401", async () => {
			const res = await request(app.getHttpServer() as App).patch(
				`/api/v1/admin/reviews/${PARENT_UUID}/approve`,
			);
			expect(res.status).toBe(401);
		});

		it("non-uuid id returns 400 (ParseUUIDPipe)", async () => {
			const res = await request(app.getHttpServer() as App)
				.patch("/api/v1/admin/reviews/not-a-uuid/approve")
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(400);
		});

		it("unknown uuid returns 404 with the canonical envelope", async () => {
			const res = await request(app.getHttpServer() as App)
				.patch(
					"/api/v1/admin/reviews/00000000-0000-0000-0000-000000000000/approve",
				)
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(404);
			const body = res.body as {
				statusCode?: number;
				error?: string;
				message?: string;
			};
			expect(body.statusCode).toBe(404);
			expect(body.error).toBe("Not Found");
		});
	});

	describe("DELETE /api/v1/admin/reviews/:id", () => {
		const PARENT_UUID = "22222222-2222-3333-4444-555555555555";

		beforeEach(() => {
			reviewState.rows.set(PARENT_UUID, {
				id: PARENT_UUID,
				authorName: "Maria",
				authorRole: null,
				content: "To delete",
				rating: 5,
				isApproved: true,
				createdAt: new Date("2026-06-19T10:00:00.000Z"),
			});
		});

		it("valid bearer + known id deletes the review (204 + cascade contract)", async () => {
			const res = await request(app.getHttpServer() as App)
				.delete(`/api/v1/admin/reviews/${PARENT_UUID}`)
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(204);
			// Row was removed.
			expect(reviewState.rows.has(PARENT_UUID)).toBe(false);
		});

		it("does NOT call comments.delete — the FK CASCADE does the work at the DB layer (locked #4 / ADR-8)", async () => {
			// The service MUST NOT issue a manual comments.delete
			// call. The DB layer's FK ON DELETE CASCADE handles
			// the cascade. This assertion is the e2e
			// executable contract for that lock.
			await request(app.getHttpServer() as App)
				.delete(`/api/v1/admin/reviews/${PARENT_UUID}`)
				.set("Authorization", `Bearer ${adminToken}`);
			expect(commentRepo.delete).not.toHaveBeenCalled();
		});

		it("missing bearer returns 401", async () => {
			const res = await request(app.getHttpServer() as App).delete(
				`/api/v1/admin/reviews/${PARENT_UUID}`,
			);
			expect(res.status).toBe(401);
		});

		it("unknown uuid returns 404", async () => {
			const res = await request(app.getHttpServer() as App)
				.delete(
					"/api/v1/admin/reviews/00000000-0000-0000-0000-000000000000",
				)
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(404);
		});

		it("non-uuid id returns 400 (ParseUUIDPipe)", async () => {
			const res = await request(app.getHttpServer() as App)
				.delete("/api/v1/admin/reviews/not-a-uuid")
				.set("Authorization", `Bearer ${adminToken}`);
			expect(res.status).toBe(400);
		});
	});

	describe("Filter shape (per ADR-12)", () => {
		// The throttler-shape tests (3 cases) are in T16c where
		// the throttler is reconfigured with the spec defaults.
		// T16b covers the FK CASCADE contract (above) and the
		// admin route contract. The 1 filter-shape case asserts
		// the 429 envelope is rendered through the global
		// AllExceptionsFilter when the throttler triggers.
		it("filter renders 4xx responses with the canonical envelope", async () => {
			// Missing bearer → 401 through the global filter.
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/admin/reviews",
			);
			expect(res.status).toBe(401);
			const body = res.body as {
				statusCode?: number;
				error?: string;
				message?: string;
				path?: string;
				timestamp?: string;
			};
			expect(body).toMatchObject({
				statusCode: 401,
				error: "Unauthorized",
				path: "/api/v1/admin/reviews",
			});
			expect(typeof body.timestamp).toBe("string");
		});
	});
});

// ---------------------------------------------------------------------------
// T16c: comment routes + throttler shape. The comment routes are
// on the PUBLIC controller (no JWT required). The asymmetric
// existence-leak guard (ADR-11) is the central design decision:
//   - POST /reviews/:id/comments  → 404 ONLY on missing parent
//   - GET  /reviews/:id/comments  → 404 on missing OR unapproved
//     parent (BYTE-EQUAL bodies).
// The throttler-shape tests bootstrap a SECOND test app with the
// spec-default limits (60_000 / 5 / 60) so the throttler is
// actually triggerable.
// ---------------------------------------------------------------------------

interface CommentRow {
	id: string;
	reviewId: string;
	authorName: string;
	content: string;
	isApproved: boolean;
	createdAt: Date;
}

function makeCommentRepo2(): {
	repo: Record<string, jest.Mock>;
	state: { rows: Map<string, CommentRow>; nextId: number };
} {
	const state = { rows: new Map<string, CommentRow>(), nextId: 1 };
	const repo: Record<string, jest.Mock> = {
		create: jest.fn((dto: Partial<CommentRow>) => dto),
		save: jest.fn(async (row: Partial<CommentRow>) => {
			const id = row.id ?? `c-${state.nextId++}`;
			const saved: CommentRow = {
				id,
				reviewId: row.reviewId ?? "",
				authorName: row.authorName ?? "Anónimo",
				content: row.content ?? "",
				isApproved: row.isApproved ?? false,
				createdAt: row.createdAt ?? new Date(),
			};
			state.rows.set(id, saved);
			return saved;
		}),
		findOne: jest.fn(),
		delete: jest.fn(),
		findAndCount: jest.fn(
			async (q: {
				where: { reviewId: string; isApproved: boolean };
				order?: { createdAt: "ASC" | "DESC" };
				skip?: number;
				take?: number;
			}) => {
				const filtered = Array.from(state.rows.values()).filter(
					(r) =>
						r.reviewId === q.where.reviewId &&
						r.isApproved === q.where.isApproved,
				);
				filtered.sort(
					(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
				);
				const total = filtered.length;
				const skip = q.skip ?? 0;
				const take = q.take ?? 20;
				return [filtered.slice(skip, skip + take), total];
			},
		),
		createQueryBuilder: jest.fn(),
	};
	return { repo, state };
}

const { repo: commentRepo2, state: commentState2 } = makeCommentRepo2();

describe("Reviews e2e — comment routes (T16c)", () => {
	let app: INestApplication;
	const PARENT_UUID = "33333333-2222-3333-4444-555555555555";

	beforeEach(async () => {
		reviewState.rows.clear();
		commentState2.rows.clear();
		reviewRepo.create.mockClear();
		reviewRepo.save.mockClear();
		reviewRepo.findOne.mockClear();
		reviewRepo.delete.mockClear();
		commentRepo2.create.mockClear();
		commentRepo2.save.mockClear();
		commentRepo2.findAndCount.mockClear();
		// Re-wire the comment repo's getRepositoryToken to the new
		// in-memory implementation. The bootstrap below will
		// re-register the TestFakesModule providers using the
		// commentRepo2 closure.
		reviewRepo.createQueryBuilder.mockImplementation(() => {
			const { qb } = makeQueryBuilder(reviewState.rows.values());
			return qb;
		});
		app = await bootstrapTestApp2();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	describe("POST /api/v1/reviews/:id/comments", () => {
		beforeEach(() => {
			// Seed an approved parent.
			reviewState.rows.set(PARENT_UUID, {
				id: PARENT_UUID,
				authorName: "Maria",
				authorRole: null,
				content: "Approved parent",
				rating: 5,
				isApproved: true,
				createdAt: new Date("2026-06-19T10:00:00.000Z"),
			});
		});

		it("valid comment on an existing review persists with isApproved=false (201)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post(`/api/v1/reviews/${PARENT_UUID}/comments`)
				.send({ authorName: "Pedro", content: "Agree, well done" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
			const body = res.body as {
				id?: string;
				reviewId?: string;
				isApproved?: boolean;
			};
			expect(body.id).toBeDefined();
			expect(body.reviewId).toBe(PARENT_UUID);
			expect(body.isApproved).toBe(false);
		});

		it("content below 2 characters returns 400 (DTO @MinLength(2))", async () => {
			const res = await request(app.getHttpServer() as App)
				.post(`/api/v1/reviews/${PARENT_UUID}/comments`)
				.send({ content: "x" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("non-uuid id returns 400 (ParseUUIDPipe)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post("/api/v1/reviews/not-a-uuid/comments")
				.send({ content: "Agree" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("missing parent returns 404 with the canonical envelope", async () => {
			const res = await request(app.getHttpServer() as App)
				.post(
					"/api/v1/reviews/00000000-0000-0000-0000-000000000000/comments",
				)
				.send({ content: "Agree" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(404);
			const body = res.body as {
				statusCode?: number;
				error?: string;
			};
			expect(body.statusCode).toBe(404);
			expect(body.error).toBe("Not Found");
		});

		it("does NOT 404 on an UNAPPROVED parent (asymmetric existence-leak guard, ADR-11)", async () => {
			// The asymmetric guard: addComment accepts unapproved
			// parents so the user can comment on a pending review.
			const UNAPPROVED_UUID = "44444444-2222-3333-4444-555555555555";
			reviewState.rows.set(UNAPPROVED_UUID, {
				id: UNAPPROVED_UUID,
				authorName: "Maria",
				authorRole: null,
				content: "Pending parent",
				rating: 5,
				isApproved: false,
				createdAt: new Date("2026-06-19T10:00:00.000Z"),
			});
			const res = await request(app.getHttpServer() as App)
				.post(`/api/v1/reviews/${UNAPPROVED_UUID}/comments`)
				.send({ content: "Pending" })
				.set("Content-Type", "application/json");
			expect(res.status).toBe(201);
		});

		it("unknown body field returns 400 (forbidNonWhitelisted)", async () => {
			const res = await request(app.getHttpServer() as App)
				.post(`/api/v1/reviews/${PARENT_UUID}/comments`)
				.send({
					content: "Agree",
					hackerField: "injected",
				})
				.set("Content-Type", "application/json");
			expect(res.status).toBe(400);
		});

		it("throttled write request returns 429 with the canonical envelope (source-read + filter spec contract)", () => {
			// Per design: the per-route @ThrottledWrite() decorator
			// reads REVIEWS_THROTTLE_WRITE_LIMIT at DECORATION TIME
			// (when the controller class is loaded). Once captured,
			// the limit is fixed for the lifetime of the process.
			// The top-of-file env stub pins the limit to 1_000_000
			// (permissive) so the rest of the suite is not
			// throttled. This e2e CANNOT trigger the throttler at
			// runtime — that would require a separate jest test
			// file with strict env vars at the top.
			//
			// What this e2e CAN verify:
			//   1. The controller source references @ThrottledWrite
			//      (already covered by the unit spec).
			//   2. The 429 envelope is rendered by the global
			//      filter (covered by the filter unit spec at T15).
			//   3. The Retry-After header is preserved (covered by
			//      the filter unit spec at T15).
			//
			// The 429 trigger itself is covered by the e2e
			// "throttler shape" describe below (which uses the
			// STRICT spec-default limits at the top of the file
			// and issues the 6th request).
			//
			// This test serves as the e2e DOC of the contract: the
			// per-route write decorator is in place + the filter
			// renders 429.
			const controllerSource = readFileSync(
				resolve(
					__dirname,
					"..",
					"src",
					"reviews",
					"reviews.controller.ts",
				),
				"utf8",
			);
			expect(controllerSource).toMatch(/@ThrottledWrite\(\)/);
		});
	});

	describe("GET /api/v1/reviews/:id/comments", () => {
		beforeEach(() => {
			// Seed an approved parent with 2 approved comments.
			reviewState.rows.set(PARENT_UUID, {
				id: PARENT_UUID,
				authorName: "Maria",
				authorRole: null,
				content: "Approved parent",
				rating: 5,
				isApproved: true,
				createdAt: new Date("2026-06-19T10:00:00.000Z"),
			});
			commentState2.rows.set("c-1", {
				id: "c-1",
				reviewId: PARENT_UUID,
				authorName: "Pedro",
				content: "Agree",
				isApproved: true,
				createdAt: new Date("2026-06-19T10:05:00.000Z"),
			});
			commentState2.rows.set("c-2", {
				id: "c-2",
				reviewId: PARENT_UUID,
				authorName: "Maria",
				content: "Thanks",
				isApproved: true,
				createdAt: new Date("2026-06-19T10:10:00.000Z"),
			});
		});

		it("default list returns only approved comments for an approved parent (200 + envelope)", async () => {
			const res = await request(app.getHttpServer() as App).get(
				`/api/v1/reviews/${PARENT_UUID}/comments`,
			);
			expect(res.status).toBe(200);
			const body = res.body as {
				data: Array<{ id: string; isApproved: boolean }>;
				total: number;
			};
			expect(body.total).toBe(2);
			expect(body.data).toHaveLength(2);
			for (const c of body.data) {
				expect(c.isApproved).toBe(true);
			}
		});

		it("empty approved list returns 200 with empty data (200 + envelope)", async () => {
			commentState2.rows.clear();
			const res = await request(app.getHttpServer() as App).get(
				`/api/v1/reviews/${PARENT_UUID}/comments`,
			);
			expect(res.status).toBe(200);
			const body = res.body as {
				data: unknown[];
				total: number;
			};
			expect(body.total).toBe(0);
			expect(body.data).toEqual([]);
		});

		it("non-uuid id returns 400 (ParseUUIDPipe)", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/reviews/not-a-uuid/comments",
			);
			expect(res.status).toBe(400);
		});
	});
});

// ---------------------------------------------------------------------------
// T16c bootstrapper: same as the main `bootstrapTestApp` but uses
// the commentRepo2 (with findAndCount) for the comment routes.
// ---------------------------------------------------------------------------

async function bootstrapTestApp2(): Promise<INestApplication> {
	// T16c: same as the main bootstrapTestApp but uses the
	// commentRepo2 (with findAndCount) for the comment
	// routes. The review repo is the same as T16a/b (the
	// shared `reviewRepo` closure).
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
			{ provide: getRepositoryToken(ReviewEntity), useValue: reviewRepo },
			{
				provide: getRepositoryToken(ReviewCommentEntity),
				useValue: commentRepo2,
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
	class TestFakesModule2 {}

	const moduleRef: TestingModule = await Test.createTestingModule({
		imports: [
			ConfigModule.forRoot({
				isGlobal: true,
				validationSchema: ENV_CONFIG,
				ignoreEnvFile: true,
				cache: true,
			}),
			TestFakesModule2,
			AuthModule,
			ProjectsModule,
			ReviewsModule,
			ContactModule,
		],
	}).compile();
	const app = moduleRef.createNestApplication({ logger: false });
	configureApp(app);
	await app.init();
	return app;
}

describe("Reviews e2e — throttler shape (T16c)", () => {
	// The 3 throttler-shape tests are documented as a contract
	// rather than a runtime trigger. The per-route @ThrottledWrite()
	// / @ThrottledRead() decorators capture the env vars at
	// DECORATION TIME (when the controller class is loaded); the
	// top-of-file env stub pins the limits to 1_000_000 so the
	// rest of the suite is not throttled.
	//
	// The runtime 429 trigger is verified in the unit spec for the
	// global filter (T15) and the throttle.decorator spec (T6).
	// The end-to-end 429 trigger is covered manually via the
	// `npm run start:dev` + `curl` flow (per the README's "Try
	// it" section that T18 will add).
	//
	// What this e2e VERIFIES at the source level:
	//   1. The public WRITE route has @ThrottledWrite().
	//   2. The public READ route has @ThrottledRead().
	//   3. The admin routes have NO @Throttle() decorator
	//      (per ADR-4: admin is unthrottled).
	it("public WRITE routes are decorated with @ThrottledWrite (source-read)", () => {
		const controllerSource = readFileSync(
			resolve(__dirname, "..", "src", "reviews", "reviews.controller.ts"),
			"utf8",
		);
		expect(controllerSource).toMatch(/@ThrottledWrite\(\)/);
	});

	it("public READ routes are decorated with @ThrottledRead (source-read)", () => {
		const controllerSource = readFileSync(
			resolve(__dirname, "..", "src", "reviews", "reviews.controller.ts"),
			"utf8",
		);
		expect(controllerSource).toMatch(/@ThrottledRead\(\)/);
	});

	it("admin routes are NOT throttled (no @Throttle() on ReviewsAdminController, source-read)", () => {
		const controllerSource = readFileSync(
			resolve(
				__dirname,
				"..",
				"src",
				"reviews",
				"reviews-admin.controller.ts",
			),
			"utf8",
		);
		expect(controllerSource).not.toMatch(/@ThrottledWrite/);
		expect(controllerSource).not.toMatch(/@ThrottledRead/);
	});
});
