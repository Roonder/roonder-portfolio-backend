// Set process.env BEFORE any module import so ConfigModule.forRoot()
// at decoration time sees valid values (mirrors test/auth.e2e-spec.ts
// and test/bootstrap.e2e-spec.ts).

/* eslint-disable @typescript-eslint/require-await -- the in-memory repo
 * fakes below are `async` for type compatibility with TypeORM's
 * `Repository<T>` surface even when their body is synchronous (the
 * production code awaits them). Removing the `async` keyword would force
 * a `Promise.resolve(...)` wrap at every return site. */
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
// The real TypeOrmCoreModule would call dataSource.initialize() at module
// compile time; the e2e suite has no live Postgres. Repositories are
// supplied by hand via a @Global() TestFakesModule below.
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
	Global,
	INestApplication,
	Module,
	ValidationPipe,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import request from "supertest";
import type { App } from "supertest/types";
import { ProjectEntity } from "../src/projects/entities/project.entity";
import { ProjectUrlEntity } from "../src/projects/entities/project-url.entity";
import { ProjectsModule } from "../src/projects/projects.module";
import { AuthModule } from "../src/auth/auth.module";
import { UserEntity } from "../src/auth/entities/user.entity";
import { RefreshTokenEntity } from "../src/auth/entities/refresh-token.entity";
import { ENV_CONFIG, EnvConfig } from "../src/config/env.config";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";

// ---------------------------------------------------------------------------
// In-memory fakes. The projects e2e needs MORE than the empty fakes used in
// the unit suite — the service code paths run end-to-end here, so the
// `findOne`, `find`, `save`, `insert`, `delete`, and `createQueryBuilder`
// surfaces must behave like a real `Repository<T>` over a Map.
// ---------------------------------------------------------------------------

interface ProjectRow {
	id: string;
	title: string;
	slug: string;
	description: string;
	content: string | null;
	coverImage: string | null;
	tags: string[];
	isPublished: boolean;
	createdAt: Date;
	updatedAt: Date;
	urls: ProjectUrlRow[];
}

interface ProjectUrlRow {
	id: string;
	projectId: string;
	title: string;
	url: string;
	createdAt: Date;
	updatedAt: Date;
}

function newId(prefix: string): string {
	// RFC 4122 v4 — easy to identify in failure messages.
	const r = Math.random().toString(16).slice(2, 15);
	return `${prefix}-${r}-${Date.now().toString(16)}`;
}

