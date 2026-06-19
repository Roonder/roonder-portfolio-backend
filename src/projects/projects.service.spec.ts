import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource, QueryFailedError } from "typeorm";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { ProjectsService } from "./projects.service";
import { ProjectEntity } from "./entities/project.entity";
import { ProjectUrlEntity } from "./entities/project-url.entity";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

// Chainable QueryBuilder fake. The service calls (in order):
//   createQueryBuilder("project")
//     .leftJoinAndSelect("project.urls", "url")
//     .where("project.is_published = :isPub", { isPub })
//     .orderBy("project.created_at", "DESC")
//     .skip((page - 1) * pageSize)
//     .take(pageSize)
//     .andWhere("project.tags @> ARRAY[:...tags]", { tags })
//     .getManyAndCount()
//
// We capture each call so the spec can assert the SQL fragment + args.
interface CapturedQuery {
	where?: { sql: string; params: Record<string, unknown> };
	andWheres: Array<{ sql: string; params: Record<string, unknown> }>;
	joins: string[];
	orderBy?: { sql: string; direction: "ASC" | "DESC" };
	skipVal?: number;
	takeVal?: number;
}

function makeQueryBuilderFake(): {
	qb: Record<string, jest.Mock>;
	captured: CapturedQuery;
} {
	const captured: CapturedQuery = { andWheres: [], joins: [] };
	const qb: Record<string, jest.Mock> = {};
	// Each chainable method returns `this` (the qb) so calls can chain.
	// `where` and `andWhere` capture their args separately.
	qb["leftJoinAndSelect"] = jest.fn(() => {
		captured.joins.push("leftJoinAndSelect");
		return qb;
	});
	qb["where"] = jest.fn((sql: string, params: Record<string, unknown>) => {
		captured.where = { sql, params };
		return qb;
	});
	qb["andWhere"] = jest.fn((sql: string, params: Record<string, unknown>) => {
		captured.andWheres.push({ sql, params });
		return qb;
	});
	qb["orderBy"] = jest.fn((sql: string, direction: "ASC" | "DESC") => {
		captured.orderBy = { sql, direction };
		return qb;
	});
	qb["skip"] = jest.fn((n: number) => {
		captured.skipVal = n;
		return qb;
	});
	qb["take"] = jest.fn((n: number) => {
		captured.takeVal = n;
		return qb;
	});
	// getManyAndCount is the terminal — returns the canned rows + total.
	qb["getManyAndCount"] = jest.fn().mockResolvedValue([[], 0]);
	// Pre-create chainable stubs for the methods the service might call
	// in the future; not exercised now but defensive against API drift.
	for (const m of [
		"innerJoin",
		"innerJoinAndSelect",
		"leftJoin",
		"select",
		"addSelect",
		"groupBy",
		"having",
	]) {
		qb[m] = jest.fn(() => qb);
	}
	return { qb, captured };
}

function makeProjectsRepo(): {
	createQueryBuilder: jest.Mock;
	qb: Record<string, jest.Mock>;
	captured: CapturedQuery;
} {
	const { qb, captured } = makeQueryBuilderFake();
	return {
		createQueryBuilder: jest.fn(() => qb),
		qb,
		captured,
	};
}

async function buildService(
	projectsRepo: ReturnType<typeof makeProjectsRepo>,
): Promise<ProjectsService> {
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			ProjectsService,
			{
				provide: getRepositoryToken(ProjectEntity),
				useValue: projectsRepo,
			},
			{
				provide: getRepositoryToken(ProjectUrlEntity),
				useValue: {},
			},
			{ provide: DataSource, useValue: {} },
		],
	}).compile();
	return module.get(ProjectsService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Fixture rows for the findOneBySlug tests below. The slug lookup
// returns one of these based on the `isPublished` gate.
const ROW_PUBLISHED = {
	id: "11111111-2222-3333-4444-555555555555",
	title: "Portfolio app",
	slug: "portfolio-app",
	description: "My portfolio",
	content: null,
	coverImage: null,
	tags: ["react"],
	isPublished: true,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	urls: [],
};
const ROW_DRAFT = {
	...ROW_PUBLISHED,
	id: "22222222-2222-3333-4444-555555555555",
	slug: "draft-idea",
	isPublished: false,
};

function makeProjectsRepoWithFindOne(
	rows: Array<typeof ROW_PUBLISHED | typeof ROW_DRAFT>,
): {
	createQueryBuilder: jest.Mock;
	findOne: jest.Mock;
} {
	return {
		createQueryBuilder: jest.fn(),
		findOne: jest.fn(
			(opts: { where: { slug: string; isPublished: boolean } }) => {
				const hit = rows.find(
					(r) =>
						r.slug === opts.where.slug &&
						r.isPublished === opts.where.isPublished,
				);
				return Promise.resolve(hit ?? null);
			},
		),
	};
}

async function buildServiceWithRepo(repo: {
	createQueryBuilder?: jest.Mock;
	findOne?: jest.Mock;
}): Promise<ProjectsService> {
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			ProjectsService,
			{
				provide: getRepositoryToken(ProjectEntity),
				useValue: repo,
			},
			{
				provide: getRepositoryToken(ProjectUrlEntity),
				useValue: {},
			},
			{ provide: DataSource, useValue: {} },
		],
	}).compile();
	return module.get(ProjectsService);
}

