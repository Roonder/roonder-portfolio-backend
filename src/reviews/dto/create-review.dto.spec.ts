import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateReviewDto } from "./create-review.dto";

async function collectErrors(
	body: unknown,
): Promise<Array<{ field: string; msg: string }>> {
	const instance = plainToInstance(CreateReviewDto, body);
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
	authorName: "Maria",
	authorRole: "PM",
	content: "Great work on the dashboard redesign",
	rating: 5,
};

describe("CreateReviewDto validation", () => {
	it("accepts a fully-valid body (all 4 fields)", async () => {
		const errors = await collectErrors(VALID_BODY);
		expect(errors).toEqual([]);
	});

	it("rejects when content is missing (required, the canonical 'submit review missing content' scenario)", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.content;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "content")).toBe(true);
	});

	it("rejects when rating is missing (required)", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.rating;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "rating")).toBe(true);
	});

	it("rejects when content is below 10 chars (the MinLength(10) gate)", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			content: "too short",
		});
		expect(errors.some((e) => e.field === "content")).toBe(true);
	});

	it("rejects when content exceeds 2000 chars", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			content: "x".repeat(2001),
		});
		expect(errors.some((e) => e.field === "content")).toBe(true);
	});

	it("rejects when rating is 0 (below the 1..5 range)", async () => {
		const errors = await collectErrors({ ...VALID_BODY, rating: 0 });
		expect(errors.some((e) => e.field === "rating")).toBe(true);
	});

	it("rejects when rating is 6 (above the 1..5 range)", async () => {
		const errors = await collectErrors({ ...VALID_BODY, rating: 6 });
		expect(errors.some((e) => e.field === "rating")).toBe(true);
	});

	it("rejects when authorName exceeds 100 chars (PII cap, ADR-9)", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			authorName: "x".repeat(101),
		});
		expect(errors.some((e) => e.field === "authorName")).toBe(true);
	});

	it("rejects when authorRole exceeds 120 chars", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			authorRole: "x".repeat(121),
		});
		expect(errors.some((e) => e.field === "authorRole")).toBe(true);
	});

	it("rejects an unknown field — locked #1: NO projectId / ownerUserId / subjectType at the DTO surface", async () => {
		// Per spec scenario "Unknown body field returns 400
		// (forbidNonWhitelisted)". The DTO is the canonical proof
		// of the no-polymorphism decision (ADR-1) at the API surface.
		const errors = await collectErrors({
			...VALID_BODY,
			projectId: "p-1",
		});
		expect(errors.length).toBeGreaterThan(0);
		// The `forbidNonWhitelisted` error is reported under the
		// unknown key's property name, which is `projectId`.
		expect(errors.some((e) => e.field === "projectId")).toBe(true);
	});

	it("rejects ownerUserId and subjectType the same way (NO polymorphism at the DTO surface)", async () => {
		const errorsOwner = await collectErrors({
			...VALID_BODY,
			ownerUserId: "u-1",
		});
		expect(errorsOwner.length).toBeGreaterThan(0);
		const errorsSubject = await collectErrors({
			...VALID_BODY,
			subjectType: "project",
		});
		expect(errorsSubject.length).toBeGreaterThan(0);
	});

	it("accepts the body without authorName / authorRole (optional fields)", async () => {
		const errors = await collectErrors({
			content: "Great work on the dashboard redesign",
			rating: 4,
		});
		expect(errors).toEqual([]);
	});
});
