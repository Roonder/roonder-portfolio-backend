import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { NotFoundException } from "@nestjs/common";
import { ContactService } from "./contact.service";
import { ContactEntity } from "./entities/contact.entity";
import { SentEmailEntity } from "./entities/sent-email.entity";
import { ContactCreatedEvent } from "./events/contact-created.event";
import { CreateContactDto } from "./dto/create-contact.dto";
import { CONTACT_STATUS } from "./dto/update-contact-status.dto";

/**
 * Real spec for `ContactService`. REPLACES the previous smoke
 * `toBeDefined()` spec. The contact service is the only
 * orchestrator of the contact domain: it persists via the
 * `ContactRepository`, emits `ContactCreatedEvent` for the
 * async email dispatch, and serves the admin list + status
 * transition paths.
 *
 * Test surface (3 method areas):
 *   1. `create(dto)` — persists with `status: 'pending'`,
 *      emits `ContactCreatedEvent(contactId, recipientEmail)`,
 *      returns the response DTO shape.
 *   2. `findAllForAdmin(query)` — paginated list, ordered
 *      `created_at DESC`, returns the `{ data, total, page, pageSize }`
 *      envelope. Silently clamps `pageSize > 100`.
 *   3. `updateStatus(id, dto)` — reads the row, mutates the
 *      status, saves, returns the response DTO. 404 on missing
 *      id.
 *
 * The `SentEmailEntity` repository is forward-declared in the
 * constructor but not exercised in this commit (the email
 * pipeline lands in a later task).
 */

type ContactRow = {
	id: string;
	name: string;
	email: string;
	subject: string | null;
	message: string;
	status: string;
	createdAt: Date;
	updatedAt: Date;
};

function makeRow(overrides: Partial<ContactRow> = {}): ContactRow {
	return {
		id: "11111111-2222-3333-4444-555555555555",
		name: "Maria Lopez",
		email: "maria@example.com",
		subject: "Question",
		message: "Hello",
		status: CONTACT_STATUS.PENDING,
		createdAt: new Date("2026-06-19T10:00:00.000Z"),
		updatedAt: new Date("2026-06-19T10:00:00.000Z"),
		...overrides,
	};
}

interface ContactRepoFake {
	create: jest.Mock;
	save: jest.Mock;
	findOne: jest.Mock;
	findAndCount: jest.Mock;
	createQueryBuilder: jest.Mock;
}

function buildContactRepoFake(): ContactRepoFake {
	return {
		create: jest.fn((data: Partial<ContactRow>) => ({
			...makeRow(),
			...data,
		})),
		save: jest.fn((row: ContactRow) => Promise.resolve(row)),
		findOne: jest.fn(),
		findAndCount: jest.fn(() => Promise.resolve([[], 0])),
		createQueryBuilder: jest.fn(),
	};
}

interface EventEmitterFake {
	emit: jest.Mock;
	on: jest.Mock;
	off: jest.Mock;
	removeListener: jest.Mock;
}

function buildEventEmitterFake(): EventEmitterFake {
	return {
		emit: jest.fn(),
		on: jest.fn(),
		off: jest.fn(),
		removeListener: jest.fn(),
	};
}

