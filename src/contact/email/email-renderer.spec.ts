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
 * 4 categories of assertions:
 *
 *   1. **Substitution**: the 4 `{{placeholder}}` tokens in
 *      `email-template.ts` (`{{name}}`, `{{email}}`,
 *      `{{subject}}`, `{{message}}`) are replaced with the
 *      corresponding field on the input row in BOTH the
 *      Spanish and the English sections.
 *
 *   2. **Dual-language content** (locked by the spec, post-verify
 *      refinement 2026-06-24): the rendered HTML for both
 *      `contact_notification` and `contact_auto_reply` MUST
 *      contain a Spanish section AND an English section. The
 *      Spanish section appears first; the English section
 *      appears second; a thin visual divider separates them.
 *      The Spanish section's headings are
 *      "Nuevo mensaje de contacto" (notification) and
 *      "Recibimos tu mensaje" (auto-reply). The English section
 *      keeps the original "New contact form submission" /
 *      "We received your message" headings.
 *
 *   3. **Regex invariants** (locked by the spec, design §12):
 *      the rendered HTML does NOT match `/<style\b/i`, does NOT
 *      contain `display: flex`, `display: grid`,
 *      `position: absolute`, `position: fixed`, or `@font-face`.
 *      These assertions are the unit-level executable
 *      contract for the vanilla-HTML design decision.
 *
 *   4. **Plain-text fallbacks**: every render path returns a
 *      non-empty `text` variant. The plain-text output mirrors
 *      the HTML structure: Spanish section first, English
 *      section second, separated by a "----------" divider.
 *      The auto-reply Spanish section contains the locked
 *      Spanish phrase
 *      `Recibimos tu mensaje, te contactaremos por email en breve.`
 *      The owner-notification Spanish section starts with the
 *      literal `Nuevo mensaje de contacto` and the English
 *      section starts with the literal
 *      `New contact form submission`.
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

	it("contains a Spanish section with the 'Nuevo mensaje de contacto' heading", () => {
		expect(html).toContain("Nuevo mensaje de contacto");
	});

	it("contains an English section with the 'New contact form submission' heading", () => {
		expect(html).toContain("New contact form submission");
	});

	it("contains a Spanish 'De:' label and an English 'From:' label", () => {
		expect(html).toContain("<strong>De:</strong>");
		expect(html).toContain("<strong>From:</strong>");
	});

	it("contains a Spanish 'Asunto:' label and an English 'Subject:' label", () => {
		expect(html).toContain("<strong>Asunto:</strong>");
		expect(html).toContain("<strong>Subject:</strong>");
	});

	it("renders the Spanish section BEFORE the English section", () => {
		const esIndex = html.indexOf("Nuevo mensaje de contacto");
		const enIndex = html.indexOf("New contact form submission");
		expect(esIndex).toBeGreaterThanOrEqual(0);
		expect(enIndex).toBeGreaterThan(esIndex);
	});
});

describe("renderContactNotificationText", () => {
	const text = renderContactNotificationText(SAMPLE_ROW);

	it("is non-empty (plain-text fallback is always present)", () => {
		expect(typeof text).toBe("string");
		expect(text.length).toBeGreaterThan(0);
	});

	it("starts with the Spanish section 'Nuevo mensaje de contacto'", () => {
		expect(text.startsWith("Nuevo mensaje de contacto")).toBe(true);
	});

	it("contains the English section 'New contact form submission'", () => {
		expect(text).toContain("New contact form submission");
	});

	it("contains Spanish 'De:' / 'Asunto:' and English 'From:' / 'Subject:' labels", () => {
		expect(text).toContain("De:");
		expect(text).toContain("Asunto:");
		expect(text).toContain("From:");
		expect(text).toContain("Subject:");
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

	it("contains a Spanish section with the 'Recibimos tu mensaje' heading", () => {
		expect(html).toContain("Recibimos tu mensaje");
	});

	it("contains an English section with the 'We received your message' heading", () => {
		expect(html).toContain("We received your message");
	});

	it("contains a Spanish 'Hola' greeting and an English 'Hi' greeting", () => {
		expect(html).toMatch(/Hola\s+Maria Lopez/);
		expect(html).toMatch(/Hi\s+Maria Lopez/);
	});

	it("renders the Spanish section BEFORE the English section", () => {
		const esIndex = html.indexOf("Recibimos tu mensaje");
		const enIndex = html.indexOf("We received your message");
		expect(esIndex).toBeGreaterThanOrEqual(0);
		expect(enIndex).toBeGreaterThan(esIndex);
	});
});

describe("renderContactAutoReplyText", () => {
	const text = renderContactAutoReplyText(SAMPLE_ROW);

	it("is non-empty (plain-text fallback is always present)", () => {
		expect(typeof text).toBe("string");
		expect(text.length).toBeGreaterThan(0);
	});

	it("starts with the Spanish section heading 'Recibimos tu mensaje'", () => {
		expect(text.startsWith("Recibimos tu mensaje")).toBe(true);
	});

	it("contains the locked Spanish copy: 'Recibimos tu mensaje, te contactaremos por email en breve.'", () => {
		expect(text).toContain(
			"Recibimos tu mensaje, te contactaremos por email en breve.",
		);
	});

	it("contains the English section heading 'We received your message'", () => {
		expect(text).toContain("We received your message");
	});

	it("contains a Spanish 'Hola' greeting and an English 'Hi' greeting", () => {
		expect(text).toMatch(/Hola\s+Maria Lopez/);
		expect(text).toMatch(/Hi\s+Maria Lopez/);
	});

	it("substitutes the row's name", () => {
		expect(text).toContain("Maria Lopez");
		expect(text).not.toContain("{{name}}");
	});

	it("does NOT contain any unsubstituted placeholders", () => {
		expect(text).not.toMatch(/{{/);
	});
});
