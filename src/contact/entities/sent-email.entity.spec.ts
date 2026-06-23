import { getMetadataArgsStorage } from "typeorm";
import { SentEmailEntity } from "./sent-email.entity";

/**
 * Metadata spec for `SentEmailEntity`. Mirrors the
 * `src/reviews/entities/review.entity.spec.ts` pattern. No DB needed.
 *
 * The 10 columns mirror the spec table at
 * `openspec/changes/domain-contact/specs/database/spec.md`
 * (the `sent_emails` table is the audit trail that replaces the
 * dropped `email_sent_log` boolean on `contacts`).
 *
 * The 2 native Postgres enums (`sent_emails_status_enum`,
 * `sent_emails_kind_enum`) MUST be declared with
 * `@Column({ type: "enum", enum: [...] })` so the migration's
 * `CREATE TYPE` matches. `resendId` and `errorMessage` are
 * nullable (resend failures have no `resend_id`; successful sends
 * have no `error_message`).
 */
describe("SentEmailEntity metadata", () => {
	const metadata = getMetadataArgsStorage();
	const sentEmailsTable = metadata.tables.find(
		(t) => t.target === SentEmailEntity,
	);
	const columnNames = sentEmailsTable
		? metadata.columns
				.filter((c) => c.target === SentEmailEntity)
				.map((c) => c.propertyName)
		: [];
	const columnsByName = new Map(
		metadata.columns
			.filter((c) => c.target === SentEmailEntity)
			.map((c) => [c.propertyName, c]),
	);

	it("registers the entity against the 'sent_emails' table", () => {
		expect(sentEmailsTable).toBeDefined();
		expect(sentEmailsTable?.name).toBe("sent_emails");
	});

	it("declares exactly the 10 columns: id, subject, from, to, resendId, status, kind, errorMessage, createdAt, updatedAt", () => {
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"id",
				"subject",
				"from",
				"to",
				"resendId",
				"status",
				"kind",
				"errorMessage",
				"createdAt",
				"updatedAt",
			]),
		);
		expect(columnNames).toHaveLength(10);
	});

	it("status uses the sent_emails_status_enum native enum (TypeORM enum: { accepted, failed })", () => {
		const statusCol = columnsByName.get("status");
		expect(statusCol).toBeDefined();
		// TypeORM stores the enum values as an array under
		// `options.enum`; the migration's `CREATE TYPE` MUST match.
		const enumValues = statusCol?.options.enum as string[] | undefined;
		expect(enumValues).toEqual(
			expect.arrayContaining(["accepted", "failed"]),
		);
		// The native enum column type — NOT plain varchar.
		expect(statusCol?.options.type).toBe("enum");
	});

	it("kind uses the sent_emails_kind_enum native enum (TypeORM enum: { contact_notification, contact_auto_reply })", () => {
		const kindCol = columnsByName.get("kind");
		expect(kindCol).toBeDefined();
		const enumValues = kindCol?.options.enum as string[] | undefined;
		expect(enumValues).toEqual(
			expect.arrayContaining([
				"contact_notification",
				"contact_auto_reply",
			]),
		);
		expect(kindCol?.options.type).toBe("enum");
	});

	it("resendId is nullable (failed sends have no Resend-assigned id)", () => {
		const resendIdCol = columnsByName.get("resendId");
		expect(resendIdCol).toBeDefined();
		expect(resendIdCol?.options.nullable).toBe(true);
	});

	it("errorMessage is nullable (successful sends have no error)", () => {
		const errorMessageCol = columnsByName.get("errorMessage");
		expect(errorMessageCol).toBeDefined();
		expect(errorMessageCol?.options.nullable).toBe(true);
	});

	it("maps snake_case for resendId, errorMessage, createdAt, updatedAt", () => {
		expect(columnsByName.get("resendId")?.options.name).toBe("resend_id");
		expect(columnsByName.get("errorMessage")?.options.name).toBe(
			"error_message",
		);
		expect(columnsByName.get("createdAt")?.options.name).toBe("created_at");
		expect(columnsByName.get("updatedAt")?.options.name).toBe("updated_at");
	});

	it("does NOT declare a foreign key to contacts (the table is audit-only, not relationally linked)", () => {
		// The spec scenario "New `sent_emails` table" leaves room for
		// a future FK to `contacts` if the operator wants to JOIN
		// the audit trail to the contact rows. For now, the table
		// is intentionally FK-free: a contact row can be hard-
		// deleted (admin route) without cascading the audit trail,
		// and the audit trail can be read independently of the
		// contact rows (e.g. SELECT * FROM sent_emails WHERE
		// status = 'failed' to audit the Resend error rate).
		const relations = metadata.relations.filter(
			(r) => r.target === SentEmailEntity,
		);
		const manyToOne = relations.find(
			(r) => r.relationType === "many-to-one",
		);
		expect(manyToOne).toBeUndefined();
	});
});
