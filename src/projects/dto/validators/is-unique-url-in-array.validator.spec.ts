import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { IsUniqueUrlInArray } from "./is-unique-url-in-array.validator";

describe("@IsUniqueUrlInArray()", () => {
	// The decorator targets the `urls` field on a host class. We declare
	// a minimal harness here so the spec does not depend on the project's
	// DTO surface (which is built on the same decorator in create/update
	// specs).
	class Harness {
		@IsUniqueUrlInArray()
		urls!: unknown;
	}

	async function check(value: unknown): Promise<string[]> {
		const instance = plainToInstance(Harness, { urls: value });
		const errors = await validate(instance);
		return errors.flatMap((e) => Object.values(e.constraints ?? {}));
	}

	it("accepts undefined (field absent — DTO @IsOptional takes precedence)", async () => {
		const messages = await check(undefined);
		expect(messages).toEqual([]);
	});

	it("accepts an empty array (urls: [] is the 'remove all' signal for PATCH)", async () => {
		const messages = await check([]);
		expect(messages).toEqual([]);
	});

	it("accepts a single entry", async () => {
		const messages = await check([{ title: "Repo", url: "https://x.io" }]);
		expect(messages).toEqual([]);
	});

	it("accepts two entries with different urls", async () => {
		const messages = await check([
			{ title: "Repo", url: "https://x.io" },
			{ title: "Demo", url: "https://y.io" },
		]);
		expect(messages).toEqual([]);
	});

	it("rejects two entries that share the exact same url", async () => {
		const messages = await check([
			{ title: "First", url: "https://x.io" },
			{ title: "Second", url: "https://x.io" },
		]);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatch(/duplicate url/i);
	});

	it("rejects two entries whose urls differ only in case (case-insensitive match per ADR-2)", async () => {
		const messages = await check([
			{ title: "First", url: "https://X.io" },
			{ title: "Second", url: "https://x.io" },
		]);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatch(/duplicate url/i);
	});

	it("rejects two entries whose urls differ only in surrounding whitespace", async () => {
		const messages = await check([
			{ title: "First", url: "  https://x.io  " },
			{ title: "Second", url: "https://x.io" },
		]);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatch(/duplicate url/i);
	});

	it("does not throw on a non-array value (delegate to @IsArray)", async () => {
		// @IsUniqueUrlInArray is paired with @IsArray on the DTO. If the
		// field is, e.g., a string, @IsArray reports the type error and
		// the uniqueness check stays silent (returns true). This avoids
		// two error messages for the same payload.
		const messages = await check("not-an-array");
		expect(messages).toEqual([]);
	});

	it("ignores entries whose url is empty (empty url is rejected by @IsUrl on the nested ProjectUrlDto)", async () => {
		const messages = await check([
			{ title: "First", url: "" },
			{ title: "Second", url: "" },
		]);
		expect(messages).toEqual([]);
	});
});
