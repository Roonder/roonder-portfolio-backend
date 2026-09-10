import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateReviewCommentDto } from "./create-review-comment.dto";

/**
 * Pure validation spec for `CreateReviewCommentDto`. Mirrors
 * `src/reviews/dto/create-review.dto.spec.ts` shape. The pipe
 * layer is the global `ValidationPipe` from `main.ts`; this
 * spec exercises the DTO directly with `validate()` so the
 * test does NOT depend on a Nest testing module.
 */
describe("CreateReviewCommentDto", () => {
	async function validateDto(
		plain: Record<string, unknown>,
	): Promise<{ ok: boolean; messages: string[] }> {
		const dto = plainToInstance(CreateReviewCommentDto, plain);
		const errors = await validate(dto as object);
		return {
			ok: errors.length === 0,
			messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
		};
	}

	it("accepts a happy-path body with content only", async () => {
		const r = await validateDto({
			content: "Agree, well done",
		});
		expect(r.ok).toBe(true);
	});

	it("accepts a happy-path body with authorName + content", async () => {
		const r = await validateDto({
			authorName: "Pedro",
			content: "Agree, well done",
		});
		expect(r.ok).toBe(true);
	});

	it("rejects missing content with a class-validator message", async () => {
		const r = await validateDto({ authorName: "Pedro" });
		expect(r.ok).toBe(false);
		expect(r.messages.join(" ")).toMatch(/content/);
	});

	it("rejects content below 2 characters with 400 (DTO @MinLength(2))", async () => {
		const r = await validateDto({ content: "x" });
		expect(r.ok).toBe(false);
		expect(r.messages.join(" ")).toMatch(/content/);
	});

	it("rejects content above 1000 characters with 400 (DTO @MaxLength(1000))", async () => {
		const r = await validateDto({ content: "x".repeat(1001) });
		expect(r.ok).toBe(false);
		expect(r.messages.join(" ")).toMatch(/content/);
	});

	it("rejects authorName above 100 characters with 400 (DTO @MaxLength(100))", async () => {
		const r = await validateDto({
			authorName: "x".repeat(101),
			content: "Agree",
		});
		expect(r.ok).toBe(false);
		expect(r.messages.join(" ")).toMatch(/authorName/);
	});

	it("rejects non-string content (e.g. numeric)", async () => {
		const r = await validateDto({ content: 12345 });
		expect(r.ok).toBe(false);
	});
});
