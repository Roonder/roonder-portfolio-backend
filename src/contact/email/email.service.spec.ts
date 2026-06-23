import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { SentEmailEntity } from "../entities/sent-email.entity";
import { ContactEntity } from "../entities/contact.entity";
import { EmailService } from "./email.service";
import { RESEND_CLIENT } from "./resend-client.token";

/**
 * Spec for the `EmailService` Resend wrapper.
 *
 * The `Resend` SDK is NEVER called in this suite — a fake is
 * injected via the `RESEND_CLIENT` symbol token. The
 * `SentEmailEntity` repository is replaced with a
 * `Map`-backed in-memory fake that exposes the same surface
 * the production `Repository<SentEmailEntity>` does
 * (`create`, `save`).
 *
 * Test categories:
 *
 *   1. **Successful send** (`accepted` row): `Resend` returns
 *      `{ data: { id: "abc" } }` → the service writes a
 *      `sent_emails` row with `status = accepted`,
 *      `resendId = "abc"`, `errorMessage = null`,
 *      `kind = contact_notification` (or `contact_auto_reply`).
 *
 *   2. **Failed send via { error }** (`failed` row): `Resend`
 *      returns `{ data: null, error: { name, message } }` →
 *      the service writes a `sent_emails` row with
 *      `status = failed`, `resendId = null`,
 *      `errorMessage = <error.message>`. **NEVER throws.**
 *
 *   3. **Network throw** (`failed` row): `Resend` rejects with
 *      an Error → the service catches it, writes a `failed` row
 *      with the thrown message, and DOES NOT rethrow.
 *
 *   4. **Subject + recipient + tag shape**:
 *      `sendContactNotification` uses
 *      `subject = "New contact form submission: <subject>"`,
 *      `to = RESEND_TO_ADDRESS`, `replyTo = contact.email`,
 *      `headers["X-Contact-Id"] = contact.id`, and the tag
 *      `{ name: "domain", value: "contact-form" }`.
 *      `sendContactAutoReply` uses the locked subject
 *      `"We received your message"` and `to = contact.email`.
 */
const CONTACT_ROW: ContactEntity = {
	id: "11111111-2222-3333-4444-555555555555",
	name: "Maria Lopez",
	email: "maria@example.com",
	subject: "Question about pricing",
	message: "Hi, I would like to know more about the project rate.",
	status: "pending",
	createdAt: new Date("2026-06-19T10:00:00.000Z"),
	updatedAt: new Date("2026-06-19T10:00:00.000Z"),
};

const FROM = "Roonder Portfolio <hello@roonder.dev>";
const TO = "admin@roonder.dev";

interface SentEmailRow {
	subject: string;
	from: string;
	to: string;
	resendId: string | null;
	status: "accepted" | "failed";
	kind: "contact_notification" | "contact_auto_reply";
	errorMessage: string | null;
}

interface SentEmailFake {
	create: jest.Mock;
	save: jest.Mock;
	rows: SentEmailRow[];
}

function buildSentEmailFake(): SentEmailFake {
	const rows: SentEmailRow[] = [];
	return {
		rows,
		create: jest.fn((data: SentEmailRow) => data),
		save: jest.fn((row: SentEmailRow) => {
			rows.push(row);
			return Promise.resolve(row);
		}),
	};
}

interface ResendEmailsFake {
	send: jest.Mock;
}

interface ResendFake {
	emails: ResendEmailsFake;
}

function buildResendFake(): ResendFake {
	return {
		emails: {
			send: jest.fn(),
		},
	};
}

