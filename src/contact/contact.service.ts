import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ContactEntity } from "./entities/contact.entity";
import { SentEmailEntity } from "./entities/sent-email.entity";
import { CreateContactDto } from "./dto/create-contact.dto";
import { ListContactsQueryDto } from "./dto/list-contacts-query.dto";
import { ListContactsResult } from "./dto/list-contacts-response.dto";
import { UpdateContactStatusDto } from "./dto/update-contact-status.dto";
import { ContactCreatedEvent } from "./events/contact-created.event";
import { toContactResponse } from "./contact.mapper";

/**
 * Contact domain service.
 *
 * `create` (T4.2): persists a new `ContactEntity` with
 * `status: 'pending'` (the public submission contract — no
 * contact is ever created with a non-pending status, per the
 * spec scenario "Valid body persists a contact and returns 201").
 * After the row is saved, the service emits a
 * `ContactCreatedEvent` (via the injected `EventEmitter2`) for
 * the async `ContactEmailListener` to consume. The event is
 * dispatched asynchronously; the controller returns 201 before
 * the listener runs.
 *
 * `findAllForAdmin` (T4.3): paginated list of ALL contacts
 * (no approval filter, unlike reviews — every contact is
 * visible to the admin), ordered by `created_at DESC`. The
 * page-size cap is `@Max(100)` at the DTO (wire-level) and
 * `Math.min(query.pageSize ?? 20, 100)` at the service
 * (silent-clamp, in case a future DTO bypass).
 *
 * `updateStatus` (T4.3): reads the row, mutates the `status`
 * field, saves, and returns the response DTO. Throws
 * `NotFoundException` on a missing id (existence-leak guard
 * — same pattern as the reviews domain).
 *
 * The `SentEmailEntity` repository is forward-injected
 * (constructor signature is stable from T4.2 onward) so the
 * email pipeline tasks (T7.4) can extend the same class
 * without DI churn.
 */
@Injectable()
export class ContactService {
	constructor(
		@InjectRepository(ContactEntity)
		private readonly contacts: Repository<ContactEntity>,
		@InjectRepository(SentEmailEntity)
		private readonly sentEmails: Repository<SentEmailEntity>,
		private readonly eventEmitter: EventEmitter2,
	) {}

	// --- T4.2: write path -----------------------------------------------

	/**
	 * `POST /api/v1/contacts` — public create. Persists the row
	 * with `status: 'pending'` regardless of the DTO contents
	 * (the public submission contract; locked #1). The
	 * `SentEmailEntity` repository is injected but not used in
	 * this commit — the email pipeline lands in T7.4. The
	 * `EventEmitter2` injection is required for the
	 * `ContactCreatedEvent` emission; the listener
	 * (`ContactEmailListener`, T8.1) is registered in a later
	 * task and the event currently has no consumer in this
	 * commit. Returns the response DTO via `toContactResponse`.
	 */
	async create(
		dto: CreateContactDto,
	): Promise<ReturnType<typeof toContactResponse>> {
		const row = this.contacts.create({
			name: dto.name,
			email: dto.email,
			subject: dto.subject,
			message: dto.message,
			status: "pending",
		});
		const saved = await this.contacts.save(row);
		this.eventEmitter.emit(
			"contact.created",
			new ContactCreatedEvent(saved.id, saved.email),
		);
		return toContactResponse(saved);
	}

	// --- T4.3: admin list -----------------------------------------------

	/**
	 * `GET /api/v1/admin/contacts` — paginated admin list, all
	 * contacts (no approval filter, unlike reviews). The query
	 * builder is used so the response is a single
	 * `getManyAndCount()` round-trip; the `data` array is
	 * mapped via `toContactResponse`. `pageSize > 100` is
	 * silently clamped (mirror `findAllApproved` in reviews).
	 */
	async findAllForAdmin(
		query: ListContactsQueryDto,
	): Promise<ListContactsResult> {
		const page = query.page ?? 1;
		const pageSize = Math.min(query.pageSize ?? 20, 100);

		const qb = this.contacts
			.createQueryBuilder("contact")
			.orderBy("contact.created_at", "DESC")
			.skip((page - 1) * pageSize)
			.take(pageSize);

		const [rows, total] = await qb.getManyAndCount();
		return {
			data: rows.map(toContactResponse),
			total,
			page,
			pageSize,
		};
	}

	// --- T4.3: admin status transition ----------------------------------

	/**
	 * `PATCH /api/v1/admin/contacts/:id` — transitions the
	 * `status` field. Reads the current row, mutates, saves,
	 * and returns the response DTO via `toContactResponse`.
	 * 404 on a missing id (existence-leak guard, mirrors
	 * reviews' `toggleApproval` and `remove`).
	 */
	async updateStatus(
		id: string,
		dto: UpdateContactStatusDto,
	): Promise<ReturnType<typeof toContactResponse>> {
		const row = await this.contacts.findOne({ where: { id } });
		if (!row) {
			throw new NotFoundException("Contact not found");
		}
		row.status = dto.status;
		const saved = await this.contacts.save(row);
		return toContactResponse(saved);
	}
}
