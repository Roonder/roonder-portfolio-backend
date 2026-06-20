import {
	Column,
	CreateDateColumn,
	Entity,
	OneToMany,
	PrimaryGeneratedColumn,
} from "typeorm";
import { ReviewCommentEntity } from "./review-comment.entity";

/**
 * Review domain entity, mirroring the `reviews` table in
 * `openspec/specs/database-schema.dbml` lines 39-47. 7 columns, no
 * FK to `projects` or `users`, no `subjectType` discriminator —
 * ADR-1 (locked #1). A visitor who wants to refer to a project or
 * to the owner writes that into the free-text `content` field.
 *
 * The `comments` one-to-many is the inverse of the
 * `@ManyToOne(() => ReviewEntity, (r) => r.comments,
 *   { onDelete: 'CASCADE' })` declared on `ReviewCommentEntity`.
 * The thunk form for both sides resolves the circular import at
 * class-evaluation time (mirrors the `ProjectEntity` ↔
 * `ProjectUrlEntity` pattern).
 *
 * `authorName` defaults to `'Anónimo'` at the DB level via the
 * SQL function literal `() => "'Anónimo'"` so the constant is
 * emitted on the DB side, not as a JS literal. The `CreateReviewDto`
 * also defaults `authorName` to the same string at the input
 * boundary, so the two-layer default is consistent.
 */
@Entity("reviews")
export class ReviewEntity {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({
		name: "author_name",
		type: "varchar",
		default: () => "'Anónimo'",
	})
	authorName!: string;

	@Column({ name: "author_role", type: "varchar", nullable: true })
	authorRole!: string | null;

	@Column({ type: "text" })
	content!: string;

	@Column({ type: "integer" })
	rating!: number;

	@Column({ name: "is_approved", type: "boolean", default: false })
	isApproved!: boolean;

	@CreateDateColumn({ name: "created_at" })
	createdAt!: Date;

	// Thunk form: TypeORM resolves the arrow function at
	// class-evaluation time and stores the resulting class in the
	// metadata storage. The inverse-side property name is `review`
	// (matches the `@ManyToOne(() => ReviewEntity, (r) => r.comments)`
	// on `ReviewCommentEntity`). The relation is NOT eager-loaded on
	// the public list — `findAllApproved` and `findAllForAdmin` only
	// select the parent row.
	@OneToMany(() => ReviewCommentEntity, (c) => c.review)
	comments!: ReviewCommentEntity[];
}
