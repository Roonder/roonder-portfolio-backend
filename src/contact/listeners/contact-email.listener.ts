import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";
import { ContactEntity } from "../entities/contact.entity";
import { EmailService } from "../email/email.service";
import { ContactCreatedEvent } from "../events/contact-created.event";

/**
 * Async listener for the `contact.created` event.
 *
 * Wired in `ContactModule` (T9.1) and registered against the
 * global `EventEmitter2` bus (from `EventEmitterModule.forRoot()`
 * in `AppModule`). The `@OnEvent("contact.created", { async: true })`
 * decorator dispatches the event asynchronously — the HTTP
 * request returns 201 BEFORE the listener runs.
 *
 * Behavior:
 *
 *   1. Re-read the contact row by id (do NOT trust the event
 *      payload for anything other than the id; this is the
 *      design §9.1 invariant — the row may have changed between
 *      `create` and the async dispatch).
 *
 *   2. If the row is missing (deleted between create and
 *      dispatch), log a warning and bail. No email sent.
 *      The `EmailService.sendContactNotification` /
 *      `sendContactAutoReply` methods are NOT invoked in this
 *      case.
 *
 *   3. Otherwise, call `sendContactNotification(row)` followed by
 *      `sendContactAutoReply(row)`. The two sends are sequential
 *      (await in order). Both methods are themselves
 *      non-throwing (the `EmailService.send()` private helper
 *      catches any Resend exception and writes a `failed`
 *      `sent_emails` row) — so this listener also never rethrows
 *      a Resend failure to the event bus.
 */
@Injectable()
export class ContactEmailListener {
	private readonly logger = new Logger(ContactEmailListener.name);

	constructor(
		@InjectRepository(ContactEntity)
		private readonly contacts: Repository<ContactEntity>,
		private readonly emailService: EmailService,
	) {}

	@OnEvent("contact.created", { async: true })
	async handleContactCreated(event: ContactCreatedEvent): Promise<void> {
		const row = await this.contacts.findOne({
			where: { id: event.contactId },
		});
		if (!row) {
			this.logger.warn(
				`ContactCreatedEvent for missing id=${event.contactId}; skipping dispatch.`,
			);
			return;
		}
		await this.emailService.sendContactNotification(row);
		await this.emailService.sendContactAutoReply(row);
	}
}
