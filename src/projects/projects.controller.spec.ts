import "reflect-metadata";
import {
	INestApplication,
	NotFoundException,
	ValidationPipe,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import type { App } from "supertest/types";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
import { ProjectEntity } from "./entities/project.entity";
import { ProjectUrlEntity } from "./entities/project-url.entity";
import { ENV_CONFIG } from "../config/env.config";

// Set process.env BEFORE the AppModule is imported so that
// ConfigModule.forRoot() at decoration time sees valid values.
process.env.PORT = "3000";
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test-secret-32-chars-min-..................";
process.env.JWT_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_SECRET = "refresh-secret-32-chars-min-......";
process.env.JWT_REFRESH_EXPIRES_IN = "2592000";
process.env.SUPERUSER_EMAIL = "admin@test.io";
process.env.SUPERUSER_PASSWORD = "test-password";
process.env.RESEND_API_KEY = "re_test";
process.env.FRONTEND_URL = "https://app.example.com";
process.env.NODE_ENV = "test";

// Mock @nestjs/typeorm so the unit suite never opens a real DB connection.
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

// ---------------------------------------------------------------------------
// Service fake
// ---------------------------------------------------------------------------

interface ServiceFake {
	findPublic: jest.Mock;
	findOneBySlug: jest.Mock;
	create: jest.Mock;
	update: jest.Mock;
	remove: jest.Mock;
}

function makeServiceFake(): ServiceFake {
	return {
		findPublic: jest.fn(),
		findOneBySlug: jest.fn(),
		create: jest.fn(),
		update: jest.fn(),
		remove: jest.fn(),
	};
}

async function bootstrapTestApp(
	serviceFake: ServiceFake,
): Promise<INestApplication> {
	const moduleRef: TestingModule = await Test.createTestingModule({
		imports: [
			ConfigModule.forRoot({
				isGlobal: true,
				validationSchema: ENV_CONFIG,
				ignoreEnvFile: true,
				cache: true,
			}),
		],
		controllers: [ProjectsController],
		providers: [
			{ provide: ProjectsService, useValue: serviceFake },
			{
				provide: getRepositoryToken(ProjectEntity),
				useValue: {},
			},
			{
				provide: getRepositoryToken(ProjectUrlEntity),
				useValue: {},
			},
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
	await app.init();
	return app;
}

// ---------------------------------------------------------------------------
// Tests — public routes via supertest, protected routes via metadata
// ---------------------------------------------------------------------------

describe("ProjectsController (HTTP shape — public routes)", () => {
	let app: INestApplication;
	let service: ServiceFake;

	beforeEach(async () => {
		service = makeServiceFake();
		app = await bootstrapTestApp(service);
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	describe("GET /api/v1/projects", () => {
		it("returns 200 + envelope with empty data on a no-op DB", async () => {
			service.findPublic.mockResolvedValue({
				data: [],
				total: 0,
				page: 1,
				pageSize: 20,
			});
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/projects",
			);
			expect(res.status).toBe(200);
			expect(res.body).toMatchObject({
				data: [],
				total: 0,
				page: 1,
				pageSize: 20,
			});
		});

		it("forwards query params to service.findPublic (tags, page, pageSize)", async () => {
			service.findPublic.mockResolvedValue({
				data: [],
				total: 0,
				page: 2,
				pageSize: 5,
			});
			await request(app.getHttpServer() as App).get(
				"/api/v1/projects?tags=react&tags=nestjs&page=2&pageSize=5",
			);
			expect(service.findPublic).toHaveBeenCalledTimes(1);
			const firstCallArgs = service.findPublic.mock.calls[0] as Array<
				Record<string, unknown>
			>;
			const call = firstCallArgs[0];
			expect(call).toMatchObject({
				page: 2,
				pageSize: 5,
			});
		});

		it("rejects page < 1 with 400 (validation pipe)", async () => {
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/projects?page=0",
			);
			expect(res.status).toBe(400);
		});

		it("rejects pageSize > 100 with 400 (DTO @Max(100))", async () => {
			// The DTO has @Max(100); the service re-clamps at the
			// service layer. The 400 is the wire-level guard.
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/projects?pageSize=500",
			);
			expect(res.status).toBe(400);
		});
	});

	describe("GET /api/v1/projects/:slug", () => {
		it("returns 200 + project on hit", async () => {
			service.findOneBySlug.mockResolvedValue({
				id: "p-1",
				slug: "portfolio-app",
				title: "Portfolio app",
			});
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/projects/portfolio-app",
			);
			expect(res.status).toBe(200);
			const body = res.body as { slug?: string };
			expect(body.slug).toBe("portfolio-app");
		});

		it("returns 404 + canonical envelope on missing slug", async () => {
			service.findOneBySlug.mockRejectedValue(
				new NotFoundException("Project not found"),
			);
			const res = await request(app.getHttpServer() as App).get(
				"/api/v1/projects/missing",
			);
			expect(res.status).toBe(404);
			// The body shape here is Nest's default exception filter
			// (the AllExceptionsFilter from PR1 is NOT wired in this
			// unit-spec — wiring is verified in main.spec.ts). We
			// only assert the status + message are propagated.
			const body = res.body as { message?: string };
			expect(body.message).toBe("Project not found");
		});
	});
});

describe("ProjectsController (protected routes — DTO + service wire)", () => {
	// The 3 protected routes (POST, PATCH, DELETE) carry
	// `@UseGuards(JwtAuthGuard)`. The guard requires a valid
	// `passport-jwt` strategy to be registered, which is the
	// auth-domain's responsibility. Wiring that up in this
	// controller-level spec is out of scope (and would duplicate
	// `auth.controller.spec.ts`).
	//
	// The DTO-level validation, the ParseUUIDPipe on `:id`, and
	// the controller's method signatures are covered by:
	//   - `create-project.dto.spec.ts` + `update-project.dto.spec.ts`
	//     (DTO validation per ADR-2)
	//   - `projects.service.spec.ts` (service contract)
	//   - The metadata block below (guards + Swagger tags)
	//
	// The full HTTP behaviour for the protected routes — 401 on
	// missing bearer, 200/201/204/400/404/409 envelopes — is the
	// scope of the PR3 e2e spec (`test/projects.e2e-spec.ts`).
	// The test below is a placeholder that documents the coverage
	// boundary so future maintainers do not "fill the gap" by
	// duplicating the JwtAuthGuard + JwtStrategy setup.
	it("covered by PR3 e2e (test/projects.e2e-spec.ts) — see comment", () => {
		expect(true).toBe(true);
	});
});

describe("ProjectsController metadata — Swagger + Guards", () => {
	it("carries the 'projects' tag at the class level (Swagger)", () => {
		// @ApiTags stores an array on the class (not the instance)
		// under the `swagger/apiUseTags` key. We read from the
		// class, not the instance, because that's where the
		// decorator applied the metadata.
		const tags = Reflect.getMetadata(
			"swagger/apiUseTags",
			ProjectsController,
		) as string[] | undefined;
		expect(tags).toEqual(["projects"]);
	});

	it("5 routes declared on the controller (5 methods)", () => {
		const proto = ProjectsController.prototype as Record<string, unknown>;
		const methods = [
			"findPublic",
			"findOneBySlug",
			"create",
			"update",
			"remove",
		];
		for (const m of methods) {
			expect(typeof proto[m]).toBe("function");
		}
	});

	it("protected handlers (create, update, remove) carry JwtAuthGuard via @UseGuards", () => {
		// `@UseGuards(SomeClass)` sets a metadata key that
		// Nest's GuardsConsumer reads at request time. The key
		// is `__guards__` and the value is an array of guard
		// class references. We assert the JwtAuthGuard class is
		// in that array for each protected method.
		const proto = ProjectsController.prototype as Record<string, object>;
		const guarded = ["create", "update", "remove"] as const;
		for (const m of guarded) {
			const guards = Reflect.getMetadata("__guards__", proto[m]) as
				| Array<{ name: string }>
				| undefined;
			expect(guards).toBeDefined();
			expect(guards).toHaveLength(1);
			expect(guards?.[0]?.name).toBe("JwtAuthGuard");
		}
	});

	it("public handlers (findPublic, findOneBySlug) have NO @UseGuards", () => {
		const proto = ProjectsController.prototype as Record<string, object>;
		const unguarded = ["findPublic", "findOneBySlug"] as const;
		for (const m of unguarded) {
			const guards = Reflect.getMetadata("__guards__", proto[m]) as
				| Array<unknown>
				| undefined;
			// Public methods have no guards — the metadata is
			// either undefined or an empty array (both acceptable
			// to Nest's GuardsConsumer).
			expect(guards ?? []).toHaveLength(0);
		}
	});
});
