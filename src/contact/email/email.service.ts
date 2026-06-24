import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import type { Resend } from "resend";
import { SentEmailEntity } from "../entities/sent-email.entity";
import type { ContactEntity } from "../entities/contact.entity";
import {
	renderContactAutoReplyHtml,
	renderContactAutoReplyText,
	renderContactNotificationHtml,
	renderContactNotificationText,
} from "./email-renderer";
import { RESEND_CLIENT } from "./resend-client.token";

/**
 * Resend wrapper for the contact domain.
 *
 * Public surface (2 methods):
 *
 *   - `sendContactNotification(row)` — sends the owner-notification
 *     email to `RESEND_TO_ADDRESS`. Subject is locked to
 *     `"New contact form submission: <row.subject>"`. `replyTo` is
 *     the visitor's email. `headers.X-Contact-Id` is the row's id.
 *
 *   - `sendContactAutoReply(row)` — sends the auto-reply email to
 *     the visitor's email. Subject is locked to
 *     `"We received your message"`.
 *
 * **NEVER throws on Resend failure.** This is the locked user
 * decision #7 (proposal §6, design §8). The private `send()`
 * helper catches any thrown exception (network errors,
 * unhandled rejections) and writes a `sent_emails` row with
 * `status = failed` + the error message. The HTTP 201 response
 * to the public POST is NEVER affected by a Resend failure
 * (verified end-to-end in `test/contact.e2e-spec.ts` T11.1).
 *
 * The `Resend` client is constructor-injected via the
 * `RESEND_CLIENT` symbol token — NOT directly imported. This
 * makes the unit spec's fake trivial (just provide
 * `{ provide: RESEND_CLIENT, useValue: fakeResend }`) and
 * keeps the `Resend` SDK out of the unit test path.
 *
 * The 2 enums (`SENT_EMAIL_STATUS`, `SENT_EMAIL_KIND`) are
 * declared in `src/contact/entities/sent-email.entity.ts` (where
 * the entity's `@Column({ enum })` references them) and re-used
 * here so the runtime + the entity stay in sync via one source
 * of truth.
 */
@Injectable()
export class EmailService {
	private readonly logger = new Logger(EmailService.name);

	constructor(
		@Inject(RESEND_CLIENT)
		private readonly resend: Resend,
		@InjectRepository(SentEmailEntity)
		private readonly sentEmails: Repository<SentEmailEntity>,
	) {}

	/**
	 * Sends the owner notification. Subject is the dual-language
	 * locked string `"Nuevo contacto / New contact: <subject>"` —
	 * the row's `subject` is included so the operator can triage
	 * at a glance, and the bilingual prefix signals that the body
	 * is also bilingual.
	 */
	async sendContactNotification(contact: ContactEntity): Promise<void> {
		await this.send({
			from: process.env["RESEND_FROM_ADDRESS"] as string,
			to: process.env["RESEND_TO_ADDRESS"] as string,
			subject: `Nuevo contacto / New contact: ${contact.subject ?? ""}`,
			html: renderContactNotificationHtml(contact),
			text: renderContactNotificationText(contact),
			replyTo: contact.email,
			headers: { "X-Contact-Id": contact.id },
			kind: "contact_notification",
		});
	}

	/**
	 * Sends the visitor auto-reply. Subject is the dual-language
	 * locked string `"Recibimos tu mensaje / We received your
	 * message"` (no `{{subject}}` placeholder is involved on the
	 * auto-reply template).
	 */
	async sendContactAutoReply(contact: ContactEntity): Promise<void> {
		await this.send({
			from: process.env["RESEND_FROM_ADDRESS"] as string,
			to: contact.email,
			subject: "Recibimos tu mensaje / We received your message",
			html: renderContactAutoReplyHtml(contact),
			text: renderContactAutoReplyText(contact),
			kind: "contact_auto_reply",
		});
	}

	/**
	 * Non-throwing send. Catches any thrown exception (network,
	 * SDK reject) and writes a `sent_emails` row with the error
	 * message.
	 */
	private async send(input: {
		from: string;
		to: string;
		subject: string;
		html: string;
		text: string;
		replyTo?: string;
		headers?: Record<string, string>;
		kind: "contact_notification" | "contact_auto_reply";
	}): Promise<void> {
		try {
			const { data, error } = await this.resend.emails.send({
				from: input.from,
				to: [input.to],
				subject: input.subject,
				html: input.html,
				text: input.text,
				replyTo: input.replyTo,
				headers: input.headers,
				tags: [{ name: "domain", value: "contact-form" }],
			});
			if (error || !data) {
				await this.sentEmails.save(
					this.sentEmails.create({
						subject: input.subject,
						from: input.from,
						to: input.to,
						resendId: null,
						status: "failed",
						kind: input.kind,
						errorMessage: error?.message ?? "unknown Resend error",
					}),
				);
				return;
			}
			await this.sentEmails.save(
				this.sentEmails.create({
					subject: input.subject,
					from: input.from,
					to: input.to,
					resendId: data.id,
					status: "accepted",
					kind: input.kind,
					errorMessage: null,
				}),
			);
		} catch (e) {
			// Defensive: the SDK normally resolves with { data, error };
			// a thrown exception here is a network or runtime error.
			const message = e instanceof Error ? e.message : "unknown error";
			await this.sentEmails.save(
				this.sentEmails.create({
					subject: input.subject,
					from: input.from,
					to: input.to,
					resendId: null,
					status: "failed",
					kind: input.kind,
					errorMessage: message,
				}),
			);
			this.logger.error(`Email send threw: ${message}`);
		}
	}
}
