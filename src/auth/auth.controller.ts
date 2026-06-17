import {
	Controller,
	Get,
	Post,
	Body,
	Patch,
	Param,
	Delete,
} from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
	constructor(private readonly authService: AuthService) {}

	@Post()
	create(@Body() body: Record<string, unknown>) {
		return this.authService.create(body);
	}

	@Get()
	findAll() {
		return this.authService.findAll();
	}

	@Get(":id")
	findOne(@Param("id") id: string) {
		return this.authService.findOne(+id);
	}

	@Patch(":id")
	update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
		return this.authService.update(+id, body);
	}

	@Delete(":id")
	remove(@Param("id") id: string) {
		return this.authService.remove(+id);
	}
}