describe("ProjectsService.findOneBySlug", () => {
	it("returns the project when slug matches AND isPublished=true", async () => {
		const repo = makeProjectsRepoWithFindOne([ROW_PUBLISHED]);
		const service = await buildServiceWithRepo(repo);
		const out = await service.findOneBySlug("portfolio-app");
		expect(out.id).toBe(ROW_PUBLISHED.id);
		expect(out.slug).toBe("portfolio-app");
		expect(out.isPublished).toBe(true);
	});

	it("queries with the isPublished=true gate (one statement, not two)", async () => {
		const repo = makeProjectsRepoWithFindOne([ROW_PUBLISHED]);
		const service = await buildServiceWithRepo(repo);
		await service.findOneBySlug("portfolio-app");
		expect(repo.findOne).toHaveBeenCalledTimes(1);
		const calls = repo.findOne.mock.calls as Array<
			[{ where: { slug: string; isPublished: boolean } }]
		>;
		const call = calls[0]?.[0];
		expect(call?.where.slug).toBe("portfolio-app");
		expect(call?.where.isPublished).toBe(true);
	});

	it("throws NotFoundException when no project matches the slug", async () => {
		const repo = makeProjectsRepoWithFindOne([]);
		const service = await buildServiceWithRepo(repo);
		await expect(service.findOneBySlug("does-not-exist")).rejects.toThrow(
			NotFoundException,
		);
	});

	it("throws NotFoundException when the project exists but isPublished=false (no existence leak)", async () => {
		// The repo's findOne only returns the row when isPublished=true
		// in the gate. A draft project (isPublished=false) does not
		// match the where clause and is therefore NOT returned. The
		// service must throw the same 404 body as the missing case.
		const repo = makeProjectsRepoWithFindOne([ROW_DRAFT]);
		const service = await buildServiceWithRepo(repo);
		await expect(service.findOneBySlug("draft-idea")).rejects.toThrow(
			NotFoundException,
		);
	});

	it("emits identical 404 message for 'missing' and 'unpublished' cases (no existence leak)", async () => {
		// Spec scenario "Unpublished project returns 404 (no existence
		// leak)": the response body MUST NOT reveal whether the slug
		// exists. We assert the two error messages are byte-equal.
		const repoMissing = makeProjectsRepoWithFindOne([]);
		const serviceMissing = await buildServiceWithRepo(repoMissing);
		const missingErr = await serviceMissing
			.findOneBySlug("does-not-exist")
			.catch((e: Error) => e);

		const repoDraft = makeProjectsRepoWithFindOne([ROW_DRAFT]);
		const serviceDraft = await buildServiceWithRepo(repoDraft);
		const draftErr = await serviceDraft
			.findOneBySlug("draft-idea")
			.catch((e: Error) => e);

		expect(missingErr.message).toBe(draftErr.message);
	});

	it("includes the urls relation in the response (eager via relations: { urls: true })", async () => {
		// The slug lookup uses `relations: { urls: true }` so the
		// response body's `urls` field is populated. We assert the
		// `findOne` call passes the relation config.
		const repo = makeProjectsRepoWithFindOne([ROW_PUBLISHED]);
		const service = await buildServiceWithRepo(repo);
		await service.findOneBySlug("portfolio-app");
		const calls = repo.findOne.mock.calls as Array<
			[{ relations: { urls: boolean } }]
		>;
		const call = calls[0]?.[0];
		expect(call?.relations).toEqual({ urls: true });
	});
});

