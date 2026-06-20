import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";
import { ProjectEntity } from "./project.entity";

/**
 * Project URL row in the `project_urls` table. One Project can have
 * many URLs; the FK is `project_id` → `projects.id` with
 * `ON DELETE CASCADE` so a hard delete of a Project removes its
 * child URLs in the same operation (per spec §Admin Project Delete
 * with Cascade, ADR-1).
 */
@Entity("project_urls")
export class ProjectUrlEntity {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	// `JoinColumn` names the FK column in this table; `ManyToOne`'s
	// `onDelete: 'CASCADE'` is what TypeORM turns into the actual
	// `ON DELETE CASCADE` clause in the generated DDL.
	@ManyToOne(() => ProjectEntity, (project) => project.urls, {
		onDelete: "CASCADE",
	})
	@JoinColumn({ name: "project_id" })
	project!: ProjectEntity;

	@Column({ name: "project_id", type: "uuid" })
	projectId!: string;

	@Column({ type: "varchar" })
	title!: string;

	@Column({ type: "varchar" })
	url!: string;

	@CreateDateColumn({ name: "created_at" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt!: Date;
}
