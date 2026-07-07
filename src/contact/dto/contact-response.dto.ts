import { ApiProperty } from "@nestjs/swagger";

/**
 * Single contact in response bodies. The 8 fields mirror the
 * `ContactEntity` at the API boundary: `id`, `name`, `email`,
 * `subject`, `message`, `status`, `createdAt`, `updatedAt`.
 *
 * `subject` is nullable (the entity allows null on direct
 * inserts); the public `CreateContactDto` requires it but the
 * DTO is the wire contract, the entity is the storage contract.
 * `status` is a free-form string in the response (the canonical
 * enum values are `pending`, `read`, `replied` per
 * `UpdateContactStatusDto`'s `CONTACT_STATUS`, but a future
 * `archive` value would still surface here).
 */
export class ContactResponseDto {
	@ApiProperty({ format: "uuid" })
	id!: string;

	@ApiProperty({ maxLength: 100 })
	name!: string;

	@ApiProperty({ format: "email" })
	email!: string;

	@ApiProperty({ maxLength: 150, nullable: true })
	subject!: string | null;

	@ApiProperty({ maxLength: 5000 })
	message!: string;

	@ApiProperty({ example: "pending" })
	status!: string;

	@ApiProperty({ format: "date-time" })
	createdAt!: Date;

	@ApiProperty({ format: "date-time" })
	updatedAt!: Date;
}
