import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createHash } from "node:crypto";
import * as bcrypt from "bcrypt";
import { AuthService } from "./auth.service";
import { UserEntity } from "./entities/user.entity";
import { RefreshTokenEntity } from "./entities/refresh-token.entity";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

const TEST_PASSWORD = "correct-password";
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);
const FIXED_USER_ID = "11111111-2222-3333-4444-555555555555";
const TEST_EMAIL = "admin@x.io";

interface FakeUserRepo {
	findOne: jest.Mock;
}

interface FakeRefreshTokenRepo {
	findOne: jest.Mock;
	insert: jest.Mock;
	update: jest.Mock;
}

function makeUserRepo(user: Partial<UserEntity> | null): FakeUserRepo {
	return {
		findOne: jest.fn().mockImplementation(() => {
			if (!user) return Promise.resolve(null);
			// Force-select password because the entity has select:false.
			return Promise.resolve({
				id: FIXED_USER_ID,
				email: TEST_EMAIL,
				password: TEST_PASSWORD_HASH,
				...user,
			});
		}),
	};
}

function makeRefreshTokenRepo(): FakeRefreshTokenRepo & {
	rows: Map<
		string,
		{
			id: string;
			revokedAt: Date | null;
			replacedBy: string | null;
			familyId: string;
			userId: string;
			expiresAt: Date;
			hashedToken: string;
		}
	>;
	updateCalls: Array<{ criteria: unknown; partial: unknown }>;
	insertCalls: Array<{
		userId: string;
		familyId: string;
		hashedToken: string;
		expiresAt: Date;
	}>;
} {
	const rows = new Map<
		string,
		{
			id: string;
			revokedAt: Date | null;
			replacedBy: string | null;
			familyId: string;
			userId: string;
			expiresAt: Date;
			hashedToken: string;
		}
	>();
	const updateCalls: Array<{ criteria: unknown; partial: unknown }> = [];
	const insertCalls: Array<{
		userId: string;
		familyId: string;
		hashedToken: string;
		expiresAt: Date;
	}> = [];
	let nextId = 1;
	return {
		rows,
		updateCalls,
		insertCalls,
		findOne: jest
			.fn()
			.mockImplementation((opts: { where: { hashedToken: string } }) => {
				for (const row of rows.values()) {
					if (row.hashedToken === opts.where.hashedToken)
						return Promise.resolve({ ...row });
				}
				return Promise.resolve(null);
			}),
		insert: jest
			.fn()
			.mockImplementation(
				(data: {
					userId: string;
					familyId: string;
					hashedToken: string;
					expiresAt: Date;
				}) => {
					insertCalls.push(data);
					const id = `rt-${nextId++}`;
					rows.set(id, {
						id,
						revokedAt: null,
						replacedBy: null,
						...data,
					});
					return Promise.resolve({ identifiers: [{ id }] });
				},
			),
		update: jest
			.fn()
			.mockImplementation((criteria: unknown, partial: unknown) => {
				updateCalls.push({ criteria, partial });
				// Resolve the criteria to ids
				if (typeof criteria === "string") {
					const row = rows.get(criteria);
					if (row) Object.assign(row, partial);
				} else if (typeof criteria === "object" && criteria !== null) {
					const c = criteria as {
						familyId?: string;
						revokedAt?: null;
					};
					for (const row of rows.values()) {
						if (
							c.familyId !== undefined &&
							row.familyId !== c.familyId
						)
							continue;
						if (c.revokedAt === null && row.revokedAt !== null)
							continue;
						Object.assign(row, partial);
					}
				}
				return Promise.resolve({ affected: 1 });
			}),
	};
}

function sha256(plain: string): string {
	return createHash("sha256").update(plain).digest("hex");
}

type RefreshTokenRepoFake = FakeRefreshTokenRepo & {
	rows: Map<string, unknown>;
	updateCalls: Array<{ criteria: unknown; partial: unknown }>;
	insertCalls: Array<{
		userId: string;
		familyId: string;
		hashedToken: string;
		expiresAt: Date;
	}>;
};

/**
 * `EntityManager` fake. The production code does
 * `manager.getRepository(RefreshTokenEntity).update(...)` etc. inside
 * the transaction; we hand back the SAME `rtRepo` / `userRepo` fakes
 * the test already mutates, so all writes inside the transaction
 * land in the same in-memory `rows` map the post-transaction reads
 * inspect.
 */
