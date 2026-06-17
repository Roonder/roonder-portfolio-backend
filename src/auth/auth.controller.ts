import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
} from "@nestjs/common";

// Stub controller — replaced in Commit 4 with the real /auth/login, /refresh,
// /logout, /profile endpoints. The route shape is preserved so the bootstrap
// prefix probe at /api/v1/auth (main.spec.ts) keeps passing until then.
@Controller("auth")
export class AuthController {
	@Post()
	create(@Body() body: Record<string, unknown>) {
		void body;
		return "This action adds a new auth";
	}

	@Get()
	findAll() {
		return "This action returns all auth";
	}

	@Get(":id")
	findOne(@Param("id") id: string) {
		return `This action returns a #${id} auth`;
	}

	@Patch(":id")
	update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
		void body;
		return `This action updates a #${id} auth`;
	}

	@Delete(":id")
	remove(@Param("id") id: string) {
		return `This action removes a #${id} auth`;
	}
}
