import { plainToInstance } from "class-transformer";
import { ListProjectsQueryDto } from "./list-projects-query.dto";

function check(raw: Record<string, unknown>): ListProjectsQueryDto {
	// Query params arrive as strings; the global ValidationPipe has
	// `enableImplicitConversion: true`, so plainToInstance is enough
	// to exercise the @Type(() => Number) / @Type(() => Boolean)
	// conversions. We mirror the production path. This helper is
	// intentionally synchronous — `plainToInstance` is sync; the
	// describe block uses `it(..., () => { ... })` to call it.
	return plainToInstance(ListProjectsQueryDto, raw);
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
});
