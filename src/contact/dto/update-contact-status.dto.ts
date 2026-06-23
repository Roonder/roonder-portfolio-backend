import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty } from "class-validator";

/**
 * Canonical status enum for the contact domain. The values are
 * locked by the spec scenario "Admin status transition (protected)":
 *   - `pending`: the public submission default.
 *   - `read`: the admin has read the message.
 *   - `replied`: the admin has replied (the email is sent out-of-band
 *     via the operator's own mail client — the PATCH only flips the
 *     status flag).
 *
 * The `as const` pattern keeps the runtime + TS type in sync (per
 * the project's typescript skill). The values are passed to
 * `@IsIn([...])` so the DTO enforces the same set the entity's
 * `status` column accepts.
 */
export const CONTACT_STATUS = {
	PENDING: "pending",
	READ: "read",
	REPLIED: "replied",
} as const;
export type ContactStatus =
	(typeof CONTACT_STATUS)[keyof typeof CONTACT_STATUS];

/**
 * Body of `PATCH /api/v1/admin/contacts/:id`. The admin flips the
 * `status` field through the canonical enum. Extra fields (e.g.
 * `isRead`, `emailSentLog`) are rejected at the DTO surface via
 * `forbidNonWhitelisted: true` on the global `ValidationPipe`.
 */
export class UpdateContactStatusDto {
	@ApiProperty({
		enum: Object.values(CONTACT_STATUS),
		example: CONTACT_STATUS.READ,
	})
	@IsIn(Object.values(CONTACT_STATUS))
	@IsNotEmpty()
	status!: ContactStatus;
}
