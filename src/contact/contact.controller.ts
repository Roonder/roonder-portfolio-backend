import {
	Controller,
	Get,
	Post,
	Body,
	Param,
	Delete,
} from "@nestjs/common";
import { ContactService } from "./contact.service";
import { CreateContactDto } from "./dto/create-contact.dto";

/**
 * Placeholder controller. The real public `ContactController` (the
 * 1-route POST with `@ThrottledContactWrite()`) lands in task 6.2
 * (Batch B). The admin `ContactAdminController` lands in task 10.1
 * (Batch B). This scaffold only retains the `create` route stub so
 * the test suite continues to compile after task 4.2 expanded the
 * service's method set (the old scaffold's `findAll`, `findOne`,
 * `update`, `remove` references no longer match the new service
 * surface; the real public route is in 6.2 + the admin route is in
 * 10.1).
 */
@Controller("contact")
export class ContactController {
	constructor(private readonly contactService: ContactService) {}

	@Post()
	create(@Body() createContactDto: CreateContactDto) {
		return this.contactService.create(createContactDto);
	}
}
