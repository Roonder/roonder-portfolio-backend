import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { UserEntity } from "./entities/user.entity";
import { RefreshTokenEntity } from "./entities/refresh-token.entity";

const fakeUserRepo = { findOne: jest.fn(), save: jest.fn() };
const fakeRtRepo = { findOne: jest.fn(), insert: jest.fn(), update: jest.fn() };

describe("AuthController", () => {
	let controller: AuthController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			imports: [
				JwtModule.register({
					secret: "test-secret-32-chars-min-..................",
				}),
			],
			controllers: [AuthController],
			providers: [
				AuthService,
				{
					provide: getRepositoryToken(UserEntity),
					useValue: fakeUserRepo,
				},
				{
					provide: getRepositoryToken(RefreshTokenEntity),
					useValue: fakeRtRepo,
				},
				{
					provide: ConfigService,
					useValue: {
						get: (key: string) => {
							if (key === "JWT_SECRET")
								return "test-secret-32-chars-min-..................";
							if (key === "JWT_EXPIRES_IN") return "15m";
							if (key === "JWT_REFRESH_SECRET")
								return "refresh-secret-32-chars-min-......";
							if (key === "JWT_REFRESH_EXPIRES_IN")
								return "2592000";
							return undefined;
						},
					},
				},
			],
		}).compile();

		controller = module.get<AuthController>(AuthController);
	});

	it("should be defined", () => {
		expect(controller).toBeDefined();
	});
});
