/**
 * Event payload emitted by `ContactService.create` after a contact
 * row is persisted. The event is consumed asynchronously by
 * `ContactEmailListener` (`@OnEvent("contact.created", { async: true })`).
 *
 * The payload is intentionally minimal — just the id (so the
 * listener can `findOne` the row fresh and get the latest persisted
 * state in case anything changed between `create` and the async
 * dispatch) and the recipient email (so the listener doesn't need
 * to re-read the row to know where to send the auto-reply).
 *
 * The class is a plain data carrier with two readonly fields. No
 * methods, no DI. The contact-domain listener is the sole consumer.
 */
export class ContactCreatedEvent {
	constructor(
		public readonly contactId: string,
		public readonly recipientEmail: string,
	) {}
}