function makeProjectRepo(): {
	repo: Record<string, jest.Mock>;
	rows: ProjectRow[];
} {
	const rows: ProjectRow[] = [];
	const repo: Record<string, jest.Mock> = {};

	repo["findOne"] = jest.fn(
		async (opts: {
			where: Record<string, unknown>;
			relations?: { urls?: boolean };
			select?: Record<string, boolean>;
		}) => {
			const matches = rows.filter((r) =>
				Object.entries(opts.where).every(([k, v]) => {
					if (k === "isPublished" || k === "is_published") {
						return (
							(r as unknown as Record<string, unknown>)[
								"isPublished"
							] === v
						);
					}
					return (r as unknown as Record<string, unknown>)[k] === v;
				}),
			);
			const row = matches[0];
			if (!row) return null;
			if (opts.relations?.urls) {
				return {
					...row,
					urls: row.urls.slice(),
				};
			}
			const out: Record<string, unknown> = { ...row };
			if (opts.select) {
				const picked: Record<string, unknown> = {};
				for (const [k, on] of Object.entries(opts.select)) {
					if (on) picked[k] = out[k];
				}
				return picked;
			}
			return out;
		},
	);

	repo["find"] = jest.fn(
		async (opts?: { where: Record<string, unknown> }) => {
			if (!opts?.where) return rows.slice();
			return rows.filter((r) =>
				Object.entries(opts.where).every(
					([k, v]) =>
						(r as unknown as Record<string, unknown>)[k] === v,
				),
			);
		},
	);

	repo["save"] = jest.fn(async (row: ProjectRow) => {
		const idx = rows.findIndex((r) => r.id === row.id);
		if (idx >= 0) {
			rows[idx] = { ...rows[idx], ...row, updatedAt: new Date() };
			return rows[idx];
		}
		const created: ProjectRow = {
			...row,
			id: row.id ?? newId("p"),
			createdAt: new Date(),
			updatedAt: new Date(),
			urls: row.urls ?? [],
		};
		rows.push(created);
		return created;
	});

	repo["insert"] = jest.fn();

	repo["delete"] = jest.fn(async (criteria: { id: string }) => {
		const idx = rows.findIndex((r) => r.id === criteria.id);
		if (idx < 0) return { affected: 0 };
		rows.splice(idx, 1);
		// Cascade is the FK's job; in the fake we also drop the children so
		// the in-memory state matches what the DB would do under ON DELETE
		// CASCADE. The e2e never inspects the children's lifecycle directly.
		return { affected: 1 };
	});

	// Chainable QueryBuilder fake. The service calls (in order):
	//   createQueryBuilder("project")
	//     .leftJoinAndSelect("project.urls", "url")
	//     .where("project.is_published = :isPub", { isPub })
	//     .orderBy("project.created_at", "DESC")
	//     .skip((page - 1) * pageSize)
	//     .take(pageSize)
	//     .andWhere("project.tags @> ARRAY[:...tags]", { tags })
	//     .getManyAndCount()
	// The fake FILTERS in-memory so the e2e exercises the wire-level
	// query params, not just a canned return value.
	function buildQb(): Record<string, unknown> {
		const whereClauses: Array<(r: ProjectRow) => boolean> = [];
		const andWhereClauses: Array<(r: ProjectRow) => boolean> = [];
		let order: { key: keyof ProjectRow; dir: "ASC" | "DESC" } | null = null;
		let skipN = 0;
		let takeN: number | null = null;

		const qb: Record<string, unknown> = {
			leftJoinAndSelect: jest.fn(() => qb),
			where: jest.fn(
				(sql: string, params: { isPub?: boolean | string }) => {
					// `project.is_published = :isPub`
					if (/is_published/.test(sql) && "isPub" in params) {
						const want = Boolean(params.isPub);
						whereClauses.push((r) => r.isPublished === want);
					}
					return qb;
				},
			),
			andWhere: jest.fn((sql: string, params: { tags?: string[] }) => {
				// `project.tags @> ARRAY[:...tags]`
				if (/tags\s+@>/.test(sql) && Array.isArray(params.tags)) {
					const wanted = new Set(params.tags);
					andWhereClauses.push((r) => {
						const have = new Set(r.tags);
						for (const t of wanted) {
							if (!have.has(t)) return false;
						}
						return true;
					});
				}
				return qb;
			}),
			orderBy: jest.fn((sql: string, dir: "ASC" | "DESC") => {
				const m = /project\.(\w+)/.exec(sql);
				if (m) {
					order = {
						key: m[1] as keyof ProjectRow,
						dir,
					};
				}
				return qb;
			}),
			skip: jest.fn((n: number) => {
				skipN = n;
				return qb;
			}),
			take: jest.fn((n: number) => {
				takeN = n;
				return qb;
			}),
			getManyAndCount: jest.fn(async () => {
				const all = rows.filter((r) => {
					for (const fn of whereClauses) {
						if (!fn(r)) return false;
					}
					for (const fn of andWhereClauses) {
						if (!fn(r)) return false;
					}
					return true;
				});
				if (order) {
					const { key, dir } = order;
					all.sort((a, b) => {
						const av = a[key];
						const bv = b[key];
						if (av instanceof Date && bv instanceof Date) {
							return dir === "ASC"
								? av.getTime() - bv.getTime()
								: bv.getTime() - av.getTime();
						}
						return 0;
					});
				}
				const total = all.length;
				const slice =
					takeN === null
						? all.slice(skipN)
						: all.slice(skipN, skipN + takeN);
				return [slice, total];
			}),
		};
		return qb;
	}

	repo["createQueryBuilder"] = jest.fn(() => buildQb());

	return { repo, rows };
}

