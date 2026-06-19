import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectEntity } from "./entities/project.entity";
import { ProjectUrlEntity } from "./entities/project-url.entity";

describe("ProjectsController", () => {
	let controller: ProjectsController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ProjectsController],
			providers: [
				ProjectsService,
				// The new service constructor takes 3 deps
				// (ProjectEntity repo, ProjectUrlEntity repo, DataSource).
				// Fakes are sufficient for this scaffold spec — the
				// HTTP-shape tests land in Task 2.8 with their own
				// richer fakes.
				{
					provide: getRepositoryToken(ProjectEntity),
					useValue: {},
				},
				{
					provide: getRepositoryToken(ProjectUrlEntity),
					useValue: {},
				},
				{ provide: DataSource, useValue: {} },
			],
		}).compile();

		controller = module.get<ProjectsController>(ProjectsController);
	});

	it("should be defined", () => {
		expect(controller).toBeDefined();
	});
});
