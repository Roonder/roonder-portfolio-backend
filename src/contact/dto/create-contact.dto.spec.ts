import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateContactDto } from "./create-contact.dto";

/**
 * Validation spec for `CreateContactDto`. Mirrors the
 * `src/reviews/dto/create-review.dto.spec.ts` pattern:
 * `validate()` with `whitelist + forbidNonWhitelisted`, then
 * assert on the per-field error list.
 *
 * The DTO is the public submission contract (4 fields only:
 * `name`, `email`, `subject`, `message`). The spec scenario
 * "Extra fields are rejected" + "Form fields" is locked here.
 */
async function collectErrors(
	body: unknown,
): Promise<Array<{ field: string; msg: string }>> {
	const instance = plainToInstance(CreateContactDto, body);
	const errors = await validate(instance, {
		whitelist: true,
		forbidNonWhitelisted: true,
	});
	return errors.flatMap((e) =>
		Object.values(e.constraints ?? {}).map((msg) => ({
			field: e.property,
			msg,
		})),
	);
}

const VALID_BODY = {
	name: "Maria Lopez",
	email: "maria@example.com",
	subject: "Question about pricing",
	message: "Hi, I would like to know more about the project rate.",
};

describe("CreateContactDto validation", () => {
	it("accepts a fully-valid body (all 4 fields)", async () => {
		const errors = await collectErrors(VALID_BODY);
		expect(errors).toEqual([]);
	});

	it("rejects when name is missing (required)", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.name;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "name")).toBe(true);
	});

	it("rejects when email is missing (required)", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.email;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "email")).toBe(true);
	});

	it("rejects when subject is missing (required)", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.subject;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "subject")).toBe(true);
	});

	it("rejects when message is missing (required) — the canonical scenario", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.message;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "message")).toBe(true);
	});

	it("rejects a malformed email ('not-an-email')", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			email: "not-an-email",
		});
		expect(errors.some((e) => e.field === "email")).toBe(true);
	});

	it("rejects when name exceeds 100 chars", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			name: "x".repeat(101),
		});
		expect(errors.some((e) => e.field === "name")).toBe(true);
	});

	it("rejects when subject exceeds 150 chars", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			subject: "x".repeat(151),
		});
		expect(errors.some((e) => e.field === "subject")).toBe(true);
	});

	it("rejects when message exceeds 5000 chars", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			message: "x".repeat(5001),
		});
		expect(errors.some((e) => e.field === "message")).toBe(true);
	});

	it("rejects empty strings (length 0)", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			name: "",
			subject: "",
			message: "",
		});
		expect(errors.some((e) => e.field === "name")).toBe(true);
		expect(errors.some((e) => e.field === "subject")).toBe(true);
		expect(errors.some((e) => e.field === "message")).toBe(true);
	});

	it("rejects an extra 'phone' field (forbidNonWhitelisted, locked #6)", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			phone: "555-1234",
		});
		expect(errors.some((e) => e.field === "phone")).toBe(true);
	});

	it("rejects an extra 'company' field (forbidNonWhitelisted, locked #6)", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			company: "Acme",
		});
		expect(errors.some((e) => e.field === "company")).toBe(true);
	});

	it("rejects an extra 'attachments' field (forbidNonWhitelisted, locked #6)", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			attachments: ["file.pdf"],
		});
		expect(errors.some((e) => e.field === "attachments")).toBe(true);
	});

	it("rejects whitespace-only message (IsNotEmpty)", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			message: "    ",
		});
		expect(errors.some((e) => e.field === "message")).toBe(true);
	});
});
