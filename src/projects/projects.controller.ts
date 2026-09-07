import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	ParseUUIDPipe,
	Patch,
	Post,
	Query,
	UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ProjectsService } from "./projects.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { ListProjectsQueryDto } from "./dto/list-projects-query.dto";
import { ListProjectsResponseDto } from "./dto/list-projects-response.dto";
import { ProjectResponseDto } from "./dto/project-response.dto";

/**
 * Public + admin CRUD surface for projects.
 *
 * 7 routes (per design §Swagger Annotations and ADR-5):
 *
 *   GET    /api/v1/projects           — public, paginated list (published only)
 *   GET    /api/v1/projects/admin     — protected (JwtAuthGuard), list any publish state
 *   GET    /api/v1/projects/by-id/:id — protected (JwtAuthGuard), read by uuid
 *   GET    /api/v1/projects/:slug     — public, single project by slug
 *   POST   /api/v1/projects           — protected (JwtAuthGuard), create
 *   PATCH  /api/v1/projects/:id       — protected (JwtAuthGuard), update
 *   DELETE /api/v1/projects/:id       — protected (JwtAuthGuard), delete
 *
 * `admin` and `by-id/:id` are declared BEFORE `:slug` — route
 * registration order matters here, otherwise the `:slug` wildcard
 * would swallow both literal segments.
 *
 * `:id` is the project's internal uuid — `ParseUUIDPipe` validates
 * the format and returns 400 for anything that is not a uuid. The
 * stub's `+id` numeric coercion is gone.
 *
 * `:slug` is the project's public identifier — kebab-case string
 * validated by the DBML's `slug varchar unique not null` constraint
 * and the `CreateProjectDto` regex. No pipe on the param.
 *
 * 4xx/5xx responses are NOT declared per route (except the success
 * shape) — the canonical envelope is the global exception filter's
 * job (PR1).
 */
@ApiTags("projects")
@Controller("projects")
export class ProjectsController {
	constructor(private readonly projects: ProjectsService) {}

	@Get()
	@SkipThrottle()
	@ApiOperation({ summary: "List public projects (paginated, filterable)" })
	@ApiResponse({
		status: 200,
		description: "Envelope of projects matching the filters",
		type: ListProjectsResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid query parameters" })
	findPublic(@Query() query: ListProjectsQueryDto) {
		return this.projects.findPublic(query);
	}

	@Get("admin")
	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@SkipThrottle()
	@ApiOperation({ summary: "List all projects for the admin panel (any publish state)" })
	@ApiResponse({
		status: 200,
		description: "Envelope of projects matching the filters",
		type: ListProjectsResponseDto,
	})
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	findAllAdmin(@Query() query: ListProjectsQueryDto) {
		return this.projects.findAllForAdmin(query);
	}

	@Get("by-id/:id")
	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@SkipThrottle()
	@ApiOperation({ summary: "Get a project by id (any publish state)" })
	@ApiResponse({
		status: 200,
		description: "The project body",
		type: ProjectResponseDto,
	})
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	@ApiResponse({ status: 404, description: "Project not found" })
	findOneById(@Param("id", ParseUUIDPipe) id: string) {
		return this.projects.findOneById(id);
	}

	@Get(":slug")
	@SkipThrottle()
	@ApiOperation({ summary: "Get a published project by slug" })
	@ApiResponse({
		status: 200,
		description: "The project body",
		type: ProjectResponseDto,
	})
	@ApiResponse({ status: 404, description: "Project not found" })
	findOneBySlug(@Param("slug") slug: string) {
		return this.projects.findOneBySlug(slug);
	}

	@Post()
	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@SkipThrottle()
	@ApiOperation({ summary: "Create a new project" })
	@ApiResponse({
		status: 201,
		description: "The created project body",
		type: ProjectResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid body" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	@ApiResponse({ status: 409, description: "Slug already in use" })
	create(@Body() dto: CreateProjectDto) {
		return this.projects.create(dto);
	}

	@Patch(":id")
	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@SkipThrottle()
	@ApiOperation({
		summary: "Update a project (DIFF urls, partial body)",
	})
	@ApiResponse({
		status: 200,
		description: "The updated project body",
		type: ProjectResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid body or id" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	@ApiResponse({ status: 404, description: "Project not found" })
	@ApiResponse({ status: 409, description: "Slug already in use" })
	update(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateProjectDto,
	) {
		return this.projects.update(id, dto);
	}

	@Delete(":id")
	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@SkipThrottle()
	@HttpCode(204)
	@ApiOperation({ summary: "Delete a project (cascades to project_urls)" })
	@ApiResponse({ status: 204, description: "Project deleted" })
	@ApiResponse({ status: 400, description: "Invalid id" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	@ApiResponse({ status: 404, description: "Project not found" })
	remove(@Param("id", ParseUUIDPipe) id: string) {
		return this.projects.remove(id);
	}
}
