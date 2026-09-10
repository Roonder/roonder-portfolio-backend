import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { ListContactsQueryDto } from "./list-contacts-query.dto";

/**
 * Validation spec for `ListContactsQueryDto`. Mirrors
 * `src/reviews/dto/list-reviews-query.dto.spec.ts`:
 * `class-transformer` `@Type(() => Number)` converts the
 * query-string values to numbers; the DTO asserts the bounds.
 *
 * The DTO declares `page` and `pageSize` as optional numbers.
 * Service-layer defaults (`page = 1`, `pageSize = 20`,
 * `pageSize > 100` silently clamped) are NOT in the DTO — the
 * wire-level guard is `@Min(1)` for both, and `@Max(100)` for
 * `pageSize`.
 */
async function collectErrors(
	query: Record<string, unknown>,
): Promise<Array<{ field: string; msg: string }>> {
	const instance = plainToInstance(ListContactsQueryDto, query);
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

describe("ListContactsQueryDto validation", () => {
	it("accepts no params (both fields are optional)", async () => {
		const errors = await collectErrors({});
		expect(errors).toEqual([]);
	});

	it("parses ?page=2&pageSize=5 to numeric fields", () => {
		const instance = plainToInstance(ListContactsQueryDto, {
			page: "2",
			pageSize: "5",
		});
		expect(instance.page).toBe(2);
		expect(instance.pageSize).toBe(5);
	});

	it("rejects ?page=0 (below the 1 floor)", async () => {
		const errors = await collectErrors({ page: "0" });
		expect(errors.some((e) => e.field === "page")).toBe(true);
	});

	it("rejects ?pageSize=500 (above the 100 cap, wire-level guard)", async () => {
		const errors = await collectErrors({ pageSize: "500" });
		expect(errors.some((e) => e.field === "pageSize")).toBe(true);
	});

	it("accepts the boundary ?pageSize=100", () => {
		const instance = plainToInstance(ListContactsQueryDto, {
			pageSize: "100",
		});
		expect(instance.pageSize).toBe(100);
	});

	it("rejects non-integer page (e.g. 'abc')", async () => {
		const errors = await collectErrors({ page: "abc" });
		expect(errors.some((e) => e.field === "page")).toBe(true);
	});
});
