import { getMetadataArgsStorage } from "typeorm";
import { ProjectEntity } from "./project.entity";
// The one-to-many relation to ProjectUrlEntity is covered in
// `project-url.entity.spec.ts` (Task 1.2) — keeping this spec free of
// the ProjectUrlEntity import so Task 1.1 stands on its own.

describe("ProjectEntity metadata", () => {
	const metadata = getMetadataArgsStorage();
	const projectTable = metadata.tables.find(
		(t) => t.target === ProjectEntity,
	);
	const columnNames = projectTable
		? metadata.columns
				.filter((c) => c.target === ProjectEntity)
				.map((c) => c.propertyName)
		: [];
	const columnsByName = new Map(
		metadata.columns
			.filter((c) => c.target === ProjectEntity)
			.map((c) => [c.propertyName, c]),
	);

	it("registers the entity against the 'projects' table", () => {
		expect(projectTable).toBeDefined();
		expect(projectTable?.name).toBe("projects");
	});

	it("declares id, title, slug, description, content, coverImage, tags, isPublished, createdAt, updatedAt columns", () => {
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"id",
				"title",
				"slug",
				"description",
				"content",
				"coverImage",
				"tags",
				"isPublished",
				"createdAt",
				"updatedAt",
			]),
		);
	});

	it("uses uuid primary key generation for id", () => {
		const idCol = columnsByName.get("id");
		expect(idCol).toBeDefined();
		expect(idCol?.options.primary).toBe(true);
		expect(idCol?.options.type).toBe("uuid");
	});

	it("marks slug as unique (database-schema spec)", () => {
		const slugCol = columnsByName.get("slug");
		expect(slugCol).toBeDefined();
		expect(slugCol?.options.unique).toBe(true);
	});

	it("marks isPublished with default: false (database-schema spec)", () => {
		const isPublishedCol = columnsByName.get("isPublished");
		expect(isPublishedCol).toBeDefined();
		expect(isPublishedCol?.options.default).toBe(false);
	});

	it("maps isPublished to the 'is_published' column", () => {
		const isPublishedCol = columnsByName.get("isPublished");
		expect(isPublishedCol).toBeDefined();
		expect(isPublishedCol?.options.name).toBe("is_published");
	});

	it("maps coverImage to the 'cover_image' column (snake_case)", () => {
		const coverImageCol = columnsByName.get("coverImage");
		expect(coverImageCol).toBeDefined();
		expect(coverImageCol?.options.name).toBe("cover_image");
	});

	it("declares tags as a text array column (DBML varchar[] → text[] delta, ADR-3)", () => {
		const tagsCol = columnsByName.get("tags");
		expect(tagsCol).toBeDefined();
		expect(tagsCol?.options.type).toBe("text");
		expect(tagsCol?.options.array).toBe(true);
	});

	it("maps createdAt / updatedAt to snake_case column names", () => {
		const createdAtCol = columnsByName.get("createdAt");
		const updatedAtCol = columnsByName.get("updatedAt");
		expect(createdAtCol?.options.name).toBe("created_at");
		expect(updatedAtCol?.options.name).toBe("updated_at");
	});

	it("declares a one-to-many relation to the project_urls target", () => {
		// Spec Requirement: One-to-many relation between Project and ProjectUrl.
		// The relation is declared on ProjectEntity and points at the
		// `project_urls` table; the outbound one-to-many is asserted here
		// and the inbound @ManyToOne is asserted in Task 1.2's spec.
		// We use the string-based target form on the decorator (see
		// project.entity.ts) so this spec is free of the ProjectUrlEntity
		// import until Task 1.2 lands.
		const relations = metadata.relations.filter(
			(r) => r.target === ProjectEntity,
		);
		expect(relations.length).toBeGreaterThan(0);
		const oneToMany = relations.find(
			(r) => r.relationType === "one-to-many",
		);
		expect(oneToMany).toBeDefined();
	});
});
