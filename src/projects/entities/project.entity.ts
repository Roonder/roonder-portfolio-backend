import {
	Column,
	CreateDateColumn,
	Entity,
	OneToMany,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

/**
 * Project domain entity, mirroring the `projects` table in
 * `openspec/specs/database-schema.dbml`. The one-to-many relation to
 * `ProjectUrlEntity` uses a string-based target (`"ProjectUrlEntity"`)
 * to avoid a hard import on `project-url.entity.ts`; Task 1.2 fills
 * in the target class and the inbound `@ManyToOne` from ProjectUrlEntity.
 *
 * Per ADR-3, the `tags` column is a Postgres `text[]` (not `varchar[]`)
 * — the DBML delta is in `openspec/changes/projects-crud` and is
 * applied by the migration in Task 1.5.
 */
@Entity("projects")
export class ProjectEntity {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({ type: "varchar" })
	title!: string;

	// `unique: true` mirrors the DBML `slug varchar unique not null`.
	@Column({ type: "varchar", unique: true })
	slug!: string;

	@Column({ type: "text" })
	description!: string;

	@Column({ type: "text", nullable: true })
	content!: string | null;

	@Column({ name: "cover_image", type: "varchar", nullable: true })
	coverImage!: string | null;

	// `array: true` is the TypeORM signal for a Postgres array column.
	// The `default` uses a SQL function so the empty-array constant
	// is emitted on the DB side, not as a JS literal.
	@Column({
		name: "tags",
		type: "text",
		array: true,
		nullable: true,
		default: () => "ARRAY[]::text[]",
	})
	tags!: string[];

	@Column({ name: "is_published", type: "boolean", default: false })
	isPublished!: boolean;

	@CreateDateColumn({ name: "created_at" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt!: Date;

	// `string` form for the target — TypeORM resolves it at runtime via
	// the MetadataArgsStorage. The inverse-side property name is `project`
	// (matches the `@ManyToOne(() => ProjectEntity, (p) => p.urls)` on
	// ProjectUrlEntity).
	@OneToMany("ProjectUrlEntity", "project")
	urls!: unknown[];
}
