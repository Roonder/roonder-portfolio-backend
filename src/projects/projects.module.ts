import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProjectsService } from "./projects.service";
import { ProjectsController } from "./projects.controller";
import { ProjectEntity } from "./entities/project.entity";
import { ProjectUrlEntity } from "./entities/project-url.entity";

/**
 * Projects domain module. The two entities are registered with
 * `TypeOrmModule.forFeature([...])` so the
 * `@InjectRepository(ProjectEntity)` /
 * `@InjectRepository(ProjectUrlEntity)` tokens in
 * `ProjectsService` resolve to the typeorm-managed repository
 * instances at runtime.
 *
 * The shared `AppDataSource` (from `src/data-source.ts`) is
 * bootstrapped in `AppModule` via `TypeOrmModule.forRootAsync` —
 * this module only adds the per-feature repositories. The
 * `forFeature` line is required per the spec scenario
 * "DataSource and ProjectsModule register both entities" in
 * `openspec/changes/projects-crud/specs/projects-domain/spec.md`.
 *
 * In the unit suite (`src/app.module.spec.ts`,
 * `src/main.spec.ts`) `@nestjs/typeorm` is mocked, so the
 * `forFeature` returns a no-op module. The two repository tokens
 * are provided as `useValue: {}` fakes via the
 * `TestFakesModule` `@Global()` block in each spec — see Task 2.9
 * for the wiring history.
 */
@Module({
	imports: [TypeOrmModule.forFeature([ProjectEntity, ProjectUrlEntity])],
	controllers: [ProjectsController],
	providers: [ProjectsService],
})
export class ProjectsModule {}
