import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
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
