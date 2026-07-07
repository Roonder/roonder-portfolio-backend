import { Body, Controller, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ContactService } from "./contact.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { ContactResponseDto } from "./dto/contact-response.dto";
import { ThrottledContactWrite } from "./throttle.decorator";

/**
 * Public Contact surface.
 *
 * 1 route:
 *
 *   POST  /api/v1/contacts  — public, throttled write
 *
 * The route is throttled per-IP via the per-route
 * `@ThrottledContactWrite()` factory (ADR-4 / ADR-5). The
 * `ThrottlerGuard` is NOT registered as a global `APP_GUARD` —
 * the throttler is per-route only (verified by the static
 * guard-rail in `src/app.module.spec.ts`). The admin routes
 * (`/admin/contacts/*`) live on `ContactAdminController` (T10.1)
 * and carry no `@Throttle()` decorator.
 *
 * The route is INTENTIONALLY unauthenticated (locked #1: the
 * public submission contract). The global `ValidationPipe`
 * (wired in `src/main.ts`) enforces `whitelist +
 * forbidNonWhitelisted + transform`; extra fields like `phone`,
 * `company`, `attachments` are rejected with 400 at the DTO
 * surface (verified by the e2e in T11.1).
 *
 * 4xx responses are NOT declared per route beyond the success
 * shape; the canonical error envelope is the global exception
 * filter's job. The 429 from the throttler falls under this
 * filter with `error: "Too Many Requests"` (verified in
 * `test/contact.e2e-spec.ts`).
 *
 * The previous NestJS CLI scaffold (1 `create` method, no
 * `@Throttle`, no Swagger metadata) is REPLACED by this file.
 * The `contact.controller.spec.ts` smoke `toBeDefined` test is
 * REPLACED by the real HTTP-shape + metadata spec.
 */
@ApiTags("contact")
@Controller("contacts")
export class ContactController {
	constructor(private readonly contacts: ContactService) {}

	@Post()
	@ThrottledContactWrite()
	@ApiOperation({
		summary:
			"Submit a new contact-form message (public, persists with status='pending')",
	})
	@ApiResponse({
		status: 201,
		description: "The created contact body (status='pending')",
		type: ContactResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid body" })
	@ApiResponse({ status: 429, description: "Throttled" })
	create(@Body() dto: CreateContactDto) {
		return this.contacts.create(dto);
	}
}