describe("EmailService", () => {
	let service: EmailService;
	let resend: ResendFake;
	let sentEmails: SentEmailFake;
	let originalFrom: string | undefined;
	let originalTo: string | undefined;

	beforeEach(async () => {
		originalFrom = process.env.RESEND_FROM_ADDRESS;
		originalTo = process.env.RESEND_TO_ADDRESS;
		process.env.RESEND_FROM_ADDRESS = FROM;
		process.env.RESEND_TO_ADDRESS = TO;

		resend = buildResendFake();
		sentEmails = buildSentEmailFake();

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				EmailService,
				{
					provide: RESEND_CLIENT,
					useValue: resend,
				},
				{
					provide: getRepositoryToken(SentEmailEntity),
					useValue: sentEmails,
				},
			],
		}).compile();

		service = module.get<EmailService>(EmailService);
	});

	afterEach(() => {
		if (originalFrom === undefined) {
			delete process.env.RESEND_FROM_ADDRESS;
		} else {
			process.env.RESEND_FROM_ADDRESS = originalFrom;
		}
		if (originalTo === undefined) {
			delete process.env.RESEND_TO_ADDRESS;
		} else {
			process.env.RESEND_TO_ADDRESS = originalTo;
		}
	});

	describe("sendContactNotification", () => {
		it("calls Resend with the expected from / to / subject / replyTo / headers / tag", async () => {
			resend.emails.send.mockResolvedValueOnce({
				data: { id: "resend-1" },
				error: null,
				headers: null,
			});
			await service.sendContactNotification(CONTACT_ROW);
			expect(resend.emails.send).toHaveBeenCalledTimes(1);
			const call = resend.emails.send.mock.calls[0] as [
				Record<string, unknown>,
			];
			const payload = call[0];
			expect(payload["from"]).toBe(FROM);
			expect(payload["to"]).toEqual([TO]);
			expect(payload["subject"]).toBe(
				"New contact form submission: Question about pricing",
			);
			expect(payload["replyTo"]).toBe(CONTACT_ROW.email);
			expect(payload["headers"]).toEqual({
				"X-Contact-Id": CONTACT_ROW.id,
			});
			expect(payload["tags"]).toEqual([
				{ name: "domain", value: "contact-form" },
			]);
		});

		it("writes an 'accepted' sent_emails row on success with resendId populated", async () => {
			resend.emails.send.mockResolvedValueOnce({
				data: { id: "resend-1" },
				error: null,
				headers: null,
			});
			await service.sendContactNotification(CONTACT_ROW);
			expect(sentEmails.rows).toHaveLength(1);
			const row = sentEmails.rows[0];
			expect(row.status).toBe("accepted");
			expect(row.resendId).toBe("resend-1");
			expect(row.errorMessage).toBeNull();
			expect(row.kind).toBe("contact_notification");
		});

		it("writes a 'failed' sent_emails row when Resend returns { error } and does NOT throw", async () => {
			resend.emails.send.mockResolvedValueOnce({
				data: null,
				error: {
					name: "invalid_from_address",
					message: "Domain not verified",
					statusCode: 422,
				},
				headers: null,
			});
			await expect(
				service.sendContactNotification(CONTACT_ROW),
			).resolves.toBeUndefined();
			expect(sentEmails.rows).toHaveLength(1);
			const row = sentEmails.rows[0];
			expect(row.status).toBe("failed");
			expect(row.resendId).toBeNull();
			expect(row.errorMessage).toBe("Domain not verified");
			expect(row.kind).toBe("contact_notification");
		});

		it("writes a 'failed' sent_emails row when Resend throws and does NOT rethrow", async () => {
			resend.emails.send.mockRejectedValueOnce(
				new Error("Network unreachable"),
			);
			await expect(
				service.sendContactNotification(CONTACT_ROW),
			).resolves.toBeUndefined();
			expect(sentEmails.rows).toHaveLength(1);
			const row = sentEmails.rows[0];
			expect(row.status).toBe("failed");
			expect(row.resendId).toBeNull();
			expect(row.errorMessage).toBe("Network unreachable");
			expect(row.kind).toBe("contact_notification");
		});
	});

	describe("sendContactAutoReply", () => {
		it("sends to the visitor's email with the locked subject 'We received your message'", async () => {
			resend.emails.send.mockResolvedValueOnce({
				data: { id: "resend-2" },
				error: null,
				headers: null,
			});
			await service.sendContactAutoReply(CONTACT_ROW);
			const call = resend.emails.send.mock.calls[0] as [
				Record<string, unknown>,
			];
			const payload = call[0];
			expect(payload["to"]).toEqual([CONTACT_ROW.email]);
			expect(payload["subject"]).toBe("We received your message");
			expect(payload["from"]).toBe(FROM);
		});

		it("writes an 'accepted' sent_emails row with kind='contact_auto_reply'", async () => {
			resend.emails.send.mockResolvedValueOnce({
				data: { id: "resend-2" },
				error: null,
				headers: null,
			});
			await service.sendContactAutoReply(CONTACT_ROW);
			expect(sentEmails.rows).toHaveLength(1);
			const row = sentEmails.rows[0];
			expect(row.status).toBe("accepted");
			expect(row.resendId).toBe("resend-2");
			expect(row.kind).toBe("contact_auto_reply");
			expect(row.to).toBe(CONTACT_ROW.email);
		});

		it("writes a 'failed' sent_emails row with kind='contact_auto_reply' on Resend error", async () => {
			resend.emails.send.mockResolvedValueOnce({
				data: null,
				error: {
					name: "rate_limit_exceeded",
					message: "Too many requests",
					statusCode: 429,
				},
				headers: null,
			});
			await service.sendContactAutoReply(CONTACT_ROW);
			expect(sentEmails.rows).toHaveLength(1);
			const row = sentEmails.rows[0];
			expect(row.status).toBe("failed");
			expect(row.resendId).toBeNull();
			expect(row.errorMessage).toBe("Too many requests");
			expect(row.kind).toBe("contact_auto_reply");
		});
	});
});
