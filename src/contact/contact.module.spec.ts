import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Spec for `ContactModule` — the module that wires the contact
 * domain's DI graph.
 *
 * 5 static-source assertions (mirrors `src/reviews/reviews.module.spec.ts`):
 *
 *   1. `imports TypeOrmModule from "@nestjs/typeorm"`.
 *   2. `TypeOrmModule.forFeature([ContactEntity, SentEmailEntity])` —
 *      the 2 entities are both registered (the contact row AND
 *      its audit-trail child).
 *   3. `provides ContactService, EmailService, ContactEmailListener`
 *      (3 providers).
 *   4. `declares BOTH controllers: ContactController + ContactAdminController`.
 *   5. `provides the RESEND_CLIENT factory via useFactory`
 *      (the injection token is satisfied at boot by
 *      `new Resend(config.get("RESEND_API_KEY"))`).
 *
 * The runtime resolution is verified end-to-end in
 * `test/contact.e2e-spec.ts` (T11.1) — the public POST 201
 * proves the module composes; the admin routes' 401 proves
 * the JWT guard is in effect.
 */
describe("ContactModule", () => {
	const source = readFileSync(
		resolve(__dirname, "contact.module.ts"),
		"utf8",
	);

	it("imports TypeOrmModule from @nestjs/typeorm", () => {
		expect(source).toMatch(/from\s+["']@nestjs\/typeorm["']/);
	});

	it("calls TypeOrmModule.forFeature with both ContactEntity and SentEmailEntity", () => {
		const regex =
			/TypeOrmModule\.forFeature\(\s*\[\s*ContactEntity\s*,\s*SentEmailEntity\s*\]\s*\)/;
		expect(source).toMatch(regex);
	});

	it("provides ContactService, EmailService, AND ContactEmailListener", () => {
		expect(source).toMatch(/ContactService/);
		expect(source).toMatch(/EmailService/);
		expect(source).toMatch(/ContactEmailListener/);
	});

	it("declares BOTH controllers at the class level (ContactController + ContactAdminController)", () => {
		expect(source).toMatch(
			/controllers\s*:\s*\[\s*ContactController\s*,\s*ContactAdminController\s*\]/,
		);
	});

	it("provides the RESEND_CLIENT factory via useFactory (the Resend SDK is wired at boot)", () => {
		// The factory must inject ConfigService<EnvConfig> and
		// call `new Resend(config.get("RESEND_API_KEY"))`. The
		// static check is the executable contract for the
		// locked decision "EmailService depends on RESEND_CLIENT
		// (not on ConfigService) so unit tests can pass a
		// fake".
		expect(source).toMatch(/provide:\s*RESEND_CLIENT/);
		expect(source).toMatch(/useFactory/);
		expect(source).toMatch(/new\s+Resend\(/);
		expect(source).toMatch(/RESEND_API_KEY/);
	});
});
