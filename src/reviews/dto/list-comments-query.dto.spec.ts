import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ListCommentsQueryDto } from "./list-comments-query.dto";

/**
 * Pure validation spec for `ListCommentsQueryDto`. Mirrors
 * `src/reviews/dto/list-reviews-query.dto.spec.ts` shape. The
 * `page` + `pageSize` query string values come in as strings
 * from `req.query`; `@Type(() => Number)` coerces them. The
 * service silently re-clamps `pageSize > 100`; the DTO's
 * `@Max(100)` is the wire-level guard that returns 400.
 */
describe("ListCommentsQueryDto", () => {
	async function validateQuery(
		plain: Record<string, unknown>,
	): Promise<{ ok: boolean; messages: string[] }> {
		const dto = plainToInstance(ListCommentsQueryDto, plain);
		const errors = await validate(
			dto as object,
			{
				transform: true,
				transformOptions: { enableImplicitConversion: true },
			} as never,
		);
		return {
			ok: errors.length === 0,
			messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
		};
	}

	it("accepts an empty query (defaults applied at the service layer)", async () => {
		const r = await validateQuery({});
		expect(r.ok).toBe(true);
	});

	it("accepts ?page=2&pageSize=5", async () => {
		const r = await validateQuery({ page: "2", pageSize: "5" });
		expect(r.ok).toBe(true);
	});

	it("accepts string-coerced numbers (the @Type(() => Number) coercion path)", async () => {
		const r = await validateQuery({ page: "3", pageSize: "10" });
		expect(r.ok).toBe(true);
	});

	it("rejects page=0 with 400 (DTO @Min(1))", async () => {
		const r = await validateQuery({ page: "0" });
		expect(r.ok).toBe(false);
		expect(r.messages.join(" ")).toMatch(/page/);
	});

	it("rejects pageSize=500 with 400 (DTO @Max(100))", async () => {
		const r = await validateQuery({ pageSize: "500" });
		expect(r.ok).toBe(false);
		expect(r.messages.join(" ")).toMatch(/pageSize/);
	});
});