describe("ContactService", () => {
	let service: ContactService;
	let contacts: ContactRepoFake;
	let sentEmails: ContactRepoFake;
	let eventEmitter: EventEmitterFake;

	beforeEach(async () => {
		contacts = buildContactRepoFake();
		sentEmails = buildContactRepoFake();
		eventEmitter = buildEventEmitterFake();

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ContactService,
				{
					provide: getRepositoryToken(ContactEntity),
					useValue: contacts,
				},
				{
					provide: getRepositoryToken(SentEmailEntity),
					useValue: sentEmails,
				},
				{
					provide: EventEmitter2,
					useValue: eventEmitter,
				},
			],
		}).compile();

		service = module.get<ContactService>(ContactService);
	});

	describe("create", () => {
		const dto: CreateContactDto = {
			name: "Maria Lopez",
			email: "maria@example.com",
			subject: "Question about pricing",
			message: "Hi, I would like to know more about the project rate.",
		};

		it("persists the row with status locked to 'pending' (the public submission contract)", async () => {
			await service.create(dto);
			expect(contacts.create).toHaveBeenCalledTimes(1);
			expect(contacts.create).toHaveBeenCalledWith({
				...dto,
				status: CONTACT_STATUS.PENDING,
			});
		});

		it("saves the row through the repository", async () => {
			await service.create(dto);
			expect(contacts.save).toHaveBeenCalledTimes(1);
		});

		it("emits ContactCreatedEvent with the persisted id + recipient email", async () => {
			contacts.save.mockResolvedValueOnce({
				...makeRow(),
				id: "abc-1",
				email: "maria@example.com",
			});
			await service.create(dto);
			expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
			const call = eventEmitter.emit.mock.calls[0] as [
				string,
				ContactCreatedEvent,
			];
			expect(call[0]).toBe("contact.created");
			expect(call[1]).toBeInstanceOf(ContactCreatedEvent);
			expect(call[1].contactId).toBe("abc-1");
			expect(call[1].recipientEmail).toBe("maria@example.com");
		});

		it("returns the response DTO shape (8 fields, mapped via toContactResponse)", async () => {
			const savedRow = makeRow({
				id: "abc-1",
				status: CONTACT_STATUS.PENDING,
			});
			contacts.save.mockResolvedValueOnce(savedRow);
			const out = await service.create(dto);
			expect(out).toEqual({
				id: "abc-1",
				name: savedRow.name,
				email: savedRow.email,
				subject: savedRow.subject,
				message: savedRow.message,
				status: CONTACT_STATUS.PENDING,
				createdAt: savedRow.createdAt,
				updatedAt: savedRow.updatedAt,
			});
		});

		it("does NOT include an emailSentLog field on the returned DTO (destructive change)", async () => {
			const out = await service.create(dto);
			expect("emailSentLog" in out).toBe(false);
		});
	});

	describe("findAllForAdmin", () => {
		it("returns the canonical envelope { data, total, page, pageSize } with default pagination", async () => {
			contacts.createQueryBuilder.mockReturnValueOnce({
				orderBy: jest.fn().mockReturnThis(),
				skip: jest.fn().mockReturnThis(),
				take: jest.fn().mockReturnThis(),
				getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
			});
			const out = await service.findAllForAdmin({});
			expect(out).toEqual({
				data: [],
				total: 0,
				page: 1,
				pageSize: 20,
			});
		});

		it("respects explicit page + pageSize", async () => {
			const qb = {
				orderBy: jest.fn().mockReturnThis(),
				skip: jest.fn().mockReturnThis(),
				take: jest.fn().mockReturnThis(),
				getManyAndCount: jest.fn(() =>
					Promise.resolve([[makeRow()], 1]),
				),
			};
			contacts.createQueryBuilder.mockReturnValueOnce(qb);
			const out = await service.findAllForAdmin({
				page: 2,
				pageSize: 5,
			});
			expect(qb.skip).toHaveBeenCalledWith(5);
			expect(qb.take).toHaveBeenCalledWith(5);
			expect(out.page).toBe(2);
			expect(out.pageSize).toBe(5);
		});

		it("orders by created_at DESC (admin sees the newest first)", async () => {
			const qb = {
				orderBy: jest.fn().mockReturnThis(),
				skip: jest.fn().mockReturnThis(),
				take: jest.fn().mockReturnThis(),
				getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
			};
			contacts.createQueryBuilder.mockReturnValueOnce(qb);
			await service.findAllForAdmin({});
			expect(qb.orderBy).toHaveBeenCalledWith(
				"contact.created_at",
				"DESC",
			);
		});

		it("silently clamps pageSize > 100 to 100", async () => {
			const qb = {
				orderBy: jest.fn().mockReturnThis(),
				skip: jest.fn().mockReturnThis(),
				take: jest.fn().mockReturnThis(),
				getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
			};
			contacts.createQueryBuilder.mockReturnValueOnce(qb);
			const out = await service.findAllForAdmin({
				pageSize: 500,
			});
			expect(qb.take).toHaveBeenCalledWith(100);
			expect(out.pageSize).toBe(100);
		});
	});

	describe("updateStatus", () => {
		it("transitions a contact to 'read' and returns the response DTO", async () => {
			const row = makeRow({ status: CONTACT_STATUS.PENDING });
			contacts.findOne.mockResolvedValueOnce(row);
			contacts.save.mockResolvedValueOnce({
				...row,
				status: CONTACT_STATUS.READ,
			});
			const out = await service.updateStatus(row.id, {
				status: CONTACT_STATUS.READ,
			});
			expect(out.status).toBe(CONTACT_STATUS.READ);
			expect(contacts.save).toHaveBeenCalledTimes(1);
		});

		it("transitions a contact to 'replied'", async () => {
			const row = makeRow({ status: CONTACT_STATUS.READ });
			contacts.findOne.mockResolvedValueOnce(row);
			contacts.save.mockResolvedValueOnce({
				...row,
				status: CONTACT_STATUS.REPLIED,
			});
			const out = await service.updateStatus(row.id, {
				status: CONTACT_STATUS.REPLIED,
			});
			expect(out.status).toBe(CONTACT_STATUS.REPLIED);
		});

		it("throws NotFoundException when the contact id does not exist", async () => {
			contacts.findOne.mockResolvedValueOnce(null);
			await expect(
				service.updateStatus("missing-id", {
					status: CONTACT_STATUS.READ,
				}),
			).rejects.toBeInstanceOf(NotFoundException);
		});
	});
});
