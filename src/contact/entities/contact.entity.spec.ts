import { getMetadataArgsStorage } from "typeorm";
import { ContactEntity } from "./contact.entity";

/**
 * Metadata spec for `ContactEntity`. Mirrors the
 * `src/reviews/entities/review.entity.spec.ts` pattern: read
 * `getMetadataArgsStorage()` and assert on the column metadata. No
 * DB needed.
 *
 * The 8 columns mirror the post-migration DBML shape (the destructive
 * `email_sent_log` column is GONE; `updated_at` is ADDED). The
 * spec is the canonical proof of the schema delta at the entity
 * layer.
 */
describe("ContactEntity metadata", () => {
	const metadata = getMetadataArgsStorage();
	const contactTable = metadata.tables.find(
		(t) => t.target === ContactEntity,
	);
	const columnNames = contactTable
		? metadata.columns
				.filter((c) => c.target === ContactEntity)
				.map((c) => c.propertyName)
		: [];
	const columnsByName = new Map(
		metadata.columns
			.filter((c) => c.target === ContactEntity)
			.map((c) => [c.propertyName, c]),
	);

	it("registers the entity against the 'contacts' table", () => {
		expect(contactTable).toBeDefined();
		expect(contactTable?.name).toBe("contacts");
	});

	it("declares exactly the 8 columns: id, name, email, subject, message, status, createdAt, updatedAt", () => {
		// Mirrors the post-migration DBML shape: 8 columns total.
		// No `emailSentLog` (the destructive change). `updatedAt` is
		// present (the additive change).
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"id",
				"name",
				"email",
				"subject",
				"message",
				"status",
				"createdAt",
				"updatedAt",
			]),
		);
		expect(columnNames).toHaveLength(8);
	});

	it("id uses uuid primary key generation", () => {
		const idCol = columnsByName.get("id");
		expect(idCol).toBeDefined();
		expect(idCol?.options.primary).toBe(true);
		expect(idCol?.options.type).toBe("uuid");
	});

	it("status has a default of 'pending' (the public submission contract)", () => {
		const statusCol = columnsByName.get("status");
		expect(statusCol).toBeDefined();
		// The default is a SQL function literal `() => "'pending'"`
		// so the DB-side default is the literal `'pending'`, not a
		// JS string. Calling the function returns the SQL literal
		// (with the surrounding single quotes — the DB strips them).
		const defaultFn = statusCol?.options.default as
			| (() => string)
			| undefined;
		expect(typeof defaultFn).toBe("function");
		expect(defaultFn?.()).toBe("'pending'");
	});

	it("createdAt is a @CreateDateColumn (created_at)", () => {
		const createdAtCol = columnsByName.get("createdAt");
		expect(createdAtCol).toBeDefined();
		// @CreateDateColumn stores the column as a CreateDateColumn
		// metadata entry; the options include `name: "created_at"`.
		expect(createdAtCol?.options.name).toBe("created_at");
	});

	it("updatedAt is a @UpdateDateColumn (updated_at) — the additive DBML change", () => {
		const updatedAtCol = columnsByName.get("updatedAt");
		expect(updatedAtCol).toBeDefined();
		// The UpdateDateColumn metadata sets `name: "updated_at"`.
		expect(updatedAtCol?.options.name).toBe("updated_at");
	});

	it("maps snake_case for createdAt + updatedAt (the timestamps)", () => {
		// The other 6 columns (name, subject, email, message, status)
		// are also snake_case via the explicit `name:` option OR
		// because they happen to be single-word identifiers. The
		// important assertion is the two timestamp columns.
		expect(columnsByName.get("createdAt")?.options.name).toBe("created_at");
		expect(columnsByName.get("updatedAt")?.options.name).toBe("updated_at");
	});

	it("does NOT declare an emailSentLog column (the destructive DBML change is reflected in the entity)", () => {
		// The `email_sent_log` boolean was dropped in the migration
		// (proposal §6 #2, user-locked). The entity MUST NOT carry
		// an `emailSentLog` property — the spec is the canonical
		// proof. A future contributor that re-introduces the
		// property (e.g. via a stale scaffold) will trip this test.
		expect(columnNames).not.toContain("emailSentLog");
		expect(columnsByName.has("emailSentLog")).toBe(false);
	});

	it("subject is nullable (matches the DBML — `subject varchar` with no `not null`)", () => {
		// The DBML `subject varchar` (no NOT NULL) means the
		// application accepts a missing subject at insert time.
		// Note: the spec scenario "Form fields" requires the public
		// POST to send a subject, so the DTO layer makes it required
		// at the API surface. The entity allows null for forward-
		// compat (e.g. an admin-only direct insert).
		const subjectCol = columnsByName.get("subject");
		expect(subjectCol).toBeDefined();
		expect(subjectCol?.options.nullable).toBe(true);
	});

	it("message is NOT NULL (required at the DB level)", () => {
		const messageCol = columnsByName.get("message");
		expect(messageCol).toBeDefined();
		expect(messageCol?.options.nullable).not.toBe(true);
	});
});
