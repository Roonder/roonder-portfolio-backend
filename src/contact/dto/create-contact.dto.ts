import { ApiProperty } from "@nestjs/swagger";
import {
	IsEmail,
	IsNotEmpty,
	IsString,
	Matches,
	MaxLength,
	MinLength,
} from "class-validator";

/**
 * Body of `POST /api/v1/contacts` (public). Validated by the global
 * `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform`
 * (configured in `src/main.ts`).
 *
 * Field caps (per the spec lock + user decision #6):
 *   - `name` is required, 1..100 chars.
 *   - `email` is required, must be a valid email.
 *   - `subject` is required, 1..150 chars (the DB allows null on
 *     direct inserts; the public DTO requires it).
 *   - `message` is required, 1..5000 chars, non-whitespace.
 *
 * NO `phone`, NO `company`, NO `attachments` (locked #6). The DTO
 * is the canonical proof at the API surface: any future commit
 * that adds one of those fields will be rejected by the spec
 * scenario "Extra fields are rejected".
 */
export class CreateContactDto {
	@ApiProperty({ minLength: 1, maxLength: 100, example: "Maria Lopez" })
	@IsString()
	@IsNotEmpty()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@ApiProperty({ format: "email", example: "maria@example.com" })
	@IsEmail()
	@IsNotEmpty()
	email!: string;

	@ApiProperty({
		minLength: 1,
		maxLength: 150,
		example: "Question about pricing",
	})
	@IsString()
	@IsNotEmpty()
	@MinLength(1)
	@MaxLength(150)
	subject!: string;

	@ApiProperty({
		minLength: 1,
		maxLength: 5000,
		example: "Hi, I would like to know more about the project rate.",
	})
	@IsString()
	@IsNotEmpty()
	@MinLength(1)
	@MaxLength(5000)
	// Reject whitespace-only messages (e.g. "   "). The
	// `@IsNotEmpty()` decorator only catches `""`; the regex forces
	// at least one non-whitespace character. The actual stored
	// value is NOT trimmed (preserves the visitor's formatting).
	@Matches(/\S/, { message: "message should not be empty or whitespace" })
	message!: string;
}
