import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

/**
 * Audit-trail entity for the contact domain. Every Resend send
 * attempt (the owner notification + the visitor auto-reply) writes
 * exactly one row to this table via the `EmailService` wrapper.
 * The table is intentionally FK-free: a contact row can be hard-
 * deleted without cascading the audit trail, and the operator can
 * audit failures independently (`SELECT * FROM sent_emails WHERE
 * status = 'failed'`).
 *
 * The 2 native Postgres enums (`sent_emails_status_enum`,
 * `sent_emails_kind_enum`) are declared via
 * `@Column({ type: "enum", enum: [...] })` so the migration's
 * `CREATE TYPE` matches the runtime values. The 4 indexes from
 * the migration (kind, status, created_at DESC, partial unique on
 * resend_id) are NOT declared in the entity — the migration owns
 * them.
 *
 * `status` and `kind` are typed as TypeScript string unions via
 * the `SENT_EMAIL_STATUS` / `SENT_EMAIL_KIND` const objects
 * declared in `src/contact/email/email.constants.ts` (imported
 * here to keep the entity and the service in sync).
 */
export const SENT_EMAIL_STATUS = {
	ACCEPTED: "accepted",
	FAILED: "failed",
} as const;
export type SentEmailStatus =
	(typeof SENT_EMAIL_STATUS)[keyof typeof SENT_EMAIL_STATUS];

export const SENT_EMAIL_KIND = {
	CONTACT_NOTIFICATION: "contact_notification",
	CONTACT_AUTO_REPLY: "contact_auto_reply",
} as const;
export type SentEmailKind =
	(typeof SENT_EMAIL_KIND)[keyof typeof SENT_EMAIL_KIND];

@Entity("sent_emails")
export class SentEmailEntity {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({ type: "varchar" })
	subject!: string;

	@Column({ type: "varchar" })
	from!: string;

	@Column({ type: "varchar" })
	to!: string;

	@Column({ name: "resend_id", type: "varchar", nullable: true })
	resendId!: string | null;

	@Column({
		type: "enum",
		enum: Object.values(SENT_EMAIL_STATUS),
	})
	status!: SentEmailStatus;

	@Column({
		type: "enum",
		enum: Object.values(SENT_EMAIL_KIND),
	})
	kind!: SentEmailKind;

	@Column({ name: "error_message", type: "text", nullable: true })
	errorMessage!: string | null;

	@CreateDateColumn({ name: "created_at" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt!: Date;
}
