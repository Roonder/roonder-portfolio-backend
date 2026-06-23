import "reflect-metadata";
import {
	CanActivate,
	INestApplication,
	Injectable,
	UnauthorizedException,
	ValidationPipe,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { getRepositoryToken } from "@nestjs/typeorm";
import request from "supertest";
import type { App } from "supertest/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReviewsAdminController } from "./reviews-admin.controller";
import { ReviewsService } from "./reviews.service";
import { ReviewEntity } from "./entities/review.entity";
import { ReviewCommentEntity } from "./entities/review-comment.entity";
import { ENV_CONFIG } from "../config/env.config";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

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
process.env.RESEND_FROM_ADDRESS = "Roonder Portfolio <hello@roonder.dev>";
process.env.RESEND_TO_ADDRESS = "admin@roonder.dev";
process.env.FRONTEND_URL = "https://app.example.com";
process.env.NODE_ENV = "test";
// Throttler is a no-op in the unit suite.
process.env.REVIEWS_THROTTLE_TTL_MS = "1000";
process.env.REVIEWS_THROTTLE_WRITE_LIMIT = "1000000";
process.env.REVIEWS_THROTTLE_READ_LIMIT = "1000000";

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
// Test guard — replaces JwtAuthGuard in this spec's test module. Always
// throws 401 so the spec can verify the route is mounted AND protected.
// The full 401-on-missing-bearer + 401-on-invalid-bearer behaviour is
// covered in test/reviews.e2e-spec.ts (T16) with the real JwtStrategy.
// ---------------------------------------------------------------------------
@Injectable()
class StubJwtAuthGuard implements CanActivate {
	canActivate(): boolean {
		throw new UnauthorizedException("Missing or invalid bearer");
	}
}

// ---------------------------------------------------------------------------
// Service fake
// ---------------------------------------------------------------------------

interface ServiceFake {
	findAllForAdmin: jest.Mock;
	toggleApproval: jest.Mock;
	remove: jest.Mock;
}

function makeServiceFake(): ServiceFake {
	return {
		findAllForAdmin: jest.fn(),
		toggleApproval: jest.fn(),
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
			ThrottlerModule.forRoot([
				{ name: "default", ttl: 1_000, limit: 1_000_000 },
			]),
		],
		controllers: [ReviewsAdminController],
		providers: [
			{ provide: ReviewsService, useValue: serviceFake },
			{ provide: getRepositoryToken(ReviewEntity), useValue: {} },
			{ provide: getRepositoryToken(ReviewCommentEntity), useValue: {} },
		],
	})
		.overrideGuard(JwtAuthGuard)
		.useClass(StubJwtAuthGuard)
		.compile();
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
// Tests — metadata (source read) + HTTP probe (supertest with stub guard)
// ---------------------------------------------------------------------------

describe("ReviewsAdminController metadata — class-level guards + Swagger", () => {
	const controllerSource = readFileSync(
		resolve(__dirname, "reviews-admin.controller.ts"),
		"utf8",
	);

	it("carries the 'reviews' tag at the class level (Swagger)", () => {
		const tags = Reflect.getMetadata(
			"swagger/apiUseTags",
			ReviewsAdminController,
		) as string[] | undefined;
		expect(tags).toEqual(["reviews"]);
	});

	it("carries @ApiBearerAuth() at the class level (per ADR-6)", () => {
		// `@ApiBearerAuth()` (with no args) sets the
		// `swagger/apiSecurity` metadata key on the class. We
		// read it from the class, not the instance.
		const security = Reflect.getMetadata(
			"swagger/apiSecurity",
			ReviewsAdminController,
		) as Array<unknown> | undefined;
		expect(security).toBeDefined();
		expect(security).toHaveLength(1);
	});

	it("carries @UseGuards(JwtAuthGuard) at the class level (per ADR-6)", () => {
		// The class-level @UseGuards stores the metadata on the
		// CONSTRUCTOR (the class itself), not on each method. Nest's
		// GuardsContextCreator.reflectClassMetadata reads from
		// `prototype.constructor` (see
		// node_modules/@nestjs/core/helpers/context-creator.js:19).
		const guards = Reflect.getMetadata(
			"__guards__",
			ReviewsAdminController,
		) as Array<{ name: string }> | undefined;
		expect(guards).toBeDefined();
		expect(guards).toHaveLength(1);
		expect(guards?.[0]?.name).toBe("JwtAuthGuard");
	});

	it("declares 3 routes: GET, PATCH /:id/approve, DELETE /:id (no throttler on admin per ADR-4)", () => {
		const proto = ReviewsAdminController.prototype as Record<
			string,
			unknown
		>;
		expect(typeof proto["findAllForAdmin"]).toBe("function");
		expect(typeof proto["toggleApproval"]).toBe("function");
		expect(typeof proto["remove"]).toBe("function");
	});

	it("does NOT apply @Throttle() to any method (per ADR-4: admin routes are unthrottled)", () => {
		// Static source-text check: the controller source must NOT
		// reference the @ThrottledWrite / @ThrottledRead
		// decorators. Admin routes are intentionally unthrottled
		// (the spec scenario "Admin routes are NOT throttled").
		expect(controllerSource).not.toMatch(/@ThrottledWrite/);
		expect(controllerSource).not.toMatch(/@ThrottledRead/);
		expect(controllerSource).not.toMatch(/@Throttle\(/);
	});

	it("uses ParseUUIDPipe on :id (no +id numeric coercion bug)", () => {
		// The PATCH + DELETE :id routes must use ParseUUIDPipe
		// (returns 400 on non-uuid). No `+id` numeric coercion.
		expect(controllerSource).toMatch(/ParseUUIDPipe/);
		expect(controllerSource).not.toMatch(/\+id/);
	});
});

describe("ReviewsAdminController HTTP probe (route mounted + guarded)", () => {
	let app: INestApplication;
	let service: ServiceFake;

	beforeEach(async () => {
		service = makeServiceFake();
		app = await bootstrapTestApp(service);
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it("GET /api/v1/admin/reviews returns 401 (route is mounted + guarded)", async () => {
		// The StubJwtAuthGuard rejects every request, so the probe
		// gets 401 — confirming the route IS mounted under the
		// global prefix AND the guard is in effect. The 401 body
		// comes from Nest's default exception filter (the
		// AllExceptionsFilter is wired in main.ts only — its e2e
		// assertion is in T16).
		const res = await request(app.getHttpServer() as App).get(
			"/api/v1/admin/reviews",
		);
		expect(res.status).toBe(401);
	});

	it("PATCH /api/v1/admin/reviews/:id/approve returns 401 (route is mounted + guarded)", async () => {
		const res = await request(app.getHttpServer() as App).patch(
			"/api/v1/admin/reviews/11111111-2222-3333-4444-555555555555/approve",
		);
		expect(res.status).toBe(401);
	});

	it("DELETE /api/v1/admin/reviews/:id returns 401 (route is mounted + guarded)", async () => {
		const res = await request(app.getHttpServer() as App).delete(
			"/api/v1/admin/reviews/11111111-2222-3333-4444-555555555555",
		);
		expect(res.status).toBe(401);
	});
});
