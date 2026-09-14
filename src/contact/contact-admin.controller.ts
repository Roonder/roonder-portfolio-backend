import {
	Body,
	Controller,
	Get,
	Param,
	ParseUUIDPipe,
	Patch,
	Query,
	UseGuards,
} from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import {
	ApiBearerAuth,
	ApiOperation,
	ApiQuery,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ContactService } from "./contact.service";
import { ListContactsQueryDto } from "./dto/list-contacts-query.dto";
import { ContactResponseDto } from "./dto/contact-response.dto";
import {
	ListContactsResponseDto,
	ListContactsResult,
} from "./dto/list-contacts-response.dto";
import { UpdateContactStatusDto } from "./dto/update-contact-status.dto";

/**
 * Admin Contact surface.
 *
 * 2 routes (per the design's commit sequence at T10.1 — the
 * public route is on `ContactController`):
 *
 *   GET    /api/v1/admin/contacts          — protected
 *   PATCH  /api/v1/admin/contacts/:id      — protected
 *
 * Both routes are class-level `@UseGuards(JwtAuthGuard)`
 * (per ADR-6) and carry `@ApiBearerAuth()` for Swagger. Each
 * method also carries `@SkipThrottle()` — `ThrottlerGuard` is
 * registered globally (`APP_GUARD`), and its restrictive default
 * tracker is tuned for public write-abuse protection, not
 * authenticated admin usage; these routes opt out of it
 * explicitly (mirrors `ProjectsController`).
 *
 * `:id` is the contact's internal uuid — `ParseUUIDPipe`
 * validates the format and returns 400 for anything that is
 * not a uuid (locked #6).
 *
 * 4xx/5xx responses are NOT declared per route beyond the
 * success shape; the canonical envelope is the global exception
 * filter's job (verified at T11.1 + T11.2).
 */
@ApiTags("contact")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("admin/contacts")
export class ContactAdminController {
	constructor(private readonly contacts: ContactService) {}

	@Get()
	@SkipThrottle()
	@ApiOperation({
		summary: "List all contacts (admin, paginated)",
	})
	@ApiQuery({ name: "page", required: false, type: Number })
	@ApiQuery({ name: "pageSize", required: false, type: Number })
	@ApiResponse({
		status: 200,
		description: "Envelope of contacts (all statuses)",
		type: ListContactsResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid query parameters" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	findAllForAdmin(
		@Query() query: ListContactsQueryDto,
	): Promise<ListContactsResult> {
		return this.contacts.findAllForAdmin(query);
	}

	@Patch(":id")
	@SkipThrottle()
	@ApiOperation({
		summary: "Update a contact's status (admin)",
	})
	@ApiResponse({
		status: 200,
		description: "The updated contact body",
		type: ContactResponseDto,
	})
	@ApiResponse({ status: 400, description: "Invalid id (non-uuid) or body" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	@ApiResponse({ status: 404, description: "Contact not found" })
	updateStatus(
		@Param("id", ParseUUIDPipe) id: string,
		@Body() dto: UpdateContactStatusDto,
	): Promise<ContactResponseDto> {
		return this.contacts.updateStatus(id, dto);
	}
}
