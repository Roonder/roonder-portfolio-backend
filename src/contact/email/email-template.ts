/**
 * Vanilla email templates for the contact domain.
 *
 * Two HTML bodies (one per `kind`) and two plain-text fallbacks.
 * The HTML is XHTML 1.0 Transitional, table-based, inline-styled,
 * with NO `<style>` block, NO `display: flex/grid`, NO
 * `position: absolute/fixed`, NO `@font-face`, NO `vh/vw`, NO
 * `transform/transition/animation` — see the regex invariants
 * asserted in `src/contact/email/email-renderer.spec.ts` (T7.3).
 *
 * **Dual-language layout** (post-verify refinement 2026-06-24):
 * every email body is rendered as TWO sections — a Spanish
 * section first, an English section second — separated by a
 * thin visual divider (`<hr style="border:none;border-top:1px
 * solid #e5e5e5;...">` in HTML, a `----------` line in plain
 * text). The Spanish section is the primary version; the
 * English section mirrors the same data in English. This
 * lets the visitor (or the operator) read whichever language
 * is convenient without losing the canonical copy on the
 * other side. The minimalist design (1 inline `border-top`,
 * no background colors, no icons) keeps the two sections
 * scannable at a glance.
 *
 * The 4 `{{placeholder}}` tokens are substituted by the
 * renderers in `src/contact/email/email-renderer.ts`:
 *
 *   - `{{name}}`    — the contact row's `name` field
 *   - `{{email}}`   — the contact row's `email` field
 *   - `{{subject}}` — the contact row's `subject` field
 *   - `{{message}}` — the contact row's `message` field
 *
 * The auto-reply templates do NOT have a `{{subject}}`
 * placeholder (the auto-reply subject is locked at the
 * EmailService layer).
 *
 * The Spanish copy in the auto-reply
 * (`Recibimos tu mensaje, te contactaremos por email en breve.`)
 * is locked by the spec — see the assertion in
 * `email-renderer.spec.ts`.
 */

// ---------------------------------------------------------------------------
// Owner notification (sent to RESEND_TO_ADDRESS)
// ---------------------------------------------------------------------------

export const CONTACT_NOTIFICATION_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Nuevo mensaje de contacto / New contact form submission</title>
	</head>
	<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#222;">
		<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;">
			<tr>
				<td align="center" style="padding:24px 12px;">
					<table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e5e5e5;">
						<tr>
							<td style="padding:24px 24px 8px 24px;">
								<h1 style="margin:0 0 16px 0;font-size:20px;line-height:24px;font-weight:bold;color:#111;">Nuevo mensaje de contacto</h1>
								<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;"><strong>De:</strong> {{name}} &lt;{{email}}&gt;</p>
								<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;"><strong>Asunto:</strong> {{subject}}</p>
								<p style="margin:16px 0 0 0;font-size:14px;line-height:20px;white-space:pre-wrap;">{{message}}</p>
							</td>
						</tr>
						<tr>
							<td style="padding:0 24px;">
								<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;" />
							</td>
						</tr>
						<tr>
							<td style="padding:8px 24px 24px 24px;">
								<h1 style="margin:0 0 16px 0;font-size:20px;line-height:24px;font-weight:bold;color:#111;">New contact form submission</h1>
								<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;"><strong>From:</strong> {{name}} &lt;{{email}}&gt;</p>
								<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;"><strong>Subject:</strong> {{subject}}</p>
								<p style="margin:16px 0 0 0;font-size:14px;line-height:20px;white-space:pre-wrap;">{{message}}</p>
							</td>
						</tr>
						<tr>
							<td style="padding:8px 24px 24px 24px;border-top:1px solid #e5e5e5;">
								<p style="margin:0;font-size:12px;line-height:16px;color:#666;">Enviado desde el formulario de contacto del portfolio. / Submitted via the portfolio contact form.</p>
								<p style="margin:8px 0 0 0;font-size:12px;line-height:16px;color:#666;">Responde este email para contactar a {{name}}. / Reply directly to this email to respond to {{name}}.</p>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`;

// ---------------------------------------------------------------------------
// Visitor auto-reply (sent to the submitter's email)
// ---------------------------------------------------------------------------

export const CONTACT_AUTO_REPLY_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Recibimos tu mensaje / We received your message</title>
	</head>
	<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#222;">
		<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f5f5f5;">
			<tr>
				<td align="center" style="padding:24px 12px;">
					<table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e5e5e5;">
						<tr>
							<td style="padding:24px 24px 8px 24px;">
								<h1 style="margin:0 0 16px 0;font-size:20px;line-height:24px;font-weight:bold;color:#111;">Recibimos tu mensaje</h1>
								<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;">Hola {{name}},</p>
								<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;">Recibimos tu mensaje, te contactaremos por email en breve.</p>
							</td>
						</tr>
						<tr>
							<td style="padding:0 24px;">
								<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;" />
							</td>
						</tr>
						<tr>
							<td style="padding:8px 24px 24px 24px;">
								<h1 style="margin:0 0 16px 0;font-size:20px;line-height:24px;font-weight:bold;color:#111;">We received your message</h1>
								<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;">Hi {{name}},</p>
								<p style="margin:0 0 12px 0;font-size:14px;line-height:20px;">We received your message and will get back to you by email shortly.</p>
							</td>
						</tr>
						<tr>
							<td style="padding:8px 24px 24px 24px;border-top:1px solid #e5e5e5;">
								<p style="margin:0;font-size:12px;line-height:16px;color:#666;">Roonder Portfolio / Roonder Portfolio</p>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>`;

// ---------------------------------------------------------------------------
// Plain-text fallbacks (Spanish section, then divider, then English section)
// ---------------------------------------------------------------------------

export const CONTACT_NOTIFICATION_TEXT = `Nuevo mensaje de contacto

De:    {{name}} <{{email}}>
Asunto: {{subject}}

{{message}}

----------
New contact form submission

From:    {{name}} <{{email}}>
Subject: {{subject}}

{{message}}

---
Enviado desde el formulario de contacto del portfolio. / Submitted via the portfolio contact form.
Responde este email para contactar a {{name}}. / Reply directly to this email to respond to {{name}}.`;

export const CONTACT_AUTO_REPLY_TEXT = `Recibimos tu mensaje

Hola {{name}},

Recibimos tu mensaje, te contactaremos por email en breve.

----------
We received your message

Hi {{name}},

We received your message and will get back to you by email shortly.

---
Roonder Portfolio / Roonder Portfolio`;
