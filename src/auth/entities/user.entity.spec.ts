import { getMetadataArgsStorage } from "typeorm";
import { UserEntity } from "./user.entity";

describe("UserEntity metadata", () => {
	const metadata = getMetadataArgsStorage();
	const userTable = metadata.tables.find((t) => t.target === UserEntity);
	const columnNames = userTable
		? metadata.columns
				.filter((c) => c.target === UserEntity)
				.map((c) => c.propertyName)
		: [];
	const columnsByName = new Map(
		metadata.columns
			.filter((c) => c.target === UserEntity)
			.map((c) => [c.propertyName, c]),
	);

	it("registers the entity against the 'users' table", () => {
		expect(userTable).toBeDefined();
		expect(userTable?.name).toBe("users");
	});

	it("declares id, email, password, createdAt, updatedAt columns", () => {
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"id",
				"email",
				"password",
				"createdAt",
				"updatedAt",
			]),
		);
	});

	it("marks email as unique (database-schema spec)", () => {
		const emailCol = columnsByName.get("email");
		expect(emailCol).toBeDefined();
		expect(emailCol?.options.unique).toBe(true);
	});

	it("marks password with select:false so the hash never leaks in default selects", () => {
		const passwordCol = columnsByName.get("password");
		expect(passwordCol).toBeDefined();
		expect(passwordCol?.options.select).toBe(false);
	});

	it("uses uuid primary key generation for id", () => {
		const idCol = columnsByName.get("id");
		expect(idCol).toBeDefined();
		expect(idCol?.options.primary).toBe(true);
		expect(idCol?.options.type).toBe("uuid");
	});
});
