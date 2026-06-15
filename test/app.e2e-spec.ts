// Set process.env BEFORE the AppModule import so ConfigModule.forRoot()
// at decoration time sees valid values. The AppController e2e was added by
// the original NestJS scaffold for a `Hello World!` GET / that no longer
// exists — this stub is the minimum needed to keep the import from throwing
// after the bootstrap change wired ConfigModule with ENV_CONFIG.
process.env.PORT = "3000";
process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "test-secret";
process.env.RESEND_API_KEY = "re_test";
process.env.FRONTEND_URL = "http://localhost:5173";

import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "./../src/app.module";

describe("AppController (e2e)", () => {
	let app: INestApplication<App>;

	beforeEach(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();

		app = moduleFixture.createNestApplication();
		await app.init();
	});

	it("/ (GET)", () => {
		return request(app.getHttpServer())
			.get("/")
			.expect(200)
			.expect("Hello World!");
	});

	afterEach(async () => {
		await app.close();
	});
});
