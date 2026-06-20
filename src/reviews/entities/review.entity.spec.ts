import { getMetadataArgsStorage } from "typeorm";
import { ReviewEntity } from "./review.entity";
import { ReviewCommentEntity } from "./review-comment.entity";

/**
 * Metadata spec for `ReviewEntity`. Mirrors the `project.entity.spec.ts`
 * pattern: read `getMetadataArgsStorage()` and assert on the column /
 * relation metadata. No DB needed.
 *
 * The spec covers the two scenarios in the reviews-domain spec:
 *   - "ReviewEntity columns match the database schema"
 *   - "ReviewEntity has no subject polymorphism"
 */
describe("ReviewEntity metadata", () => {
	const metadata = getMetadataArgsStorage();
	const reviewTable = metadata.tables.find((t) => t.target === ReviewEntity);
	const columnNames = reviewTable
		? metadata.columns
				.filter((c) => c.target === ReviewEntity)
				.map((c) => c.propertyName)
		: [];
	const columnsByName = new Map(
		metadata.columns
			.filter((c) => c.target === ReviewEntity)
			.map((c) => [c.propertyName, c]),
	);

	it("registers the entity against the 'reviews' table", () => {
		expect(reviewTable).toBeDefined();
		expect(reviewTable?.name).toBe("reviews");
	});

	it("declares id, authorName, authorRole, content, rating, isApproved, createdAt columns", () => {
		// Mirrors the DBML columns at openspec/specs/database-schema.dbml
		// lines 39-47. No updatedAt (the reviews table has no updated_at
		// per the DBML).
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"id",
				"authorName",
				"authorRole",
				"content",
				"rating",
				"isApproved",
				"createdAt",
			]),
		);
	});

	it("uses uuid primary key generation for id", () => {
		const idCol = columnsByName.get("id");
		expect(idCol).toBeDefined();
		expect(idCol?.options.primary).toBe(true);
		expect(idCol?.options.type).toBe("uuid");
	});

	it("authorName has a DB default of 'Anónimo' (the SQL function literal)", () => {
		const authorNameCol = columnsByName.get("authorName");
		expect(authorNameCol).toBeDefined();
		// TypeORM stores the SQL function default as a function reference;
		// calling it returns the literal `'Anónimo'` that the DB inserts.
		const defaultFn = authorNameCol?.options.default as
			| (() => string)
			| undefined;
		expect(typeof defaultFn).toBe("function");
		expect(defaultFn?.()).toBe("'Anónimo'");
	});

	it("authorRole is nullable", () => {
		const authorRoleCol = columnsByName.get("authorRole");
		expect(authorRoleCol).toBeDefined();
		expect(authorRoleCol?.options.nullable).toBe(true);
	});

	it("content is NOT NULL (required)", () => {
		const contentCol = columnsByName.get("content");
		expect(contentCol).toBeDefined();
		expect(contentCol?.options.nullable).not.toBe(true);
	});

	it("isApproved has a default of false", () => {
		const isApprovedCol = columnsByName.get("isApproved");
		expect(isApprovedCol).toBeDefined();
		expect(isApprovedCol?.options.default).toBe(false);
	});

	it("maps authorName / authorRole / isApproved / createdAt to snake_case column names", () => {
		expect(columnsByName.get("authorName")?.options.name).toBe(
			"author_name",
		);
		expect(columnsByName.get("authorRole")?.options.name).toBe(
			"author_role",
		);
		expect(columnsByName.get("isApproved")?.options.name).toBe(
			"is_approved",
		);
		expect(columnsByName.get("createdAt")?.options.name).toBe("created_at");
	});

	it("rating is an integer (NOT NULL) — no DB CHECK, per ADR-9 (DTO only)", () => {
		const ratingCol = columnsByName.get("rating");
		expect(ratingCol).toBeDefined();
		expect(ratingCol?.options.type).toBe("integer");
		expect(ratingCol?.options.nullable).not.toBe(true);
	});

	// --- "no subject polymorphism" (locked #1, ADR-1) -----------------

	it("has NO projectId / ownerUserId / subjectType column (locked #1, ADR-1)", () => {
		expect(columnNames).not.toContain("projectId");
		expect(columnNames).not.toContain("ownerUserId");
		expect(columnNames).not.toContain("subjectType");
	});

	it("has NO ManyToOne to ProjectEntity (no FK to projects)", () => {
		const relations = metadata.relations.filter(
			(r) => r.target === ReviewEntity,
		);
		const manyToOne = relations.find(
			(r) => r.relationType === "many-to-one",
		);
		expect(manyToOne).toBeUndefined();
	});

	it("has NO ManyToOne to UserEntity (no FK to users)", () => {
		// Defensive — guard against a future contributor adding a
		// `reviewerUserId` column. The spec scenario
		// "ReviewEntity has no subject polymorphism" is the lock.
		const relations = metadata.relations.filter(
			(r) => r.target === ReviewEntity,
		);
		const toUser = relations.find((r) => {
			if (r.relationType !== "many-to-one") return false;
			const type = r.type as unknown;
			if (typeof type === "function") {
				return (type as () => { name: string })().name === "UserEntity";
			}
			if (type && typeof type === "object" && "name" in type) {
				return (type as { name: string }).name === "UserEntity";
			}
			return false;
		});
		expect(toUser).toBeUndefined();
	});

	it("declares a one-to-many relation to ReviewCommentEntity via the `comments` inverse", () => {
		// The child side declares `@ManyToOne(() => ReviewEntity, (r) =>
		// r.comments)`. The parent side is the `@OneToMany` on
		// ReviewEntity. Asserting on the parent side locks the
		// relation in both entities.
		const relations = metadata.relations.filter(
			(r) => r.target === ReviewEntity,
		);
		const oneToMany = relations.find(
			(r) => r.relationType === "one-to-many",
		);
		expect(oneToMany).toBeDefined();
		const resolvedType =
			typeof oneToMany?.type === "function"
				? (oneToMany.type as () => typeof ReviewCommentEntity)()
				: oneToMany?.type;
		expect(resolvedType).toBe(ReviewCommentEntity);
	});
});
