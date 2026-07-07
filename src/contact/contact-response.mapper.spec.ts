import { toContactResponse } from "./contact.mapper";
import type { ContactEntity } from "./entities/contact.entity";

/**
 * Pure-function spec for the response mapper. Mirrors
 * `src/reviews/review-response.mapper.spec.ts` shape: build a
 * canonical row + edge cases, call the mapper, assert the
 * output shape.
 */
describe("toContactResponse", () => {
	const baseRow: ContactEntity = {
		id: "11111111-2222-3333-4444-555555555555",
		name: "Maria Lopez",
		email: "maria@example.com",
		subject: "Question about pricing",
		message: "Hi, I would like to know more about the project rate.",
		status: "pending",
		createdAt: new Date("2026-06-19T10:00:00.000Z"),
		updatedAt: new Date("2026-06-19T10:00:00.000Z"),
	};

	it("maps all 8 fields from the entity to the response DTO", () => {
		const out = toContactResponse(baseRow);
		expect(out).toEqual({
			id: "11111111-2222-3333-4444-555555555555",
			name: "Maria Lopez",
			email: "maria@example.com",
			subject: "Question about pricing",
			message: "Hi, I would like to know more about the project rate.",
			status: "pending",
			createdAt: new Date("2026-06-19T10:00:00.000Z"),
			updatedAt: new Date("2026-06-19T10:00:00.000Z"),
		});
	});

	it("preserves null subject (the entity allows null on direct inserts)", () => {
		const row = { ...baseRow, subject: null };
		const out = toContactResponse(row);
		expect(out.subject).toBeNull();
	});

	it("preserves the createdAt + updatedAt Date references (no copy)", () => {
		const row = { ...baseRow };
		const out = toContactResponse(row);
		expect(out.createdAt).toBe(row.createdAt);
		expect(out.updatedAt).toBe(row.updatedAt);
	});

	it("does NOT include an emailSentLog field (the destructive change)", () => {
		const out = toContactResponse(baseRow);
		expect(Object.keys(out)).not.toContain("emailSentLog");
		expect("emailSentLog" in out).toBe(false);
	});

	it("is a pure function (same input produces the same output)", () => {
		const a = toContactResponse(baseRow);
		const b = toContactResponse(baseRow);
		expect(a).toEqual(b);
	});

	it("preserves non-pending status values (read, replied)", () => {
		const rowRead = { ...baseRow, status: "read" };
		const rowReplied = { ...baseRow, status: "replied" };
		expect(toContactResponse(rowRead).status).toBe("read");
		expect(toContactResponse(rowReplied).status).toBe("replied");
	});
});
