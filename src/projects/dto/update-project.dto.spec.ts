import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { UpdateProjectDto } from "./update-project.dto";

async function collectErrors(
	body: unknown,
): Promise<Array<{ field: string; msg: string }>> {
	const instance = plainToInstance(UpdateProjectDto, body);
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

describe("UpdateProjectDto validation (PartialType semantics)", () => {
	it("accepts an empty body (every field is optional)", async () => {
		const errors = await collectErrors({});
		expect(errors).toEqual([]);
	});

	it("accepts a body with only the title field", async () => {
		const errors = await collectErrors({ title: "New title" });
		expect(errors).toEqual([]);
	});

	it("accepts a body with only the slug field (valid format)", async () => {
		const errors = await collectErrors({ slug: "new-slug" });
		expect(errors).toEqual([]);
	});

	it("rejects a body with an invalid slug format", async () => {
		const errors = await collectErrors({ slug: "Bad_Slug" });
		expect(errors.some((e) => e.field === "slug")).toBe(true);
	});

	it("accepts urls: [] (the 'remove all' signal — service applies it)", async () => {
		const errors = await collectErrors({ urls: [] });
		expect(errors).toEqual([]);
	});

	it("accepts urls being omitted (the 'no change' signal — service skips the DIFF)", async () => {
		const errors = await collectErrors({ title: "New" });
		expect(errors).toEqual([]);
	});

	it("rejects urls with two entries that share the same url (ADR-2 still applies)", async () => {
		const errors = await collectErrors({
			urls: [
				{ title: "First", url: "https://x.io" },
				{ title: "Second", url: "https://x.io" },
			],
		});
		expect(errors.some((e) => e.field === "urls")).toBe(true);
	});

	it("rejects unknown fields (forbidNonWhitelisted)", async () => {
		const errors = await collectErrors({ isAdmin: true });
		expect(errors.length).toBeGreaterThan(0);
	});
});
