import { ConfigService } from "@nestjs/config";
import { InternalServerErrorException } from "@nestjs/common";
import { UploadsService } from "./uploads.service";
import type { EnvConfig } from "../config/env.config";

// The AWS SDK is NEVER hit in this suite — both `S3Client.send` and
// `getSignedUrl` are mocked at the module level. `S3Client` itself is
// mocked so the constructor never tries to resolve real credentials.
const sendMock = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
	return {
		S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
		PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({
			__type: "PutObjectCommand",
			input,
		})),
		GetObjectCommand: jest.fn().mockImplementation((input: unknown) => ({
			__type: "GetObjectCommand",
			input,
		})),
	};
});

const getSignedUrlMock = jest.fn();
jest.mock("@aws-sdk/s3-request-presigner", () => ({
	getSignedUrl: (...args: unknown[]) => getSignedUrlMock(...args),
}));

const FULL_ENV: Record<string, string> = {
	SUPABASE_S3_ENDPOINT: "https://project.supabase.co/storage/v1/s3",
	SUPABASE_S3_REGION: "us-west-2",
	SUPABASE_S3_ACCESS_KEY_ID: "access-key",
	SUPABASE_S3_SECRET_ACCESS_KEY: "secret-key",
	SUPABASE_S3_BUCKET: "portfolio-projects",
};

function buildConfigFake(env: Record<string, string | undefined>): ConfigService<EnvConfig> {
	return {
		get: (key: string) => env[key],
	} as unknown as ConfigService<EnvConfig>;
}

describe("UploadsService", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	describe("uploadCoverImage", () => {
		it("uploads via PutObjectCommand and returns a generated covers/<uuid>.<ext> key", async () => {
			sendMock.mockResolvedValue({});
			const service = new UploadsService(buildConfigFake(FULL_ENV));
			const key = await service.uploadCoverImage(
				Buffer.from("fake-bytes"),
				"image/png",
				"my-photo.png",
			);
			expect(key).toMatch(
				/^covers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/,
			);
			expect(sendMock).toHaveBeenCalledTimes(1);
			const sentCommand = sendMock.mock.calls[0]?.[0] as {
				input: { Bucket: string; Key: string; ContentType: string };
			};
			expect(sentCommand.input.Bucket).toBe("portfolio-projects");
			expect(sentCommand.input.Key).toBe(key);
			expect(sentCommand.input.ContentType).toBe("image/png");
		});

		it("falls back to the mimetype's subtype when the original filename has no extension", async () => {
			sendMock.mockResolvedValue({});
			const service = new UploadsService(buildConfigFake(FULL_ENV));
			const key = await service.uploadCoverImage(
				Buffer.from("fake-bytes"),
				"image/jpeg",
				"no-extension",
			);
			expect(key.endsWith(".jpeg")).toBe(true);
		});

		it("throws InternalServerErrorException when any SUPABASE_S3_* var is missing (fails only when used)", async () => {
			const service = new UploadsService(
				buildConfigFake({ ...FULL_ENV, SUPABASE_S3_BUCKET: undefined }),
			);
			await expect(
				service.uploadCoverImage(Buffer.from("x"), "image/png", "x.png"),
			).rejects.toThrow(InternalServerErrorException);
			expect(sendMock).not.toHaveBeenCalled();
		});
	});

	describe("getSignedCoverImageUrl", () => {
		it("signs a GetObjectCommand with a 3600s expiry and returns the signed URL", async () => {
			getSignedUrlMock.mockResolvedValue("https://signed.example.com/cover.jpg?sig=abc");
			const service = new UploadsService(buildConfigFake(FULL_ENV));
			const url = await service.getSignedCoverImageUrl("covers/some-key.jpg");
			expect(url).toBe("https://signed.example.com/cover.jpg?sig=abc");
			expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
			const [, command, options] = getSignedUrlMock.mock.calls[0] as [
				unknown,
				{ input: { Bucket: string; Key: string } },
				{ expiresIn: number },
			];
			expect(command.input.Bucket).toBe("portfolio-projects");
			expect(command.input.Key).toBe("covers/some-key.jpg");
			expect(options.expiresIn).toBe(3600);
		});

		it("throws InternalServerErrorException when S3 is not configured", async () => {
			const service = new UploadsService(buildConfigFake({}));
			await expect(
				service.getSignedCoverImageUrl("covers/some-key.jpg"),
			).rejects.toThrow(InternalServerErrorException);
			expect(getSignedUrlMock).not.toHaveBeenCalled();
		});

		it("reuses the same memoized S3 client across calls (does not rebuild per call)", async () => {
			const { S3Client } = jest.requireMock("@aws-sdk/client-s3") as {
				S3Client: jest.Mock;
			};
			getSignedUrlMock.mockResolvedValue("https://signed.example.com/a.jpg");
			const service = new UploadsService(buildConfigFake(FULL_ENV));
			await service.getSignedCoverImageUrl("covers/a.jpg");
			await service.getSignedCoverImageUrl("covers/b.jpg");
			expect(S3Client).toHaveBeenCalledTimes(1);
		});
	});
});
