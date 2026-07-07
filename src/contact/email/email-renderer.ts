import {
	CONTACT_AUTO_REPLY_HTML,
	CONTACT_AUTO_REPLY_TEXT,
	CONTACT_NOTIFICATION_HTML,
	CONTACT_NOTIFICATION_TEXT,
} from "./email-template";
import type { ContactEntity } from "../entities/contact.entity";

/**
 * Pure `{{placeholder}}` substitution for the contact email
 * templates. The renderers consume a `ContactEntity`-shaped
 * object and return a string. No DI, no side effects, no
 * Resend SDK.
 *
 * Substitution is a single-pass `String#replaceAll` of the 4
 * tokens defined in `email-template.ts`:
 *
 *   `{{name}}`     → row.name
 *   `{{email}}`    → row.email
 *   `{{subject}}`  → row.subject
 *   `{{message}}`  → row.message
 *
 * The auto-reply template does NOT have a `{{subject}}`
 * placeholder, so the substitution helper is harmless on that
 * template (the token is simply not present).
 *
 * The regex invariants on the rendered output (no `<style>`
 * block, no `display: flex/grid`, no `position: absolute/fixed`,
 * no `@font-face`) are asserted in `email-renderer.spec.ts`.
 * Those invariants are inherited from the template constants;
 * the renderers do NOT mutate the template structure.
 */

interface ContactLike {
	name: string;
	email: string;
	subject: string | null;
	message: string;
}

function substitute(template: string, row: ContactLike): string {
	return template
		.replaceAll("{{name}}", row.name)
		.replaceAll("{{email}}", row.email)
		.replaceAll("{{subject}}", row.subject ?? "")
		.replaceAll("{{message}}", row.message);
}

/**
 * Renders the owner-notification HTML body for a given contact
 * row. Called by `EmailService.sendContactNotification`.
 */
export function renderContactNotificationHtml(
	row: ContactEntity | ContactLike,
): string {
	return substitute(CONTACT_NOTIFICATION_HTML, row);
}

/**
 * Renders the owner-notification plain-text body. Always
 * non-empty; starts with the literal
 * "New contact form submission".
 */
export function renderContactNotificationText(
	row: ContactEntity | ContactLike,
): string {
	return substitute(CONTACT_NOTIFICATION_TEXT, row);
}

/**
 * Renders the visitor auto-reply HTML body. Called by
 * `EmailService.sendContactAutoReply`.
 */
export function renderContactAutoReplyHtml(
	row: ContactEntity | ContactLike,
): string {
	return substitute(CONTACT_AUTO_REPLY_HTML, row);
}

/**
 * Renders the visitor auto-reply plain-text body. The locked
 * Spanish phrase
 * `Recibimos tu mensaje, te contactaremos por email en breve.`
 * is part of the substituted output (the template embeds the
 * literal Spanish copy; the renderers substitute `{{name}}`
 * only).
 */
export function renderContactAutoReplyText(
	row: ContactEntity | ContactLike,
): string {
	return substitute(CONTACT_AUTO_REPLY_TEXT, row);
}
