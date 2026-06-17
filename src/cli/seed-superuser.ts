import * as bcrypt from "bcrypt";
import type { Repository } from "typeorm";
import { AppDataSource } from "../data-source";
import { UserEntity } from "../auth/entities/user.entity";

/**
 * Idempotent upsert of the single superuser row. Pure function — no
 * I/O, no process.exit, no console output. The I/O wrapper in `main()`
 * owns the DataSource lifecycle and CLI plumbing; this function is the
 * testable seam.
 *
 * @param email     Plaintext email (already validated by the caller
 *                  against the Joi schema — we still guard against
 *                  empty as a defense in depth).
 * @param password  Plaintext password (must be at least 8 chars).
 * @param userRepo  TypeORM repository for `UserEntity` — injected
 *                  explicitly so the unit test can pass a Jest fake.
 * @throws Error    If `email` is empty or `password` is shorter than
 *                  8 characters. The validation runs BEFORE any
 *                  repository call so a bad config never opens a DB
 *                  connection (per design ADR-7).
 */
export async function seedSuperuser(
	email: string,
	password: string,
	userRepo: Repository<UserEntity>,
): Promise<void> {
	if (!email) {
		throw new Error("SUPERUSER_EMAIL is required");
	}
	if (!password || password.length < 8) {
		throw new Error("SUPERUSER_PASSWORD is required (min 8 chars)");
	}
	const hashed = await bcrypt.hash(password, 12);
	const existing = await userRepo.findOne({ where: { email } });
	if (existing) {
		await userRepo.update(existing.id, { password: hashed });
	} else {
		await userRepo.save(userRepo.create({ email, password: hashed }));
	}
}

/**
 * I/O wrapper. Reads `SUPERUSER_EMAIL` / `SUPERUSER_PASSWORD` from
 * the process environment, initializes the shared `AppDataSource`
 * (so the entity list / connection config match the runtime Nest
 * app — see `src/data-source.ts`), invokes the pure `seedSuperuser`,
 * and tears the connection down. Exits non-zero with the validation
 * error message on bad config — no DB connection is opened in that
 * path.
 */
async function main(): Promise<void> {
	const email = process.env.SUPERUSER_EMAIL;
	const password = process.env.SUPERUSER_PASSWORD;
	try {
		await AppDataSource.initialize();
		const repo = AppDataSource.getRepository(UserEntity);
		await seedSuperuser(email!, password!, repo);
		await AppDataSource.destroy();
		console.log(`\u2713 Superuser ${email} seeded.`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(message);
		process.exit(1);
	}
}

if (require.main === module) {
	void main();
}
