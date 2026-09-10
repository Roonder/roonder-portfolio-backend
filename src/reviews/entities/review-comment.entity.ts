import {
	Column,
	CreateDateColumn,
	Entity,
	JoinColumn,
	ManyToOne,
	PrimaryGeneratedColumn,
} from "typeorm";
import { ReviewEntity } from "./review.entity";

/**
 * Review comment row in the `review_comments` table. Mirrors the
 * DBML columns at `openspec/specs/database-schema.dbml` lines 49-55
 * PLUS the `is_approved` column this change adds (locked #3,
 * ADR-7). The migration creates the column with
 * `ADD COLUMN IF NOT EXISTS` for idempotency.
 *
 * The `@ManyToOne` to `ReviewEntity` declares `onDelete: 'CASCADE'`
 * (locked #4, ADR-8) so `DELETE /api/v1/admin/reviews/:id` removes
 * the child comment rows in the same DB operation. The
 * `ReviewsService.remove` does NOT issue a manual
 * `this.comments.delete(...)` — the FK CASCADE does the work.
 *
 * `authorName` defaults to `'Anónimo'` at the DB level (same SQL
 * function literal pattern as `ReviewEntity`).
 */
@Entity("review_comments")
export class ReviewCommentEntity {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@ManyToOne(() => ReviewEntity, (r) => r.comments, {
		onDelete: "CASCADE",
	})
	@JoinColumn({ name: "review_id" })
	review!: ReviewEntity;

	@Column({ name: "review_id", type: "uuid" })
	reviewId!: string;

	@Column({
		name: "author_name",
		type: "varchar",
		default: () => "'Anónimo'",
	})
	authorName!: string;

	@Column({ type: "text" })
	content!: string;

	@Column({ name: "is_approved", type: "boolean", default: false })
	isApproved!: boolean;

	@CreateDateColumn({ name: "created_at" })
	createdAt!: Date;
}
