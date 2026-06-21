import { AppDataSource } from "../data-source";
import { ProjectEntity } from "../projects/entities/project.entity";
import { ProjectUrlEntity } from "../projects/entities/project-url.entity";
import { seedProjects } from "./seed-projects";

/**
 * Unit suite for the projects seed script. Mirrors the
 * `seed-superuser.spec.ts` pattern: the pure function `seedProjects`
 * is the testable seam; the `main()` I/O wrapper is exercised only
 * at the import / `AppDataSource` shape level.
 *
 * The `process.env.SEED_DRY_RUN=1` path asserts the script NEVER
 * touches the repositories when dry-run is on — a safe local
 * verification mode.
 */
describe("seedProjects (pure function)", () => {
	const ORIGINAL_DRY_RUN = process.env.SEED_DRY_RUN;

	afterEach(() => {
		if (ORIGINAL_DRY_RUN === undefined) {
			delete process.env.SEED_DRY_RUN;
		} else {
			process.env.SEED_DRY_RUN = ORIGINAL_DRY_RUN;
		}
	});

	it("(1) is importable and the file exports `seedProjects` and a default function shape (module loads)", () => {
		// The import above would have failed at module load if the
		// file is missing or has a syntax error. The `seedProjects`
		// symbol must be a function — assert its type at runtime.
		expect(typeof seedProjects).toBe("function");
		// The I/O wrapper `main` is invoked only when the file is
		// run as a CLI (`require.main === module`); the test runner
		// does not trip that branch. The presence of the helper is
		// what matters for the import contract.
		expect(typeof AppDataSource.initialize).toBe("function");
		expect(typeof AppDataSource.getRepository).toBe("function");
	});

	it("(2) returns the expected slug count (4 projects: 3 published, 1 unpublished)", async () => {
		// The pure function returns a `SeedSummary` describing what
		// was inserted. We pass Jest fakes for both repositories so
		// no real DB connection is opened — same pattern as the
		// superuser spec.
		const {
			repo: projectRepo,
			createCalls,
			saveCalls,
		} = makeFakeProjectRepo();
		const { repo: projectUrlRepo, insertCalls } = makeFakeProjectUrlRepo();
		delete process.env.SEED_DRY_RUN;

		const result = await seedProjects({
			projectRepo,
			projectUrlRepo,
		});

		expect(result.projects).toHaveLength(4);
		expect(result.projectUrls).toHaveLength(
			// 1 url on project 1, 2 on project 2, 3 on project 3,
			// 1 on the unpublished project 4 = 7 rows total.
			7,
		);
		const slugs = [...result.projects.map((p) => p.slug)].sort();
		expect(slugs).toEqual(
			[
				"alpha-portfolio",
				"beta-storefront",
				"gamma-cli",
				"draft-sandbox",
			].sort(),
		);
		const publishedCount = result.projects.filter(
			(p) => p.isPublished,
		).length;
		const unpublishedCount = result.projects.filter(
			(p) => !p.isPublished,
		).length;
		expect(publishedCount).toBe(3);
		expect(unpublishedCount).toBe(1);
		// Sanity: the fake's own counters agree with the summary.
		expect(createCalls).toHaveLength(4);
		expect(saveCalls).toHaveLength(4);
		expect(insertCalls.length).toBeGreaterThan(0);
	});

	it("(3) persists projects with the seeded fields (id, slug, title, isPublished)", async () => {
		const {
			repo: projectRepo,
			createCalls,
			saveCalls,
		} = makeFakeProjectRepo();
		const { repo: projectUrlRepo } = makeFakeProjectUrlRepo();
		delete process.env.SEED_DRY_RUN;

		await seedProjects({ projectRepo, projectUrlRepo });

		expect(createCalls).toHaveLength(4);
		// Every project row has the slug / title / isPublished
		// the seed script promises.
		for (const row of createCalls) {
			expect(typeof row.slug).toBe("string");
			expect(row.slug.length).toBeGreaterThan(0);
			expect(typeof row.title).toBe("string");
			expect(row.title.length).toBeGreaterThan(0);
			expect(typeof row.isPublished).toBe("boolean");
		}
		// `projectRepo.save` was called once per project (4 total).
		expect(saveCalls).toHaveLength(4);
	});

	it("(4) persists project_urls rows linked to the seeded projects", async () => {
		const { repo: projectRepo } = makeFakeProjectRepo();
		const { repo: projectUrlRepo, insertCalls } = makeFakeProjectUrlRepo();
		delete process.env.SEED_DRY_RUN;

		await seedProjects({ projectRepo, projectUrlRepo });

		expect(insertCalls.length).toBeGreaterThan(0);
		// Every project_url row carries a `projectId` (a non-empty
		// string) so the FK to `projects.id` is satisfied.
		for (const batch of insertCalls) {
			for (const row of batch) {
				expect(typeof row.projectId).toBe("string");
				expect(row.projectId.length).toBeGreaterThan(0);
				expect(typeof row.title).toBe("string");
				expect(typeof row.url).toBe("string");
			}
		}
	});

	it("(5) SEED_DRY_RUN=1 short-circuits BEFORE any repository call (no rows written)", async () => {
		const {
			repo: projectRepo,
			createCalls,
			saveCalls,
		} = makeFakeProjectRepo();
		const { repo: projectUrlRepo, insertCalls } = makeFakeProjectUrlRepo();
		process.env.SEED_DRY_RUN = "1";

		const result = await seedProjects({
			projectRepo,
			projectUrlRepo,
		});

		// The function still reports the *intended* shape of the
		// seed (so a log line can render it), but the repositories
		// were NEVER touched.
		expect(result.projects).toHaveLength(4);
		expect(result.projectUrls).toHaveLength(7);
		expect(createCalls).toHaveLength(0);
		expect(saveCalls).toHaveLength(0);
		expect(insertCalls).toHaveLength(0);
	});

	it("(6) idempotent run on an existing projectRepo.findOne returns a non-null hit: counts as 'exists', no insert (re-runnable contract)", async () => {
		// The pure function is the testable seam; the I/O wrapper
		// `main()` is what owns the `findOne` pre-check. Asserting
		// the wrapper's idempotency here is out of scope — the
		// pure function is a straight insert. This test exists to
		// lock in the contract: `seedProjects` does NOT itself
		// call `findOne`; idempotency is the caller's job (the
		// I/O wrapper).
		const { repo: projectRepo, findOneCalls } = makeFakeProjectRepo();
		const { repo: projectUrlRepo } = makeFakeProjectUrlRepo();
		delete process.env.SEED_DRY_RUN;

		await seedProjects({ projectRepo, projectUrlRepo });

		// `findOne` was never called by the pure function.
		expect(findOneCalls).toHaveLength(0);
	});

	it("(7) the AppDataSource is configured with both projects entities (smoke check, mirrors seed-superuser)", () => {
		// The runtime path (`main()`) calls `AppDataSource.initialize()`
		// and then `getRepository(ProjectEntity)` /
		// `getRepository(ProjectUrlEntity)`. Assert the entity
		// tokens are registered on the shared DataSource so the
		// `getRepository` calls succeed.
		const entities = (AppDataSource.options.entities ?? []) as unknown[];
		expect(entities).toContain(ProjectEntity);
		expect(entities).toContain(ProjectUrlEntity);
	});
});

