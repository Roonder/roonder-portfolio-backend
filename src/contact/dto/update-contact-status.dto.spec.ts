import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdateContactStatusDto } from "./update-contact-status.dto";

/**
 * Validation spec for `UpdateContactStatusDto`. The status field
 * is the canonical enum (`pending`, `read`, `replied`) used by
 * the admin `PATCH /api/v1/admin/contacts/:id` route. Extra fields
 * (e.g. `emailSentLog`) are rejected at the DTO surface.
 */
async function collectErrors(
	body: unknown,
): Promise<Array<{ field: string; msg: string }>> {
	const instance = plainToInstance(UpdateContactStatusDto, body);
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

describe("UpdateContactStatusDto validation", () => {
	it("accepts { status: 'pending' }", async () => {
		const errors = await collectErrors({ status: "pending" });
		expect(errors).toEqual([]);
	});

	it("accepts { status: 'read' }", async () => {
		const errors = await collectErrors({ status: "read" });
		expect(errors).toEqual([]);
	});

	it("accepts { status: 'replied' }", async () => {
		const errors = await collectErrors({ status: "replied" });
		expect(errors).toEqual([]);
	});

	it("rejects missing status (required)", async () => {
		const errors = await collectErrors({});
		expect(errors.some((e) => e.field === "status")).toBe(true);
	});

	it("rejects { status: 'spam' } (not in the enum)", async () => {
		const errors = await collectErrors({ status: "spam" });
		expect(errors.some((e) => e.field === "status")).toBe(true);
	});

	it("rejects an extra 'isRead' field (forbidNonWhitelisted)", async () => {
		const errors = await collectErrors({
			status: "read",
			isRead: true,
		});
		expect(errors.some((e) => e.field === "isRead")).toBe(true);
	});

	it("rejects an extra 'emailSentLog' field (the dropped column, locked #2)", async () => {
		const errors = await collectErrors({
			status: "read",
			emailSentLog: true,
		});
		expect(errors.some((e) => e.field === "emailSentLog")).toBe(true);
	});
});
