import { Injectable } from "@nestjs/common";
import { CreateContactDto } from "./dto/create-contact.dto";

@Injectable()
export class ContactService {
	create(createContactDto: CreateContactDto) {
		return "This action adds a new contact";
	}

	findAll() {
		return `This action returns all contact`;
	}

	findOne(id: number) {
		return `This action returns a #${id} contact`;
	}

	remove(id: number) {
		return "This action removes a #${id} contact";
	}
}