function makeManager(
	rtRepo: RefreshTokenRepoFake,
	userRepo: FakeUserRepo,
): { getRepository: jest.Mock } {
	return {
		getRepository: jest.fn((entity: unknown) => {
			if (entity === RefreshTokenEntity) return rtRepo;
			if (entity === UserEntity) return userRepo;
			throw new Error(
				`unexpected entity in test makeManager: ${String(entity)}`,
			);
		}),
	};
}

interface MakeDataSourceOptions {
	/**
	 * Reject the FIRST `dataSource.transaction(cb)` call with this
	 * value. The second call (if any) runs the callback normally.
	 * Use to drive the `withRetry` retry path on a transient 40001
	 * (set `.code = "40001"` on the Error to make `isPgError` match).
	 */
	throwErrorOnFirstAttempt?: Error;
	/**
	 * Reject EVERY `dataSource.transaction(cb)` call with this value.
	 * Use to assert non-retryable errors bubble up unchanged.
	 */
	throwErrorOnEveryAttempt?: Error;
}

/**
 * `DataSource` fake. `transaction(cb)` invokes `cb(manager)` where
 * `manager` is the `makeManager(rtRepo, userRepo)` above. Mirrors
 * the pattern in `projects.service.spec.ts` (`makeDataSourceWithTransaction`)
 * but is richer: it supports an optional per-attempt error so we
 * can exercise the `withRetry` retry path on a transient 40001.
 */
function makeDataSource(
	rtRepo: RefreshTokenRepoFake,
	userRepo: FakeUserRepo,
	opts: MakeDataSourceOptions = {},
): { dataSource: { transaction: jest.Mock } } {
	let count = 0;
	const transaction = jest.fn(
		async (cb: (m: unknown) => Promise<unknown>) => {
			count++;
			if (opts.throwErrorOnFirstAttempt && count === 1) {
				throw opts.throwErrorOnFirstAttempt;
			}
			if (opts.throwErrorOnEveryAttempt) {
				throw opts.throwErrorOnEveryAttempt;
			}
			return cb(makeManager(rtRepo, userRepo));
		},
	);
	return { dataSource: { transaction } };
}

async function buildModule(
	userRepo: FakeUserRepo,
	rtRepo: RefreshTokenRepoFake,
	dataSource?: { transaction: jest.Mock },
): Promise<{
	service: AuthService;
	jwt: JwtService;
	module: TestingModule;
	dataSource: { transaction: jest.Mock };
}> {
	const ds: { transaction: jest.Mock } =
		dataSource ?? makeDataSource(rtRepo, userRepo).dataSource;
	const module: TestingModule = await Test.createTestingModule({
		imports: [
			JwtModule.register({
				secret: "test-secret-32-chars-min-..................",
				signOptions: { expiresIn: "15m" },
			}),
		],
		providers: [
			AuthService,
			{ provide: getRepositoryToken(UserEntity), useValue: userRepo },
			{
				provide: getRepositoryToken(RefreshTokenEntity),
				useValue: rtRepo,
			},
			{ provide: DataSource, useValue: ds },
			{
				provide: ConfigService,
				useValue: {
					get: (key: string) => {
						if (key === "JWT_SECRET")
							return "test-secret-32-chars-min-..................";
						if (key === "JWT_EXPIRES_IN") return "15m";
						if (key === "JWT_REFRESH_SECRET")
							return "refresh-secret-32-chars-min-......";
						if (key === "JWT_REFRESH_EXPIRES_IN") return "2592000";
						return undefined;
					},
				},
			},
		],
	}).compile();
	const service = module.get(AuthService);
	const jwt = module.get(JwtService);
	return { service, jwt, module, dataSource: ds };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService.login", () => {
	it("happy path: returns accessToken + refreshToken and inserts a refresh_tokens row", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		const result = await service.login(TEST_EMAIL, TEST_PASSWORD);

		expect(result.accessToken).toEqual(expect.any(String));
		expect(result.refreshToken).toEqual(expect.any(String));
		expect(result.refreshExpiresInSeconds).toBe(2592000);
		expect(result.expiresIn).toBeGreaterThan(0);
		// sha256(refreshToken) was stored
		expect(rtRepo.insertCalls).toHaveLength(1);
		const stored = rtRepo.insertCalls[0];
		expect(stored.hashedToken).toBe(sha256(result.refreshToken));
		expect(stored.userId).toBe(FIXED_USER_ID);
		expect(stored.familyId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("unknown email: throws UnauthorizedException and never compares a real hash", async () => {
		const userRepo = makeUserRepo(null);
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		await expect(service.login("nobody@x.io", "anything")).rejects.toThrow(
			UnauthorizedException,
		);

		// No refresh row was inserted.
		expect(rtRepo.insertCalls).toHaveLength(0);
	});

	it("wrong password: throws UnauthorizedException", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		await expect(
			service.login(TEST_EMAIL, "wrong-password"),
		).rejects.toThrow(UnauthorizedException);
		expect(rtRepo.insertCalls).toHaveLength(0);
	});
});

