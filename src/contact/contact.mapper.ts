import type { ContactResponseDto } from "./dto/contact-response.dto";
import type { ContactEntity } from "./entities/contact.entity";

/**
 * Entity → response DTO mapper for the contact domain. Pure
 * function, no side effects. The mapper is the single point
 * where the success shape is decided — controllers and tests
 * consume the same shape via the response DTO class (the
 * structural contract is identical and the runtime values are
 * assignment-compatible with `ContactResponseDto`).
 *
 * The mapper takes the entity type as input and returns a
 * plain object with the 8 documented fields. There is no
 * `emailSentLog` field (the destructive DBML change: the
 * `email_sent_log` boolean on `contacts` was dropped in the
 * migration; the audit trail moved to the new `sent_emails`
 * table). The `subject` field is preserved as `null` when the
 * row has a NULL subject (the entity allows null on direct
 * admin inserts; the public DTO requires it).
 *
 * The Date references are NOT copied — same `Date` instance
 * is returned for `createdAt` + `updatedAt`. The class-validator
 * pipeline (none here, the mapper is post-validation) and the
 * JSON serializer (`JSON.stringify(date) === ISO string`) handle
 * the runtime representation. NestJS serialises the response
 * via `JSON.stringify`, so the `Date` becomes an ISO 8601 string
 * on the wire.
 */
export function toContactResponse(row: ContactEntity): ContactResponseDto {
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		subject: row.subject,
		message: row.message,
		status: row.status,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
