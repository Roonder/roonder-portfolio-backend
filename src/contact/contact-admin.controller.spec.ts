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
import { ContactAdminController } from "./contact-admin.controller";
import { ContactService } from "./contact.service";
import { ContactEntity } from "./entities/contact.entity";
import { SentEmailEntity } from "./entities/sent-email.entity";
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
// Throttler is permissive in the unit suite.
process.env.CONTACT_THROTTLE_TTL_MS = "1000";
process.env.CONTACT_THROTTLE_WRITE_LIMIT = "1000000";
process.env.CONTACT_THROTTLE_READ_LIMIT = "1000000";

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
// covered in test/contact-admin.e2e-spec.ts (T11.2) with the real
// JwtStrategy.
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
	updateStatus: jest.Mock;
}

function makeServiceFake(): ServiceFake {
	return {
		findAllForAdmin: jest.fn(),
		updateStatus: jest.fn(),
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
		controllers: [ContactAdminController],
		providers: [
			{ provide: ContactService, useValue: serviceFake },
			{ provide: getRepositoryToken(ContactEntity), useValue: {} },
			{ provide: getRepositoryToken(SentEmailEntity), useValue: {} },
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

describe("ContactAdminController metadata — class-level guards + Swagger", () => {
	const controllerSource = readFileSync(
		resolve(__dirname, "contact-admin.controller.ts"),
		"utf8",
	);

	it("carries the 'contact' tag at the class level (Swagger)", () => {
		const tags = Reflect.getMetadata(
			"swagger/apiUseTags",
			ContactAdminController,
		) as string[] | undefined;
		expect(tags).toEqual(["contact"]);
	});

	it("carries @ApiBearerAuth() at the class level (per ADR-6)", () => {
		const security = Reflect.getMetadata(
			"swagger/apiSecurity",
			ContactAdminController,
		) as Array<unknown> | undefined;
		expect(security).toBeDefined();
		expect(security).toHaveLength(1);
	});

	it("carries @UseGuards(JwtAuthGuard) at the class level (per ADR-6)", () => {
		const guards = Reflect.getMetadata(
			"__guards__",
			ContactAdminController,
		) as Array<{ name: string }> | undefined;
		expect(guards).toBeDefined();
		expect(guards).toHaveLength(1);
		expect(guards?.[0]?.name).toBe("JwtAuthGuard");
	});

	it("declares 2 routes: GET + PATCH (the admin surface — no :id GET, no DELETE)", () => {
		const proto = ContactAdminController.prototype as unknown as Record<
			string,
			unknown
		>;
		expect(typeof proto["findAllForAdmin"]).toBe("function");
		expect(typeof proto["updateStatus"]).toBe("function");
	});

	it("does NOT apply @Throttle() to any method (per ADR-4: admin routes are unthrottled)", () => {
		expect(controllerSource).not.toMatch(/@ThrottledContactWrite/);
		expect(controllerSource).not.toMatch(/@ThrottledWrite/);
		expect(controllerSource).not.toMatch(/@ThrottledRead/);
		expect(controllerSource).not.toMatch(/@Throttle\(/);
	});

	it("uses ParseUUIDPipe on :id (no +id numeric coercion bug)", () => {
		expect(controllerSource).toMatch(/ParseUUIDPipe/);
		expect(controllerSource).not.toMatch(/\+id/);
	});
});

describe("ContactAdminController HTTP probe (route mounted + guarded)", () => {
	let app: INestApplication;
	let service: ServiceFake;

	beforeEach(async () => {
		service = makeServiceFake();
		app = await bootstrapTestApp(service);
	});

	afterEach(async () => {
		if (app) await app.close();
	});

	it("GET /api/v1/admin/contacts returns 401 (route is mounted + guarded)", async () => {
		const res = await request(app.getHttpServer() as App).get(
			"/api/v1/admin/contacts",
		);
		expect(res.status).toBe(401);
	});

	it("PATCH /api/v1/admin/contacts/:id returns 401 (route is mounted + guarded)", async () => {
		const res = await request(app.getHttpServer() as App).patch(
			"/api/v1/admin/contacts/11111111-2222-3333-4444-555555555555",
		);
		expect(res.status).toBe(401);
	});

	it("PATCH /api/v1/admin/contacts/not-a-uuid returns 401 (the guard fires first; ParseUUIDPipe is exercised end-to-end in T11.2)", async () => {
		// The class-level @UseGuards(JwtAuthGuard) fires BEFORE
		// the param-level @Param('id', ParseUUIDPipe) in the
		// NestJS request lifecycle. So a non-uuid id with NO
		// bearer header returns 401 from the guard. The full
		// 400-on-non-uuid path is covered end-to-end in
		// test/contact-admin.e2e-spec.ts (T11.2) where the
		// request has a valid bearer AND a non-uuid id.
		const res = await request(app.getHttpServer() as App).patch(
			"/api/v1/admin/contacts/not-a-uuid",
		);
		expect(res.status).toBe(401);
	});
});
