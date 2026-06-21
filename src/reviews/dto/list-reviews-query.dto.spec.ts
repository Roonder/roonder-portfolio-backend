import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ListReviewsQueryDto } from "./list-reviews-query.dto";

function check(raw: Record<string, unknown>): ListReviewsQueryDto {
	// Query params arrive as strings; the global ValidationPipe has
	// `transformOptions: { enableImplicitConversion: true }`, so we
	// pass that option to plainToInstance to mirror the production
	// path. The `@Transform` on `isApproved` reads `obj[key]` to
	// recover the original "true"/"false" string before the implicit
	// coercion mangles it.
	return plainToInstance(ListReviewsQueryDto, raw, {
		enableImplicitConversion: true,
	});
}

describe("ListReviewsQueryDto transformations", () => {
	it("leaves optional fields undefined when no params are present (defaults are a service concern)", () => {
		const out = check({});
		expect(out.page).toBeUndefined();
		expect(out.pageSize).toBeUndefined();
		expect(out.rating).toBeUndefined();
		expect(out.isApproved).toBeUndefined();
	});

	it("parses ?page=2&pageSize=5 into numeric fields", () => {
		const out = check({ page: "2", pageSize: "5" });
		expect(out.page).toBe(2);
		expect(out.pageSize).toBe(5);
	});

	it("parses ?rating=5 into a numeric field", () => {
		const out = check({ rating: "5" });
		expect(out.rating).toBe(5);
	});

	it("coerces isApproved=true to a boolean (true)", () => {
		const out = check({ isApproved: "true" });
		expect(out.isApproved).toBe(true);
	});

	it("coerces isApproved=false to a boolean (false, regression for the implicit-conversion path)", () => {
		// The `@Transform` recovers the original string via `obj[key]`
		// so that `?isApproved=false` actually filters for unapproved
		// rows on the admin list. The string "false" is coerced to
		// Boolean("false") = true BEFORE the @Transform runs; the
		// transform re-reads the original from `obj.isApproved`.
		const out = check({ isApproved: "false" });
		expect(out.isApproved).toBe(false);
	});

	it("rejects ?page=0 with 400 (Min(1) gate)", async () => {
		const instance = check({ page: "0" });
		const errors = await validate(instance, {
			whitelist: true,
			forbidNonWhitelisted: true,
		});
		expect(errors.some((e) => e.property === "page")).toBe(true);
	});

	it("rejects ?pageSize=500 with 400 (DTO @Max(100) — wire-level guard; the service also re-clamps)", async () => {
		const instance = check({ pageSize: "500" });
		const errors = await validate(instance, {
			whitelist: true,
			forbidNonWhitelisted: true,
		});
		expect(errors.some((e) => e.property === "pageSize")).toBe(true);
	});
});
