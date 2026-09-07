import {
	BadRequestException,
	Controller,
	Post,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { SkipThrottle } from "@nestjs/throttler";
import {
	ApiBearerAuth,
	ApiBody,
	ApiConsumes,
	ApiOperation,
	ApiResponse,
	ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UploadsService } from "./uploads.service";
import { UploadCoverImageResponseDto } from "./dto/upload-cover-image-response.dto";

/** 5 MB — matches the design's cover-image size cap. */
const MAX_COVER_IMAGE_BYTES = 5 * 1024 * 1024;

/** Multer's in-memory `file` shape, as delivered by `FileInterceptor`. */
interface UploadedMulterFile {
	buffer: Buffer;
	mimetype: string;
	originalname: string;
	size: number;
}

/**
 * Admin-only upload surface for project cover images.
 *
 * `POST /api/v1/uploads/cover-image` accepts a single `multipart/form-data`
 * file field named `file`, uploads it to the Supabase S3-compatible
 * bucket via `UploadsService`, and returns `{ key }` — never a URL (see
 * `UploadsService` for why). The admin project form stores that key in
 * the project's `coverImage` field.
 *
 * `@SkipThrottle()` matches every other `JwtAuthGuard`-protected admin
 * route (see `src/projects/projects.controller.ts` and
 * `src/auth/throttle.decorator.ts`) — an authenticated admin does not
 * need the public-write throttle.
 */
@ApiTags("uploads")
@Controller("uploads")
export class UploadsController {
	constructor(private readonly uploads: UploadsService) {}

	@Post("cover-image")
	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@SkipThrottle()
	@UseInterceptors(
		FileInterceptor("file", { limits: { fileSize: MAX_COVER_IMAGE_BYTES } }),
	)
	@ApiConsumes("multipart/form-data")
	@ApiBody({
		schema: {
			type: "object",
			properties: { file: { type: "string", format: "binary" } },
		},
	})
	@ApiOperation({ summary: "Upload a project cover image" })
	@ApiResponse({
		status: 201,
		description: "The uploaded object's storage key",
		type: UploadCoverImageResponseDto,
	})
	@ApiResponse({ status: 400, description: "Missing file, wrong type, or too large" })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	async uploadCoverImage(
		@UploadedFile() file: UploadedMulterFile | undefined,
	): Promise<UploadCoverImageResponseDto> {
		if (!file) {
			throw new BadRequestException("No file uploaded");
		}
		if (!file.mimetype?.startsWith("image/")) {
			throw new BadRequestException("File must be an image");
		}
		if (file.size > MAX_COVER_IMAGE_BYTES) {
			throw new BadRequestException("File exceeds the 5MB size limit");
		}
		const key = await this.uploads.uploadCoverImage(
			file.buffer,
			file.mimetype,
			file.originalname,
		);
		return { key };
	}
}