describe("ProjectsService.findPublic", () => {
	it("applies the public default (isPublished=true) when query.isPublished is undefined", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		await service.findPublic({});
		expect(repo.captured.where?.sql).toBe("project.is_published = :isPub");
		expect(repo.captured.where?.params).toEqual({ isPub: true });
	});

	it("applies page=1 and pageSize=20 defaults when query is empty", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		const out = await service.findPublic({});
		expect(repo.captured.skipVal).toBe(0);
		expect(repo.captured.takeVal).toBe(20);
		expect(out.page).toBe(1);
		expect(out.pageSize).toBe(20);
	});

	it("respects explicit page and pageSize from the query", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		const out = await service.findPublic({
			page: 2,
			pageSize: 10,
		});
		expect(repo.captured.skipVal).toBe(10); // (2-1)*10
		expect(repo.captured.takeVal).toBe(10);
		expect(out.page).toBe(2);
		expect(out.pageSize).toBe(10);
	});

	it("silently clamps pageSize > 100 to 100 (NOT rejected with 400)", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		const out = await service.findPublic({
			pageSize: 500,
		});
		expect(repo.captured.takeVal).toBe(100);
		expect(out.pageSize).toBe(100);
	});

	it("respects an explicit isPublished override (?isPublished=false)", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		await service.findPublic({
			isPublished: false,
		});
		expect(repo.captured.where?.params).toEqual({ isPub: false });
	});

	it("emits a tags @> ARRAY[...] andWhere when query.tags is non-empty (ADR-3)", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		await service.findPublic({
			tags: ["react", "nestjs"],
		});
		expect(repo.captured.andWheres).toHaveLength(1);
		expect(repo.captured.andWheres[0]?.sql).toBe(
			"project.tags @> ARRAY[:...tags]",
		);
		expect(repo.captured.andWheres[0]?.params).toEqual({
			tags: ["react", "nestjs"],
		});
	});

	it("does NOT emit a tags andWhere when query.tags is empty or undefined", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		await service.findPublic({ tags: [] });
		expect(repo.captured.andWheres).toHaveLength(0);
	});

	it("orders by created_at DESC", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		await service.findPublic({});
		expect(repo.captured.orderBy).toEqual({
			sql: "project.created_at",
			direction: "DESC",
		});
	});

	it("joins the project_urls child table (leftJoinAndSelect)", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		await service.findPublic({});
		expect(repo.captured.joins).toContain("leftJoinAndSelect");
	});

	it("returns the envelope shape { data, total, page, pageSize }", async () => {
		const repo = makeProjectsRepo();
		const service = await buildService(repo);
		const out = await service.findPublic({});
		expect(out).toHaveProperty("data");
		expect(out).toHaveProperty("total");
		expect(out).toHaveProperty("page");
		expect(out).toHaveProperty("pageSize");
		// Defaults on a no-op DB call:
		//   data: [], total: 0, page: 1, pageSize: 20
		expect(out.data).toEqual([]);
		expect(out.total).toBe(0);
		expect(out.page).toBe(1);
		expect(out.pageSize).toBe(20);
	});
});

// ---------------------------------------------------------------------------
// Task 2.5 — create(dto)
// ---------------------------------------------------------------------------

// Fake EntityManager. The create() path runs inside
// `dataSource.transaction(async (manager) => ...)`. We need a manager
// where `manager.create`, `manager.save`, and `manager.insert` are
// captured jest mocks.
function makeManagerFake(): {
	manager: {
		create: jest.Mock;
		save: jest.Mock;
		insert: jest.Mock;
	};
} {
	return {
		manager: {
			create: jest.fn(),
			save: jest.fn(),
			insert: jest.fn(),
		},
	};
}

function makeDataSourceWithTransaction(
	manager: { create: jest.Mock; save: jest.Mock; insert: jest.Mock },
	opts: { throwError?: Error } = {},
): { dataSource: { transaction: jest.Mock }; transactionCalls: number } {
	const transactionCalls = { count: 0 };
	const ds = {
		transaction: jest.fn(
			async (cb: (m: typeof manager) => Promise<unknown>) => {
				transactionCalls.count++;
				if (opts.throwError) throw opts.throwError;
				return cb(manager);
			},
		),
	};
	return {
		dataSource: ds,
		transactionCalls: transactionCalls,
	};
}

async function buildServiceWithDeps(
	repo: { findOne?: jest.Mock; createQueryBuilder?: jest.Mock },
	dataSource: { transaction: jest.Mock },
): Promise<ProjectsService> {
	const module: TestingModule = await Test.createTestingModule({
		providers: [
			ProjectsService,
			{ provide: getRepositoryToken(ProjectEntity), useValue: repo },
			{
				provide: getRepositoryToken(ProjectUrlEntity),
				useValue: {},
			},
			{ provide: DataSource, useValue: dataSource },
		],
	}).compile();
	return module.get(ProjectsService);
}

const CREATE_DTO = {
	title: "Portfolio app",
	slug: "portfolio-app",
	description: "My portfolio",
};

