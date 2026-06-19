import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { ProjectsService } from "./projects.service";
import { ProjectEntity } from "./entities/project.entity";
import { ProjectUrlEntity } from "./entities/project-url.entity";

// Fakes for the injected repos. We only need the surface that the
// constructor touches — the methods get stubbed out per test in the
// next tasks (2.3 - 2.7). For Task 2.2 we only assert the service
// is constructible with the 3 deps wired.
const fakeProjectsRepo = {};
const fakeProjectUrlsRepo = {};
const fakeDataSource = {};

describe("ProjectsService skeleton", () => {
	it("is constructible with ProjectEntity repo + ProjectUrlEntity repo + DataSource (Task 2.2)", async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ProjectsService,
				{
					provide: getRepositoryToken(ProjectEntity),
					useValue: fakeProjectsRepo,
				},
				{
					provide: getRepositoryToken(ProjectUrlEntity),
					useValue: fakeProjectUrlsRepo,
				},
				{ provide: DataSource, useValue: fakeDataSource },
			],
		}).compile();
		const service = module.get(ProjectsService);
		expect(service).toBeInstanceOf(ProjectsService);
		// The three deps are stored on private fields. We assert the
		// surface the next tasks (2.3 - 2.7) will exercise by reading
		// them through `unknown` casts — the fields are not part of
		// the public API, but the spec exists to lock the
		// constructor signature in place.
		const svc = service as unknown as {
			projects: typeof fakeProjectsRepo;
			projectUrls: typeof fakeProjectUrlsRepo;
			dataSource: typeof fakeDataSource;
		};
		expect(svc.projects).toBe(fakeProjectsRepo);
		expect(svc.projectUrls).toBe(fakeProjectUrlsRepo);
		expect(svc.dataSource).toBe(fakeDataSource);
	});
});
