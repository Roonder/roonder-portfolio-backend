import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { CreateProjectDto } from "./create-project.dto";

async function collectErrors(
	body: unknown,
): Promise<Array<{ field: string; msg: string }>> {
	const instance = plainToInstance(CreateProjectDto, body);
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
	title: "Portfolio app",
	slug: "portfolio-app",
	description: "My portfolio",
	content: "Markdown body",
	coverImage: "https://example.com/cover.png",
	tags: ["React", "NestJS"],
	isPublished: true,
	urls: [
		{ title: "Repo", url: "https://github.com/x/y" },
		{ title: "Live", url: "https://y.example.com" },
	],
};

describe("CreateProjectDto validation", () => {
	it("accepts a fully-valid body", async () => {
		const errors = await collectErrors(VALID_BODY);
		expect(errors).toEqual([]);
	});

	it("rejects when title is missing (required)", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.title;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "title")).toBe(true);
	});

	it("rejects when slug is missing (required)", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.slug;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "slug")).toBe(true);
	});

	it("rejects when slug has an invalid format (uppercase, spaces, underscores)", async () => {
		const errors = await collectErrors({ ...VALID_BODY, slug: "Bad_Slug" });
		expect(errors.some((e) => e.field === "slug")).toBe(true);
	});

	it("rejects when description is missing (required)", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.description;
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "description")).toBe(true);
	});

	it("rejects when coverImage is not a URL with http/https protocol", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			coverImage: "ftp://x.io",
		});
		expect(errors.some((e) => e.field === "coverImage")).toBe(true);
	});

	it("rejects when tags is not an array of strings", async () => {
		const errors = await collectErrors({
			...VALID_BODY,
			tags: "not-an-array",
		});
		expect(errors.some((e) => e.field === "tags")).toBe(true);
	});

	it("rejects when two urls share the same url value (ADR-2)", async () => {
		const body = {
			...VALID_BODY,
			urls: [
				{ title: "First", url: "https://x.io" },
				{ title: "Second", url: "https://x.io" },
			],
		};
		const errors = await collectErrors(body);
		expect(errors.some((e) => e.field === "urls")).toBe(true);
	});

	// The nested-ProjectUrlDto validation (e.g. `ftp://` rejection on
	// each entry's `url`) fires through the global ValidationPipe's
	// `transform: true` + `@Type(() => ProjectUrlDto)` chain at
	// request time. The DTO-level test here would need to mirror
	// the full Nest pipe to fire `@ValidateNested`; the dedicated
	// e2e in PR3 (controller spec in Task 2.8) covers this branch
	// end-to-end.

	it("rejects unknown fields (forbidNonWhitelisted on the global pipe)", async () => {
		const errors = await collectErrors({ ...VALID_BODY, isAdmin: true });
		// `forbidNonWhitelisted` produces a single error for the
		// unknown property; we only assert that SOMETHING was rejected.
		expect(errors.length).toBeGreaterThan(0);
	});

	it("accepts an empty urls array (no urls is valid; @IsOptional on a body DTO is permissive)", async () => {
		const errors = await collectErrors({ ...VALID_BODY, urls: [] });
		expect(errors).toEqual([]);
	});

	it("accepts an omitted urls field", async () => {
		const body = { ...VALID_BODY } as Partial<typeof VALID_BODY>;
		delete body.urls;
		const errors = await collectErrors(body);
		expect(errors).toEqual([]);
	});

	it("normalises tags: trims whitespace, lowercases, dedupes", () => {
		// The tags Transform normalises on assignment. We assert that
		// `plainToInstance` triggers the transform and the resulting
		// value is what the spec locks: ['react', 'nestjs'].
		const instance = plainToInstance(CreateProjectDto, {
			...VALID_BODY,
			tags: [" React ", "react", "NestJS", "nestjs", ""],
		});
		expect(instance.tags).toEqual(["react", "nestjs"]);
	});
});
