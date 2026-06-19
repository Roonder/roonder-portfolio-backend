import { plainToInstance } from "class-transformer";
import { ListProjectsQueryDto } from "./list-projects-query.dto";

function check(raw: Record<string, unknown>): ListProjectsQueryDto {
	// Query params arrive as strings; the global ValidationPipe has
	// `transformOptions: { enableImplicitConversion: true }`, so we
	// pass that option to plainToInstance to mirror the production
	// path. Without it the @Transform sees the raw string "false"
	// and converts it correctly — the test passes either way. With
	// it, implicit conversion coerces "false" to Boolean("false")
	// = true BEFORE @Transform runs, so the @Transform must use
	// the `obj` parameter to recover the original.
	return plainToInstance(ListProjectsQueryDto, raw, {
		enableImplicitConversion: true,
	});
}

describe("ListProjectsQueryDto transformations", () => {
	it("leaves optional fields undefined when no params are present (defaults are a service concern)", () => {
		const out = check({});
		expect(out.page).toBeUndefined();
		expect(out.pageSize).toBeUndefined();
		expect(out.tags).toBeUndefined();
		expect(out.isPublished).toBeUndefined();
	});

	it("parses ?page=2&pageSize=5 into numeric fields", () => {
		const out = check({ page: "2", pageSize: "5" });
		expect(out.page).toBe(2);
		expect(out.pageSize).toBe(5);
	});

	it("parses repeated ?tags=react&tags=nestjs into an array", () => {
		const out = check({ tags: ["react", "nestjs"] });
		expect(out.tags).toEqual(["react", "nestjs"]);
	});

	it("parses csv ?tags=react,nestjs into an array", () => {
		const out = check({ tags: "react,nestjs" });
		expect(out.tags).toEqual(["react", "nestjs"]);
	});

	it("parses ?tags= (empty) into an empty array", () => {
		const out = check({ tags: "" });
		expect(out.tags).toEqual([]);
	});

	it("lowercases and trims tag values", () => {
		const out = check({ tags: " React , NestJS " });
		expect(out.tags).toEqual(["react", "nestjs"]);
	});

	it("coerces isPublished=true to a boolean", () => {
		const out = check({ isPublished: "true" });
		expect(out.isPublished).toBe(true);
	});

	it("coerces isPublished=false to a boolean", () => {
		const out = check({ isPublished: "false" });
		expect(out.isPublished).toBe(false);
	});

	// Regression: with `enableImplicitConversion: true` (the global
	// ValidationPipe option in main.ts), the string "false" is first
	// coerced to Boolean("false") === true BEFORE the @Transform
	// runs. The DTO MUST recover the original via the `obj` argument
	// so that "?isPublished=false" actually filters for unpublished
	// projects. See test/projects.e2e-spec.ts for the end-to-end
	// coverage of this case.
	it("coerces isPublished=false to false even with enableImplicitConversion: true (regression for PR3 e2e)", () => {
		const out = check({ isPublished: "false" });
		expect(out.isPublished).toBe(false);
	});
});
