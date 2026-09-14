import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

function makeUploadsServiceFake(): { uploadCoverImage: jest.Mock } {
	return { uploadCoverImage: jest.fn() };
}

function makeFile(overrides: Partial<{
	buffer: Buffer;
	mimetype: string;
	originalname: string;
	size: number;
}> = {}) {
	return {
		buffer: Buffer.from("fake-bytes"),
		mimetype: "image/png",
		originalname: "cover.png",
		size: 1024,
		...overrides,
	};
}

describe("UploadsController.uploadCoverImage", () => {
	it("rejects when no file is present", async () => {
		const service = makeUploadsServiceFake();
		const controller = new UploadsController(
			service as unknown as UploadsService,
		);
		await expect(controller.uploadCoverImage(undefined)).rejects.toThrow(
			BadRequestException,
		);
		expect(service.uploadCoverImage).not.toHaveBeenCalled();
	});

	it("rejects a non-image mimetype", async () => {
		const service = makeUploadsServiceFake();
		const controller = new UploadsController(
			service as unknown as UploadsService,
		);
		await expect(
			controller.uploadCoverImage(
				makeFile({ mimetype: "application/pdf" }),
			),
		).rejects.toThrow(BadRequestException);
		expect(service.uploadCoverImage).not.toHaveBeenCalled();
	});

	it("rejects a file over the 5MB size cap", async () => {
		const service = makeUploadsServiceFake();
		const controller = new UploadsController(
			service as unknown as UploadsService,
		);
		await expect(
			controller.uploadCoverImage(
				makeFile({ size: 5 * 1024 * 1024 + 1 }),
			),
		).rejects.toThrow(BadRequestException);
		expect(service.uploadCoverImage).not.toHaveBeenCalled();
	});

	it("delegates to UploadsService.uploadCoverImage and returns { key }", async () => {
		const service = makeUploadsServiceFake();
		service.uploadCoverImage.mockResolvedValue("covers/generated-key.png");
		const controller = new UploadsController(
			service as unknown as UploadsService,
		);
		const file = makeFile();
		const result = await controller.uploadCoverImage(file);
		expect(service.uploadCoverImage).toHaveBeenCalledWith(
			file.buffer,
			file.mimetype,
			file.originalname,
		);
		expect(result).toEqual({ key: "covers/generated-key.png" });
	});
});

describe("UploadsController metadata — Guards", () => {
	it("carries JwtAuthGuard via @UseGuards on uploadCoverImage", () => {
		// Same reflection-based assertion style as
		// `projects.controller.spec.ts` — the full 401 HTTP behaviour
		// (missing/invalid bearer) is the auth-domain's e2e scope.
		const proto = UploadsController.prototype as unknown as Record<
			string,
			object
		>;
		const guards = Reflect.getMetadata(
			"__guards__",
			proto["uploadCoverImage"],
		) as Array<{ name: string }> | undefined;
		expect(guards).toBeDefined();
		expect(guards).toHaveLength(1);
		expect(guards?.[0]).toBe(JwtAuthGuard);
	});
});
