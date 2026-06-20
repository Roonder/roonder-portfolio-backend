import { getMetadataArgsStorage } from "typeorm";
import { ProjectUrlEntity } from "./project-url.entity";
import { ProjectEntity } from "./project.entity";

describe("ProjectUrlEntity metadata", () => {
	const metadata = getMetadataArgsStorage();
	const urlTable = metadata.tables.find((t) => t.target === ProjectUrlEntity);
	const columnNames = urlTable
		? metadata.columns
				.filter((c) => c.target === ProjectUrlEntity)
				.map((c) => c.propertyName)
		: [];
	const columnsByName = new Map(
		metadata.columns
			.filter((c) => c.target === ProjectUrlEntity)
			.map((c) => [c.propertyName, c]),
	);

	it("registers the entity against the 'project_urls' table", () => {
		expect(urlTable).toBeDefined();
		expect(urlTable?.name).toBe("project_urls");
	});

	it("declares id, projectId, title, url, createdAt, updatedAt columns", () => {
		expect(columnNames).toEqual(
			expect.arrayContaining([
				"id",
				"projectId",
				"title",
				"url",
				"createdAt",
				"updatedAt",
			]),
		);
	});

	it("maps projectId to the 'project_id' column (snake_case)", () => {
		const projectIdCol = columnsByName.get("projectId");
		expect(projectIdCol).toBeDefined();
		expect(projectIdCol?.options.name).toBe("project_id");
	});

	it("uses uuid primary key generation for id", () => {
		const idCol = columnsByName.get("id");
		expect(idCol).toBeDefined();
		expect(idCol?.options.primary).toBe(true);
		expect(idCol?.options.type).toBe("uuid");
	});

	it("declares a @JoinColumn on projectId named 'project_id'", () => {
		// The join column wires the FK to `project_id` in the DB.
		const joins = metadata.joinColumns.filter(
			(j) => j.target === ProjectUrlEntity,
		);
		expect(joins.length).toBe(1);
		expect(joins[0]?.name).toBe("project_id");
	});

	it("declares a @ManyToOne to ProjectEntity with onDelete: CASCADE", () => {
		// FK from project_urls.project_id → projects.id with
		// `ON DELETE CASCADE` (per spec §Requirement: Project and
		// ProjectUrl Entities, ADR-1). We assert on the
		// relation metadata: the target is ProjectEntity, the
		// relationType is many-to-one, and the relation's options
		// include `onDelete: 'CASCADE'`.
		const relations = metadata.relations.filter(
			(r) => r.target === ProjectUrlEntity,
		);
		const manyToOne = relations.find(
			(r) => r.relationType === "many-to-one",
		);
		expect(manyToOne).toBeDefined();
		// `relation.type` is the thunk `() => ProjectEntity` — call
		// it to resolve the target class for the equality check.
		const resolvedType =
			typeof manyToOne?.type === "function"
				? (manyToOne.type as () => typeof ProjectEntity)()
				: manyToOne?.type;
		expect(resolvedType).toBe(ProjectEntity);
		// TypeORM stores the relation options on `relation.options`.
		// Reading `onDelete` from there is the canonical way to
		// assert the cascade intent.
		const onDelete = (manyToOne as { options?: { onDelete?: string } })
			?.options?.onDelete;
		expect(onDelete).toBe("CASCADE");
	});
});
