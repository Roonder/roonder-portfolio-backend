import { Injectable } from "@nestjs/common";

@Injectable()
export class AuthService {
	create(body: Record<string, unknown>) {
		void body;
		return "This action adds a new auth";
	}

	findAll() {
		return `This action returns all auth`;
	}

	findOne(id: number) {
		return `This action returns a #${id} auth`;
	}

	update(id: number, body: Record<string, unknown>) {
		void body;
		return `This action updates a #${id} auth`;
	}

	remove(id: number) {
		return `This action removes a #${id} auth`;
	}
}
