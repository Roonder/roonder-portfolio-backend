import { getMetadataArgsStorage } from "typeorm";
import { ReviewEntity } from "./review.entity";
import { ReviewCommentEntity } from "./review-comment.entity";

/**
 * Metadata spec for `ReviewCommentEntity`. Mirrors the
 * `project-url.entity.spec.ts` pattern: read
 * `getMetadataArgsStorage()` and assert on the column / relation
 * metadata.
 *
 * The spec covers the two scenarios in the reviews-domain spec:
 *   - "ReviewCommentEntity columns match the schema plus isApproved"
 *   - "ReviewCommentEntity FK is ON DELETE CASCADE"
 */
describe("ReviewCommentEntity metadata", () => {
	const metadata = getMetadataArgsStorage();
	const commentTable = metadata.tables.find(
		(t) => t.target === ReviewCommentEntity,
	);
	const columnNames = commentTable
		? metadata.columns
				.filter((c) => c.target === ReviewCommentEntity)
				.map((c) => c.propertyName)
		: [];
	const columnsByName = new Map(
		metadata.columns
			.filter((c) => c.target === ReviewCommentEntity)
			.map((c) => [c.propertyName, c]),
	);

	it("registers the entity against the 'review_comments' table", () => {
		expect(commentTable).toBeDefined();
		expect(commentTable?.name).toBe("review_comments");
	});

	it("declares id, reviewId, authorName, content, isApproved, createdAt columns", () => {
		// Mirrors the DBML columns at openspec/specs/database-schema.dbml
		// lines 49-55 PLUS the `is_approved` column this change adds
		// (locked #3, ADR-7). No updatedAt.
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"id",
				"reviewId",
				"authorName",
				"content",
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
		const defaultFn = authorNameCol?.options.default as
			| (() => string)
			| undefined;
		expect(typeof defaultFn).toBe("function");
		expect(defaultFn?.()).toBe("'Anónimo'");
	});

	it("content is NOT NULL (required)", () => {
		const contentCol = columnsByName.get("content");
		expect(contentCol).toBeDefined();
		expect(contentCol?.options.nullable).not.toBe(true);
	});

	it("isApproved has a default of false (locked #3, ADR-7)", () => {
		const isApprovedCol = columnsByName.get("isApproved");
		expect(isApprovedCol).toBeDefined();
		expect(isApprovedCol?.options.default).toBe(false);
	});

	it("maps reviewId / authorName / isApproved / createdAt to snake_case column names", () => {
		expect(columnsByName.get("reviewId")?.options.name).toBe("review_id");
		expect(columnsByName.get("authorName")?.options.name).toBe(
			"author_name",
		);
		expect(columnsByName.get("isApproved")?.options.name).toBe(
			"is_approved",
		);
		expect(columnsByName.get("createdAt")?.options.name).toBe(
			"created_at",
		);
	});

	it("declares a @JoinColumn on reviewId named 'review_id'", () => {
		// The join column wires the FK to `review_id` in the DB.
		const joins = metadata.joinColumns.filter(
			(j) => j.target === ReviewCommentEntity,
		);
		expect(joins.length).toBe(1);
		expect(joins[0]?.name).toBe("review_id");
	});

	it("declares a @ManyToOne to ReviewEntity with onDelete: CASCADE (locked #4, ADR-8)", () => {
		// FK from review_comments.review_id → reviews.id with
		// `ON DELETE CASCADE`. Asserting on the relation metadata
		// is the canonical way to assert the cascade intent.
		const relations = metadata.relations.filter(
			(r) => r.target === ReviewCommentEntity,
		);
		const manyToOne = relations.find(
			(r) => r.relationType === "many-to-one",
		);
		expect(manyToOne).toBeDefined();
		const resolvedType =
			typeof manyToOne?.type === "function"
				? (manyToOne.type as () => typeof ReviewEntity)()
				: manyToOne?.type;
		expect(resolvedType).toBe(ReviewEntity);
		const onDelete = (manyToOne as { options?: { onDelete?: string } })
			?.options?.onDelete;
		expect(onDelete).toBe("CASCADE");
	});
});