describe("AuthService.refresh", () => {
	it("happy path: rotates family, revokes old row, sets replaced_by, returns new tokens", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		// First, login to obtain a refresh token.
		const loginResult = await service.login(TEST_EMAIL, TEST_PASSWORD);
		const oldToken = loginResult.refreshToken;
		const oldRowId = rtRepo.insertCalls[0]
			? `rt-1`
			: (rtRepo.rows.keys().next().value as string);

		// Then, refresh with the same cookie.
		const refreshResult = await service.refresh(oldToken);

		expect(refreshResult.accessToken).toEqual(expect.any(String));
		expect(refreshResult.refreshToken).toEqual(expect.any(String));
		expect(refreshResult.refreshToken).not.toBe(oldToken);
		expect(refreshResult.clearCookie).toBe(false);

		// The old row has been revoked; the new row shares the family id.
		const oldRow = rtRepo.rows.get(oldRowId);
		expect(oldRow?.revokedAt).toBeInstanceOf(Date);
		expect(oldRow?.replacedBy).toBe("rt-2");
		const newRow = rtRepo.rows.get("rt-2");
		expect(newRow?.familyId).toBe(oldRow?.familyId);
		expect(newRow?.revokedAt).toBeNull();
	});

	it("reuse-detected: presented row already revoked, revokes the whole family, returns 401", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		// Build a 3-row family: r1 (revoked), r2 (revoked replaced by r3), r3 (active)
		const familyId = "11111111-aaaa-bbbb-cccc-000000000001";
		rtRepo.rows.set("r1", {
			id: "r1",
			revokedAt: new Date(),
			replacedBy: "r2",
			familyId,
			userId: FIXED_USER_ID,
			expiresAt: new Date(Date.now() + 1000000),
			hashedToken: sha256("r1-plaintext"),
		});
		rtRepo.rows.set("r2", {
			id: "r2",
			revokedAt: new Date(),
			replacedBy: "r3",
			familyId,
			userId: FIXED_USER_ID,
			expiresAt: new Date(Date.now() + 1000000),
			hashedToken: sha256("r2-plaintext"),
		});
		rtRepo.rows.set("r3", {
			id: "r3",
			revokedAt: null,
			replacedBy: null,
			familyId,
			userId: FIXED_USER_ID,
			expiresAt: new Date(Date.now() + 1000000),
			hashedToken: sha256("r3-plaintext"),
		});

		await expect(service.refresh("r1-plaintext")).rejects.toThrow(
			UnauthorizedException,
		);

		// Every row in the family has been revoked.
		expect(rtRepo.rows.get("r1")?.revokedAt).toBeInstanceOf(Date);
		expect(rtRepo.rows.get("r2")?.revokedAt).toBeInstanceOf(Date);
		expect(rtRepo.rows.get("r3")?.revokedAt).toBeInstanceOf(Date);
		// No new row inserted.
		expect(rtRepo.insertCalls).toHaveLength(0);
	});

	it("missing cookie: throws UnauthorizedException, no DB mutation", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		await expect(service.refresh("")).rejects.toThrow(
			UnauthorizedException,
		);
		expect(rtRepo.updateCalls).toHaveLength(0);
		expect(rtRepo.insertCalls).toHaveLength(0);
	});

	it("expired cookie: throws UnauthorizedException, row unchanged, clearCookie signal", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		const familyId = "22222222-aaaa-bbbb-cccc-000000000002";
		rtRepo.rows.set("expired", {
			id: "expired",
			revokedAt: null,
			replacedBy: null,
			familyId,
			userId: FIXED_USER_ID,
			expiresAt: new Date(Date.now() - 1000),
			hashedToken: sha256("expired-plaintext"),
		});

		await expect(service.refresh("expired-plaintext")).rejects.toThrow(
			UnauthorizedException,
		);
		expect(rtRepo.rows.get("expired")?.revokedAt).toBeNull();
	});

	// --- atomicity + retry contract (auth-refresh-retry) ----------------

	it("dataSource.transaction is called exactly once on the happy path", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { dataSource: ds } = makeDataSource(rtRepo, userRepo);
		const { service } = await buildModule(userRepo, rtRepo, ds);

		const loginResult = await service.login(TEST_EMAIL, TEST_PASSWORD);
		const oldToken = loginResult.refreshToken;

		const result = await service.refresh(oldToken);

		// Caller saw the new tokens (proves the callback actually ran
		// and the in-memory rows map got the insert + the replaced_by
		// link + the user email lookup).
		expect(result.refreshToken).toEqual(expect.any(String));
		expect(result.refreshToken).not.toBe(oldToken);
		expect(result.clearCookie).toBe(false);
		expect(ds.transaction).toHaveBeenCalledTimes(1);
	});

	it("pre-guards (missing cookie, expired, reuse-detected) open zero transactions", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { dataSource: ds } = makeDataSource(rtRepo, userRepo);
		const { service } = await buildModule(userRepo, rtRepo, ds);

		// missing cookie: throws before any DB call.
		await expect(service.refresh("")).rejects.toThrow(
			UnauthorizedException,
		);
		expect(ds.transaction).not.toHaveBeenCalled();

		// expired cookie: presented row is past `expiresAt`, throws
		// before any write.
		const expiredFamilyId = "22222222-aaaa-bbbb-cccc-000000000002";
		rtRepo.rows.set("expired", {
			id: "expired",
			revokedAt: null,
			replacedBy: null,
			familyId: expiredFamilyId,
			userId: FIXED_USER_ID,
			expiresAt: new Date(Date.now() - 1000),
			hashedToken: sha256("expired-plaintext"),
		});
		await expect(service.refresh("expired-plaintext")).rejects.toThrow(
			UnauthorizedException,
		);
		expect(ds.transaction).not.toHaveBeenCalled();

		// reuse-detected: the family-wide update happens BEFORE the
		// transaction; the throw is OUTSIDE the transaction. No
		// transaction should have been opened, AND the family-wide
		// update DID happen (proves the pre-guard branch ran).
		const reuseFamilyId = "11111111-aaaa-bbbb-cccc-000000000001";
		rtRepo.rows.set("r1", {
			id: "r1",
			revokedAt: new Date(),
			replacedBy: null,
			familyId: reuseFamilyId,
			userId: FIXED_USER_ID,
			expiresAt: new Date(Date.now() + 1000000),
			hashedToken: sha256("r1-plaintext-tx-test"),
		});
		await expect(service.refresh("r1-plaintext-tx-test")).rejects.toThrow(
			UnauthorizedException,
		);
		expect(ds.transaction).not.toHaveBeenCalled();
		expect(rtRepo.updateCalls).toHaveLength(1);

		// Control assertion: a SUBSEQUENT happy-path call must open
		// exactly one transaction. This locks the combined contract
		// ("pre-guards skip the transaction AND the happy path opens
		// exactly one") and is the assertion that fails in RED (the
		// current code never opens a transaction). It also guards
		// against an over-eager refactor that opens transactions in
		// the pre-guards.
		const loginResult = await service.login(TEST_EMAIL, TEST_PASSWORD);
		const result = await service.refresh(loginResult.refreshToken);
		expect(result.refreshToken).not.toBe(loginResult.refreshToken);
		expect(ds.transaction).toHaveBeenCalledTimes(1);
	});

	it("withRetry retries a 40001 thrown inside the transaction and the caller sees the new tokens", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		// Real `QueryFailedError` instances carry the PG code on a `.code`
		// property of the underlying driver error. `withRetry`'s
		// `isPgError` check matches any object with a string `.code`.
		const pgErr = new Error("could not serialize access") as Error & {
			code: string;
		};
		pgErr.code = "40001";
		const { dataSource: ds } = makeDataSource(rtRepo, userRepo, {
			throwErrorOnFirstAttempt: pgErr,
		});
		const { service } = await buildModule(userRepo, rtRepo, ds);

		const loginResult = await service.login(TEST_EMAIL, TEST_PASSWORD);
		const oldToken = loginResult.refreshToken;

		const result = await service.refresh(oldToken);

		// Caller saw new tokens (proves the SECOND attempt ran the
		// callback to completion — the retry recovered from 40001).
		expect(result.refreshToken).toEqual(expect.any(String));
		expect(result.refreshToken).not.toBe(oldToken);
		expect(result.clearCookie).toBe(false);
		// The first attempt rejected; `withRetry` invoked the wrapped
		// function again, so `dataSource.transaction` saw 2 calls.
		expect(ds.transaction).toHaveBeenCalledTimes(2);
		// The second attempt's callback mutated the rows map.
		expect(rtRepo.rows.get("rt-2")).toBeDefined();
		expect(rtRepo.rows.get("rt-1")?.revokedAt).toBeInstanceOf(Date);
	});

	it("non-retryable error inside the transaction bubbles up unchanged", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const boom = new Error("boom");
		const { dataSource: ds } = makeDataSource(rtRepo, userRepo, {
			throwErrorOnEveryAttempt: boom,
		});
		const { service } = await buildModule(userRepo, rtRepo, ds);

		const loginResult = await service.login(TEST_EMAIL, TEST_PASSWORD);
		const oldToken = loginResult.refreshToken;

		// Non-PG error: `withRetry` does NOT retry; the same error
		// instance surfaces to the caller.
		await expect(service.refresh(oldToken)).rejects.toBe(boom);
		// One attempt only — no retry on non-retryable codes.
		expect(ds.transaction).toHaveBeenCalledTimes(1);
	});
});

