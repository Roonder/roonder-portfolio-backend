import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

/**
 * Contact domain entity, mirroring the post-migration
 * `contacts` table in `openspec/specs/database-schema.dbml`. 8
 * columns: id, name, email, subject (nullable), message, status,
 * createdAt, updatedAt.
 *
 * **Destructive change vs. the canonical DBML**: the original
 * `email_sent_log boolean` column is GONE. The audit trail moved
 * to the new `sent_emails` table (see `sent-email.entity.ts` and
 * the migration at
 * `src/database/migrations/20260623000000-create-contacts-and-sent-emails.ts`).
 *
 * **Additive change**: `updated_at` is ADDED so the
 * `PATCH /api/v1/admin/contacts/:id` route's last-modified
 * timestamp is recorded (mirror the `projects` precedent).
 *
 * `status` defaults to `'pending'` at the DB level via the SQL
 * function literal `() => "'pending'"` so the literal is emitted
 * on the DB side, not as a JS literal. The `CreateContactDto`
 * does NOT take a `status` field; the service also locks the
 * value to `'pending'` at insert time (defense in depth: the
 * public submission contract).
 */
@Entity("contacts")
export class ContactEntity {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({ type: "varchar" })
	name!: string;

	@Column({ type: "varchar" })
	email!: string;

	@Column({ type: "varchar", nullable: true })
	subject!: string | null;

	@Column({ type: "text" })
	message!: string;

	@Column({
		type: "varchar",
		default: () => "'pending'",
	})
	status!: string;

	@CreateDateColumn({ name: "created_at" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt!: Date;
}
