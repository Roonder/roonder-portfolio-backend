import {
	renderContactAutoReplyHtml,
	renderContactAutoReplyText,
	renderContactNotificationHtml,
	renderContactNotificationText,
} from "./email-renderer";

/**
 * Spec for the pure-function email renderers in
 * `src/contact/email/email-renderer.ts`.
 *
 * 3 categories of assertions:
 *
 *   1. **Substitution**: the 4 `{{placeholder}}` tokens in
 *      `email-template.ts` (`{{name}}`, `{{email}}`,
 *      `{{subject}}`, `{{message}}`) are replaced with the
 *      corresponding field on the input row.
 *
 *   2. **Regex invariants** (locked by the spec, design §12):
 *      the rendered HTML does NOT match `/<style\b/i`, does NOT
 *      contain `display: flex`, `display: grid`,
 *      `position: absolute`, `position: fixed`, or `@font-face`.
 *      These assertions are the unit-level executable
 *      contract for the vanilla-HTML design decision.
 *
 *   3. **Plain-text fallbacks**: every render path returns a
 *      non-empty `text` variant. The auto-reply plain-text
 *      contains the locked Spanish phrase
 *      `Recibimos tu mensaje, te contactaremos por email en breve.`
 *      The owner-notification plain-text starts with the
 *      literal `New contact form submission`.
 */

const SAMPLE_ROW = {
	name: "Maria Lopez",
	email: "maria@example.com",
	subject: "Question about pricing",
	message: "Hi, I would like to know more about the project rate.",
} as const;

describe("renderContactNotificationHtml", () => {
	const html = renderContactNotificationHtml(SAMPLE_ROW);

	it("returns a non-empty string", () => {
		expect(typeof html).toBe("string");
		expect(html.length).toBeGreaterThan(0);
	});

	it("does NOT contain a <style> block (vanilla-HTML invariant)", () => {
		expect(html).not.toMatch(/<style\b/i);
	});

	it("does NOT use display: flex (vanilla-HTML invariant)", () => {
		expect(html).not.toMatch(/display:\s*flex/i);
	});

	it("does NOT use display: grid (vanilla-HTML invariant)", () => {
		expect(html).not.toMatch(/display:\s*grid/i);
	});

	it("does NOT use position: absolute (vanilla-HTML invariant)", () => {
		expect(html).not.toMatch(/position:\s*absolute/i);
	});

	it("does NOT use position: fixed (vanilla-HTML invariant)", () => {
		expect(html).not.toMatch(/position:\s*fixed/i);
	});

	it("does NOT use @font-face (vanilla-HTML invariant)", () => {
		expect(html).not.toMatch(/@font-face/i);
	});

	it("substitutes {{name}} with the row's name", () => {
		expect(html).toContain("Maria Lopez");
		expect(html).not.toContain("{{name}}");
	});

	it("substitutes {{email}} with the row's email", () => {
		expect(html).toContain("maria@example.com");
		expect(html).not.toContain("{{email}}");
	});

	it("substitutes {{subject}} with the row's subject", () => {
		expect(html).toContain("Question about pricing");
		expect(html).not.toContain("{{subject}}");
	});

	it("substitutes {{message}} with the row's message", () => {
		expect(html).toContain(
			"Hi, I would like to know more about the project rate.",
		);
		expect(html).not.toContain("{{message}}");
	});
});

describe("renderContactNotificationText", () => {
	const text = renderContactNotificationText(SAMPLE_ROW);

	it("is non-empty (plain-text fallback is always present)", () => {
		expect(typeof text).toBe("string");
		expect(text.length).toBeGreaterThan(0);
	});

	it("starts with 'New contact form submission'", () => {
		expect(text.startsWith("New contact form submission")).toBe(true);
	});

	it("substitutes the row's name, email, subject, message", () => {
		expect(text).toContain("Maria Lopez");
		expect(text).toContain("maria@example.com");
		expect(text).toContain("Question about pricing");
		expect(text).toContain(
			"Hi, I would like to know more about the project rate.",
		);
		expect(text).not.toContain("{{");
	});
});

describe("renderContactAutoReplyHtml", () => {
	const html = renderContactAutoReplyHtml(SAMPLE_ROW);

	it("returns a non-empty string", () => {
		expect(typeof html).toBe("string");
		expect(html.length).toBeGreaterThan(0);
	});

	it("does NOT contain a <style> block", () => {
		expect(html).not.toMatch(/<style\b/i);
	});

	it("does NOT use display: flex, display: grid, or position: absolute/fixed", () => {
		expect(html).not.toMatch(/display:\s*flex/i);
		expect(html).not.toMatch(/display:\s*grid/i);
		expect(html).not.toMatch(/position:\s*absolute/i);
		expect(html).not.toMatch(/position:\s*fixed/i);
	});

	it("substitutes {{name}} with the row's name", () => {
		expect(html).toContain("Maria Lopez");
		expect(html).not.toContain("{{name}}");
	});

	it("does NOT contain any unsubstituted placeholders", () => {
		expect(html).not.toMatch(/{{/);
	});
});

describe("renderContactAutoReplyText", () => {
	const text = renderContactAutoReplyText(SAMPLE_ROW);

	it("is non-empty (plain-text fallback is always present)", () => {
		expect(typeof text).toBe("string");
		expect(text.length).toBeGreaterThan(0);
	});

	it("contains the locked Spanish copy: 'Recibimos tu mensaje, te contactaremos por email en breve.'", () => {
		expect(text).toContain(
			"Recibimos tu mensaje, te contactaremos por email en breve.",
		);
	});

	it("substitutes the row's name", () => {
		expect(text).toContain("Maria Lopez");
		expect(text).not.toContain("{{name}}");
	});

	it("does NOT contain any unsubstituted placeholders", () => {
		expect(text).not.toMatch(/{{/);
	});
});
