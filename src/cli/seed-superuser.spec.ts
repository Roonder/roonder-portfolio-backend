import * as bcrypt from "bcrypt";
import { Repository } from "typeorm";
import { UserEntity } from "../auth/entities/user.entity";
import { seedSuperuser } from "./seed-superuser";

// NOTE: keep in sync with the production Repository<T> methods this fake is asked for.
function makeFakeUserRepo(existing: { id: string; email: string } | null): {
	repo: Pick<Repository<UserEntity>, "findOne" | "create" | "save" | "update">;
	createCalls: Array<{ email: string; password: string }>;
	saveCalls: Array<{ email: string; password: string }>;
	updateCalls: Array<{ id: string; partial: { password: string } }>;
} {
	const createCalls: Array<{ email: string; password: string }> = [];
	const saveCalls: Array<{ email: string; password: string }> = [];
	const updateCalls: Array<{ id: string; partial: { password: string } }> =
		[];
	const repo = {
		findOne: jest.fn().mockResolvedValue(existing),
		create: jest
			.fn()
			.mockImplementation((data: { email: string; password: string }) => {
				createCalls.push(data);
				return data;
			}),
		save: jest
			.fn()
			.mockImplementation((data: { email: string; password: string }) => {
				saveCalls.push(data);
				return Promise.resolve({ id: "saved-1", ...data });
			}),
		update: jest
			.fn()
			.mockImplementation((id: string, partial: { password: string }) => {
				updateCalls.push({ id, partial });
				return Promise.resolve({ affected: 1 });
			}),
	} as unknown as Pick<
		Repository<UserEntity>,
		"findOne" | "create" | "save" | "update"
	>;
	return { repo, createCalls, saveCalls, updateCalls };
}

const VALID_EMAIL = "admin@test.io";
const VALID_PASSWORD = "correct-password";

describe("seedSuperuser (pure function)", () => {
	it("(1) happy create: calls userRepo.create + userRepo.save with the bcrypt-hashed password", async () => {
		const { repo, createCalls, saveCalls, updateCalls } =
			makeFakeUserRepo(null);

		await seedSuperuser(
			VALID_EMAIL,
			VALID_PASSWORD,
			repo as unknown as Repository<UserEntity>,
		);

		expect(repo.findOne).toHaveBeenCalledWith({
			where: { email: VALID_EMAIL },
		});
		expect(createCalls).toHaveLength(1);
		expect(saveCalls).toHaveLength(1);
		expect(updateCalls).toHaveLength(0);
		expect(createCalls[0].email).toBe(VALID_EMAIL);
		// The persisted password is a bcrypt hash, NOT the plaintext.
		expect(createCalls[0].password).toMatch(/^\$2[aby]\$/);
		expect(createCalls[0].password).not.toBe(VALID_PASSWORD);
		// save is called with what create returned (same reference).
		expect(saveCalls[0]).toEqual(createCalls[0]);
	});

	it("(2) happy update: calls userRepo.update with the bcrypt-hashed password (no create/save)", async () => {
		const existing = { id: "user-123", email: VALID_EMAIL };
		const { repo, createCalls, saveCalls, updateCalls } =
			makeFakeUserRepo(existing);

		await seedSuperuser(
			VALID_EMAIL,
			VALID_PASSWORD,
			repo as unknown as Repository<UserEntity>,
		);

		expect(repo.findOne).toHaveBeenCalledWith({
			where: { email: VALID_EMAIL },
		});
		expect(createCalls).toHaveLength(0);
		expect(saveCalls).toHaveLength(0);
		expect(updateCalls).toHaveLength(1);
		expect(updateCalls[0].id).toBe("user-123");
		expect(updateCalls[0].partial.password).toMatch(/^\$2[aby]\$/);
		expect(updateCalls[0].partial.password).not.toBe(VALID_PASSWORD);
	});

	it("(3) bcrypt.compare(SUPERUSER_PASSWORD, persistedHash) is true after a re-run", async () => {
		// First run creates the row. The fake's `create`/`save` is what the
		// service will use to persist; we capture the hashed password and
		// assert bcrypt.compare(plain, hash) is true.
		const { repo, createCalls } = makeFakeUserRepo(null);

		await seedSuperuser(
			VALID_EMAIL,
			VALID_PASSWORD,
			repo as unknown as Repository<UserEntity>,
		);

		const storedHash = createCalls[0].password;
		// Asserts the hash actually validates against the original plaintext.
		await expect(bcrypt.compare(VALID_PASSWORD, storedHash)).resolves.toBe(
			true,
		);
		// And does NOT validate against an unrelated plaintext.
		await expect(
			bcrypt.compare("wrong-password", storedHash),
		).resolves.toBe(false);
	});

	it("(4) missing SUPERUSER_EMAIL: throws an Error naming 'SUPERUSER_EMAIL' BEFORE any repo call", async () => {
		const { repo, createCalls, saveCalls, updateCalls } =
			makeFakeUserRepo(null);

		await expect(
			seedSuperuser(
				"",
				VALID_PASSWORD,
				repo as unknown as Repository<UserEntity>,
			),
		).rejects.toThrow(/SUPERUSER_EMAIL/);

		// No repository method was invoked (the validation happens before
		// any DB work — this is the "fail fast" contract from ADR-7).
		expect(repo.findOne).not.toHaveBeenCalled();
		expect(createCalls).toHaveLength(0);
		expect(saveCalls).toHaveLength(0);
		expect(updateCalls).toHaveLength(0);
	});

	it("(5) missing/short SUPERUSER_PASSWORD: throws an Error naming 'SUPERUSER_PASSWORD' BEFORE any repo call", async () => {
		const { repo, createCalls, saveCalls, updateCalls } =
			makeFakeUserRepo(null);

		// empty string
		await expect(
			seedSuperuser(
				VALID_EMAIL,
				"",
				repo as unknown as Repository<UserEntity>,
			),
		).rejects.toThrow(/SUPERUSER_PASSWORD/);
		// shorter than 8 characters
		await expect(
			seedSuperuser(
				VALID_EMAIL,
				"short",
				repo as unknown as Repository<UserEntity>,
			),
		).rejects.toThrow(/SUPERUSER_PASSWORD/);

		// No repository method was invoked.
		expect(repo.findOne).not.toHaveBeenCalled();
		expect(createCalls).toHaveLength(0);
		expect(saveCalls).toHaveLength(0);
		expect(updateCalls).toHaveLength(0);
	});
});