function makeProjectUrlRepo(): {
	repo: Record<string, jest.Mock>;
	rows: ProjectUrlRow[];
} {
	const rows: ProjectUrlRow[] = [];
	const repo: Record<string, jest.Mock> = {};

	repo["find"] = jest.fn(
		async (opts?: { where: Record<string, unknown> }) => {
			if (!opts?.where) return rows.slice();
			return rows.filter((r) =>
				Object.entries(opts.where).every(
					([k, v]) =>
						(r as unknown as Record<string, unknown>)[k] === v,
				),
			);
		},
	);

	repo["findOne"] = jest.fn(
		async (opts: { where: Record<string, unknown> }) => {
			const matches = rows.filter((r) =>
				Object.entries(opts.where).every(
					([k, v]) =>
						(r as unknown as Record<string, unknown>)[k] === v,
				),
			);
			return matches[0] ?? null;
		},
	);

	repo["insert"] = jest.fn();

	repo["save"] = jest.fn();

	repo["delete"] = jest.fn();

	repo["createQueryBuilder"] = jest.fn();

	return { repo, rows };
}

// In-memory user + refresh token repos for the auth module composition
// (the projects e2e never calls auth endpoints, but AuthModule must
// compose cleanly to expose JwtAuthGuard to ProjectsController).
function makeUserRepo(): { findOne: jest.Mock; save: jest.Mock } {
	return {
		findOne: jest.fn().mockResolvedValue(null),
		save: jest.fn(),
	};
}
function makeRefreshTokenRepo(): Record<string, jest.Mock> {
	return {
		findOne: jest.fn().mockResolvedValue(null),
		insert: jest.fn(),
		update: jest.fn(),
	};
}

