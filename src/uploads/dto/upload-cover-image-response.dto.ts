import { ApiProperty } from "@nestjs/swagger";

/**
 * Body of `POST /api/v1/uploads/cover-image`. Deliberately returns the
 * **object key** (not a URL) — the admin form stores this key verbatim
 * in a project's `coverImage` field, matching what `ProjectEntity`
 * persists (see `src/uploads/uploads.service.ts` for why a URL is
 * never stored).
 */
export class UploadCoverImageResponseDto {
	@ApiProperty({ example: "covers/8f14e45f-ceea-467e-b2e0-1f5f5f5f5f5f.jpg" })
	key!: string;
}
