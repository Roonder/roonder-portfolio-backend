import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { ContactController } from "./contact.controller";
import { ContactService } from "./contact.service";
import { ContactEntity } from "./entities/contact.entity";
import { SentEmailEntity } from "./entities/sent-email.entity";

describe("ContactController", () => {
	let controller: ContactController;

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ContactController],
			providers: [
				ContactService,
				{
					provide: getRepositoryToken(ContactEntity),
					useValue: {},
				},
				{
					provide: getRepositoryToken(SentEmailEntity),
					useValue: {},
				},
				{
					provide: EventEmitter2,
					useValue: { emit: () => undefined },
				},
			],
		}).compile();

		controller = module.get<ContactController>(ContactController);
	});

	it("should be defined", () => {
		expect(controller).toBeDefined();
	});
});