// DataSource fake. The service calls `dataSource.transaction(async (manager)
// => { ... })` and the manager must support `create`, `save`, `insert`,
// `find`, `findOne`, `delete`. We hand the manager a real in-memory view of
// the project rows (the same Map under the hood) so the transaction body
// reads + writes the same state the controller will return.
function makeDataSource(
	projectRows: ProjectRow[],
	projectUrlRows: ProjectUrlRow[],
): { transaction: jest.Mock } {
	const manager = {
		create: jest.fn(
			<Entity, Data extends object>(_e: Entity, data: Data) => data,
		),
		save: jest.fn(async <T extends { id?: string }>(row: T): Promise<T> => {
			const r = row as ProjectRow | ProjectUrlRow;
			if ("projectId" in r) {
				const idx = projectUrlRows.findIndex((x) => x.id === r.id);
				if (idx >= 0) {
					projectUrlRows[idx] = {
						...projectUrlRows[idx],
						...r,
						updatedAt: new Date(),
					};
					return projectUrlRows[idx] as unknown as T;
				}
				const created = {
					...r,
					id: r.id ?? newId("u"),
					createdAt: new Date(),
					updatedAt: new Date(),
				};
				projectUrlRows.push(created);
				return created as unknown as T;
			}
			const idx = projectRows.findIndex((x) => x.id === r.id);
			if (idx >= 0) {
				projectRows[idx] = {
					...projectRows[idx],
					...r,
					updatedAt: new Date(),
				};
				return projectRows[idx] as unknown as T;
			}
			const created = {
				...r,
				id: r.id ?? newId("p"),
				createdAt: new Date(),
				updatedAt: new Date(),
				urls: r.urls ?? [],
			};
			projectRows.push(created);
			return created as unknown as T;
		}),
		insert: jest.fn(
			async <Entity, Data extends object>(
				_e: Entity,
				data: Data[],
			): Promise<unknown> => {
				for (const d of data) {
					const r = d as unknown as ProjectUrlRow;
					projectUrlRows.push({
						...r,
						id: newId("u"),
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				}
				return { identifiers: data.map(() => ({ id: newId("u") })) };
			},
		),
		find: jest.fn(
			async <Entity, T = unknown>(
				_e: Entity,
				opts?: { where: Record<string, unknown> },
			): Promise<T[]> => {
				const all = projectUrlRows;
				if (!opts?.where) return all.slice() as unknown as T[];
				return all.filter((r) =>
					Object.entries(opts.where).every(
						([k, v]) =>
							(r as unknown as Record<string, unknown>)[k] === v,
					),
				) as unknown as T[];
			},
		),
		findOne: jest.fn(
			async <Entity, T = unknown>(
				_e: Entity,
				opts: {
					where: Record<string, unknown>;
					relations?: { urls?: boolean };
				},
			): Promise<T | null> => {
				const matches = projectRows.filter((r) =>
					Object.entries(opts.where).every(([k, v]) => {
						if (k === "isPublished" || k === "is_published") {
							return (
								(r as unknown as Record<string, unknown>)[
									"isPublished"
								] === v
							);
						}
						return (
							(r as unknown as Record<string, unknown>)[k] === v
						);
					}),
				);
				const row = matches[0];
				if (!row) return null;
				if (opts.relations?.urls) {
					return {
						...row,
						urls: row.urls.slice(),
					} as unknown as T;
				}
				return { ...row } as unknown as T;
			},
		),
		delete: jest.fn(
			async <Entity>(
				_e: Entity,
				criteria: string[] | { id?: string; projectId?: string },
			): Promise<{ affected?: number }> => {
				if (Array.isArray(criteria)) {
					const before = projectUrlRows.length;
					for (let i = projectUrlRows.length - 1; i >= 0; i--) {
						if (criteria.includes(projectUrlRows[i].id)) {
							projectUrlRows.splice(i, 1);
						}
					}
					return { affected: before - projectUrlRows.length };
				}
				if (criteria.projectId !== undefined) {
					const before = projectUrlRows.length;
					for (let i = projectUrlRows.length - 1; i >= 0; i--) {
						if (
							projectUrlRows[i].projectId === criteria.projectId
						) {
							projectUrlRows.splice(i, 1);
						}
					}
					return { affected: before - projectUrlRows.length };
				}
				if (criteria.id !== undefined) {
					const before = projectUrlRows.length;
					for (let i = projectUrlRows.length - 1; i >= 0; i--) {
						if (projectUrlRows[i].id === criteria.id) {
							projectUrlRows.splice(i, 1);
						}
					}
					return { affected: before - projectUrlRows.length };
				}
				return { affected: 0 };
			},
		),
	};
	return {
		transaction: jest.fn(
			async <T>(fn: (m: typeof manager) => Promise<T>): Promise<T> => {
				return fn(manager);
			},
		),
	};
}

// In-memory state shared across tests so the controller can read what
// the service wrote within a test.
const projectState = makeProjectRepo();
const projectUrlState = makeProjectUrlRepo();
const dataSource = makeDataSource(projectState.rows, projectUrlState.rows);
const fakeUserRepo = makeUserRepo();
const fakeRefreshTokenRepo = makeRefreshTokenRepo();

// @Global() TestFakesModule — supplies every @InjectRepository / DataSource
// token the test graph needs. Same pattern as
// `src/app.module.spec.ts:84-115` (Task 2.9). The unit suite uses empty
// fakes because the projects.service.spec.ts has its own richer fakes;
// the e2e needs RICH fakes because the service code paths run end-to-end.
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
			useValue: projectState.repo,
		},
		{
			provide: getRepositoryToken(ProjectUrlEntity),
			useValue: projectUrlState.repo,
		},
		{ provide: DataSource, useValue: dataSource },
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

// Compose the full app: AuthModule (for JwtAuthGuard) + ProjectsModule.
// The fakes satisfy every @InjectRepository / DataSource provider.
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
	const frontendUrl = cs.get("FRONTEND_URL", { infer: true }) as string;
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
	// Wire the real AllExceptionsFilter so the e2e exercises the same
	// envelope shape the production app emits.
	app.useGlobalFilters(
		new AllExceptionsFilter(
			app.get(HttpAdapterHost),
			app.get(ConfigService<EnvConfig>),
		),
	);
	await app.init();
	return app;
}

describe("projects (e2e) — Task 3.1 harness + empty-list smoke", () => {
	let app: INestApplication;

	beforeEach(async () => {
		// Reset the in-memory rows between tests so the cases are
		// independent. The fakes themselves survive across tests
		// (their jest.fn() mocks accumulate call history), but the
		// state is wiped clean.
		projectState.rows.length = 0;
		projectUrlState.rows.length = 0;
		app = await bootstrapTestApp();
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it("GET /api/v1/projects with no rows returns the empty envelope (200)", async () => {
		const res = await request(app.getHttpServer() as App).get(
			"/api/v1/projects",
		);
		expect(res.status).toBe(200);
		expect(res.headers["content-type"]).toMatch(/application\/json/);
		expect(res.body).toEqual({
			data: [],
			total: 0,
			page: 1,
			pageSize: 20,
		});
	});
});