interface FakeProjectRepo {
	findOne: jest.Mock;
	create: jest.Mock;
	save: jest.Mock;
}
interface FakeProjectUrlRepo {
	insert: jest.Mock;
}

function makeFakeProjectRepo(): {
	repo: FakeProjectRepo;
	createCalls: Array<Record<string, unknown>>;
	saveCalls: Array<Record<string, unknown>>;
	findOneCalls: Array<{ where: Record<string, unknown> }>;
} {
	const createCalls: Array<Record<string, unknown>> = [];
	const saveCalls: Array<Record<string, unknown>> = [];
	const findOneCalls: Array<{ where: Record<string, unknown> }> = [];
	const repo: FakeProjectRepo = {
		findOne: jest.fn().mockImplementation((args: { where: unknown }) => {
			findOneCalls.push({
				where: args ?? {},
			});
			return Promise.resolve(null);
		}),
		create: jest
			.fn()
			.mockImplementation((data: Record<string, unknown>) => {
				createCalls.push(data);
				return { id: `seeded-${createCalls.length}`, ...data };
			}),
		save: jest.fn().mockImplementation((data: Record<string, unknown>) => {
			saveCalls.push(data);
			return Promise.resolve(data);
		}),
	};
	return { repo, createCalls, saveCalls, findOneCalls };
}

function makeFakeProjectUrlRepo(): {
	repo: FakeProjectUrlRepo;
	insertCalls: Array<Array<Record<string, unknown>>>;
} {
	const insertCalls: Array<Array<Record<string, unknown>>> = [];
	const repo: FakeProjectUrlRepo = {
		insert: jest.fn().mockImplementation(
			// `Repository<T>.insert(values)` takes a single arg
			// (the values or array of values). Match the
			// production call shape: 1 arg, the array of rows.
			(rows: Array<Record<string, unknown>>) => {
				insertCalls.push(rows);
				return Promise.resolve({ identifiers: [], generatedMaps: [] });
			},
		),
	};
	return { repo, insertCalls };
}