describe("AuthService.logout", () => {
	it("valid cookie: revokes presented row only, returns clearCookie signal", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		// Pre-populate family: r1 (revoked), r2 (active)
		const familyId = "33333333-aaaa-bbbb-cccc-000000000003";
		rtRepo.rows.set("r1", {
			id: "r1",
			revokedAt: new Date(),
			replacedBy: "r2",
			familyId,
			userId: FIXED_USER_ID,
			expiresAt: new Date(Date.now() + 1000000),
			hashedToken: sha256("r1-logout"),
		});
		rtRepo.rows.set("r2", {
			id: "r2",
			revokedAt: null,
			replacedBy: null,
			familyId,
			userId: FIXED_USER_ID,
			expiresAt: new Date(Date.now() + 1000000),
			hashedToken: sha256("r2-logout"),
		});

		const result = await service.logout("r2-logout");
		expect(result.clearCookie).toBe(true);
		// r2 revoked, r1 left alone.
		expect(rtRepo.rows.get("r2")?.revokedAt).toBeInstanceOf(Date);
		// r1's revoked_at is still the original Date instance we created
		// (or anything that is not null and is the same value).
		expect(rtRepo.rows.get("r1")?.revokedAt).not.toBeNull();
	});

	it("missing cookie: throws UnauthorizedException, no DB mutation", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		await expect(service.logout("")).rejects.toThrow(UnauthorizedException);
		expect(rtRepo.updateCalls).toHaveLength(0);
	});
});

describe("AuthService.getProfile", () => {
	it("returns { id, email } from the bearer payload (no DB hit)", async () => {
		const userRepo = makeUserRepo({});
		const rtRepo = makeRefreshTokenRepo();
		const { service } = await buildModule(userRepo, rtRepo);

		const findOneCallsBefore = userRepo.findOne.mock.calls.length;
		const result = service.getProfile({
			id: FIXED_USER_ID,
			email: TEST_EMAIL,
		});
		expect(result).toEqual({ id: FIXED_USER_ID, email: TEST_EMAIL });
		expect(userRepo.findOne.mock.calls.length).toBe(findOneCallsBefore);
	});
});