describe("ProjectsService.create", () => {
	it("happy path: persists project + urls in a single transaction", async () => {
		// Arrange: pre-check returns null (slug free). Manager.save
		// returns the saved row; manager.insert is called for urls.
		const repo = {
			findOne: jest.fn().mockResolvedValue(null),
		};
		const mgr = makeManagerFake();
		mgr.manager.create.mockReturnValue({ ...CREATE_DTO });
		mgr.manager.save.mockResolvedValue({
			id: "new-id",
			...CREATE_DTO,
			tags: [],
			isPublished: false,
			content: null,
			coverImage: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			urls: [],
		});
		mgr.manager.insert.mockResolvedValue({ identifiers: [] });
		const { dataSource } = makeDataSourceWithTransaction(mgr.manager);

		const service = await buildServiceWithDeps(repo, dataSource);
		const out = await service.create({
			...CREATE_DTO,
			urls: [{ title: "Repo", url: "https://x.io" }],
		});

		// Assert: pre-check ran with the slug.
		expect(repo.findOne).toHaveBeenCalledWith({
			where: { slug: CREATE_DTO.slug },
			select: { id: true },
		});
		// Assert: transaction was opened.
		expect(dataSource.transaction).toHaveBeenCalledTimes(1);
		// Assert: manager.create, manager.save, manager.insert all fired.
		expect(mgr.manager.create).toHaveBeenCalled();
		expect(mgr.manager.save).toHaveBeenCalled();
		expect(mgr.manager.insert).toHaveBeenCalled();
		// Assert: response has the saved id.
		expect(out.id).toBe("new-id");
	});

	it("pre-check on duplicate slug throws 409 and never opens a transaction", async () => {
		const repo = {
			findOne: jest.fn().mockResolvedValue({ id: "taken" }),
		};
		const mgr = makeManagerFake();
		const { dataSource } = makeDataSourceWithTransaction(mgr.manager);

		const service = await buildServiceWithDeps(repo, dataSource);
		await expect(service.create(CREATE_DTO)).rejects.toThrow(
			ConflictException,
		);
		// Critical: the pre-check fires BEFORE the transaction. A
		// 409 on the pre-check must never reach `dataSource.transaction`.
		expect(dataSource.transaction).not.toHaveBeenCalled();
	});

	it("QueryFailedError(23505) re-throws as 409 (race catch)", async () => {
		// Pre-check passes (no row), but the transaction hits a unique
		// violation because a concurrent insert grabbed the slug.
		const repo = {
			findOne: jest.fn().mockResolvedValue(null),
		};
		const mgr = makeManagerFake();
		mgr.manager.create.mockReturnValue({ ...CREATE_DTO });
		// QueryFailedError's `code` lives on the wrapped driverError
		// (the third constructor arg). pg's `error.code` is a string
		// like '23505'. Assign it as a regular enumerable property
		// so QueryFailedError's ObjectUtils.assign(...) picks it up
		// when copying driverError fields onto itself.
		const driverError = Object.assign(
			new Error(
				'duplicate key value violates unique constraint "projects_slug_key"',
			),
			{ code: "23505" },
		);
		mgr.manager.save.mockRejectedValue(
			new QueryFailedError("insert into projects ...", [], driverError),
		);
		const { dataSource } = makeDataSourceWithTransaction(mgr.manager);

		const service = await buildServiceWithDeps(repo, dataSource);
		await expect(service.create(CREATE_DTO)).rejects.toThrow(
			ConflictException,
		);
	});

	it("non-23505 errors are NOT translated to 409 (re-thrown as-is)", async () => {
		// Defensive: a generic Postgres error (e.g. 23503 FK violation)
		// must NOT be masked as a 409 — the filter will render a 500.
		const repo = {
			findOne: jest.fn().mockResolvedValue(null),
		};
		const mgr = makeManagerFake();
		mgr.manager.create.mockReturnValue({ ...CREATE_DTO });
		const boom = new Error("connection lost");
		mgr.manager.save.mockRejectedValue(boom);
		const { dataSource } = makeDataSourceWithTransaction(mgr.manager);

		const service = await buildServiceWithDeps(repo, dataSource);
		await expect(service.create(CREATE_DTO)).rejects.toBe(boom);
	});

	it("happy path with NO urls: insert is NOT called, transaction still commits", async () => {
		const repo = {
			findOne: jest.fn().mockResolvedValue(null),
		};
		const mgr = makeManagerFake();
		mgr.manager.create.mockReturnValue({ ...CREATE_DTO });
		mgr.manager.save.mockResolvedValue({
			id: "new-id",
			...CREATE_DTO,
			tags: [],
			isPublished: false,
			content: null,
			coverImage: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			urls: [],
		});
		const { dataSource } = makeDataSourceWithTransaction(mgr.manager);

		const service = await buildServiceWithDeps(repo, dataSource);
		await service.create({ ...CREATE_DTO }); // no urls
		expect(mgr.manager.insert).not.toHaveBeenCalled();
		expect(dataSource.transaction).toHaveBeenCalledTimes(1);
	});
});
