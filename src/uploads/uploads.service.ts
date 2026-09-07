import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import type { EnvConfig } from "../config/env.config";

/** `covers/<uuid>.<ext>` prefix for every stored cover image key. */
const COVER_IMAGE_KEY_PREFIX = "covers";

/**
 * Presigned GET URLs are regenerated on every project read (see
 * `ProjectsService`), so a short TTL is safe — there is no cron job
 * refreshing anything, the URL is simply re-signed on demand.
 */
const COVER_IMAGE_SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Supabase S3-compatible storage wrapper for project cover images.
 *
 * `ProjectEntity.coverImage` stores the S3 **object key** (e.g.
 * `covers/<uuid>.jpg`), never a URL — SigV4 presigned URLs hard-cap at
 * 7 days, but cover images must display indefinitely. Every read path
 * re-signs a fresh GET URL from the stored key (`getSignedCoverImageUrl`);
 * `uploadCoverImage` is the only write path, invoked by
 * `UploadsController`.
 *
 * The S3 client is built lazily from the 5 `SUPABASE_S3_*` env vars
 * (`getClientAndBucket`) instead of at construction time, so booting the
 * app never fails just because Supabase Storage is unconfigured (e.g.
 * local dev). A caller that actually needs S3 (upload or sign) gets a
 * clear, immediate error instead.
 */
@Injectable()
export class UploadsService {
	private client: S3Client | null = null;
	private bucket: string | null = null;

	constructor(private readonly config: ConfigService<EnvConfig>) {}

	/**
	 * Uploads a cover image buffer to the configured bucket under a
	 * freshly generated key and returns that key (NOT a URL). The
	 * caller (admin project form, via `UploadsController`) stores the
	 * returned key verbatim in the project's `coverImage` field.
	 * @param buffer - raw file bytes (from Multer's in-memory storage)
	 * @param mimetype - the upload's declared content type, e.g. `image/png`
	 * @param originalname - the uploaded file's original name, used only
	 * to recover an extension when the mimetype's subtype is ambiguous
	 * @returns the generated object key, e.g. `covers/<uuid>.png`
	 */
	async uploadCoverImage(
		buffer: Buffer,
		mimetype: string,
		originalname: string,
	): Promise<string> {
		const { client, bucket } = this.getClientAndBucket();
		const key = `${COVER_IMAGE_KEY_PREFIX}/${randomUUID()}${this.extensionFor(mimetype, originalname)}`;
		await client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: buffer,
				ContentType: mimetype,
			}),
		);
		return key;
	}

	/**
	 * Signs a fresh, short-lived GET URL for `key`. Called on every
	 * project read that has a non-null `coverImage` — the signature is
	 * cheap to compute and never persisted, so the 1-hour expiry is
	 * irrelevant to the caller: the URL is always freshly minted.
	 * @param key - the stored S3 object key (`ProjectEntity.coverImage`)
	 * @returns a presigned GET URL valid for 1 hour
	 */
	async getSignedCoverImageUrl(key: string): Promise<string> {
		const { client, bucket } = this.getClientAndBucket();
		const command = new GetObjectCommand({ Bucket: bucket, Key: key });
		return getSignedUrl(client, command, {
			expiresIn: COVER_IMAGE_SIGNED_URL_TTL_SECONDS,
		});
	}

	/**
	 * Recovers a file extension (including the leading dot) from the
	 * original filename first, falling back to the mimetype's subtype.
	 * Returns `""` when neither yields anything usable.
	 */
	private extensionFor(mimetype: string, originalname: string): string {
		const dotIndex = originalname.lastIndexOf(".");
		if (dotIndex !== -1 && dotIndex < originalname.length - 1) {
			return originalname.slice(dotIndex).toLowerCase();
		}
		const subtype = mimetype.split("/")[1];
		return subtype ? `.${subtype.toLowerCase()}` : "";
	}

	/**
	 * Lazily builds (and memoizes) the S3 client + bucket name from the
	 * 5 `SUPABASE_S3_*` env vars. Throws `InternalServerErrorException`
	 * — surfaced by the global exception filter like any other 500 —
	 * only when a caller actually reaches this method with one or more
	 * vars missing.
	 */
	private getClientAndBucket(): { client: S3Client; bucket: string } {
		if (this.client && this.bucket) {
			return { client: this.client, bucket: this.bucket };
		}
		const endpoint = this.config.get("SUPABASE_S3_ENDPOINT", {
			infer: true,
		});
		const region = this.config.get("SUPABASE_S3_REGION", { infer: true });
		const accessKeyId = this.config.get("SUPABASE_S3_ACCESS_KEY_ID", {
			infer: true,
		});
		const secretAccessKey = this.config.get(
			"SUPABASE_S3_SECRET_ACCESS_KEY",
			{ infer: true },
		);
		const bucket = this.config.get("SUPABASE_S3_BUCKET", { infer: true });
		if (!endpoint || !region || !accessKeyId || !secretAccessKey || !bucket) {
			throw new InternalServerErrorException(
				"Supabase S3 storage is not configured (missing one or more of SUPABASE_S3_ENDPOINT, SUPABASE_S3_REGION, SUPABASE_S3_ACCESS_KEY_ID, SUPABASE_S3_SECRET_ACCESS_KEY, SUPABASE_S3_BUCKET)",
			);
		}
		this.client = new S3Client({
			endpoint,
			region,
			forcePathStyle: true,
			credentials: { accessKeyId, secretAccessKey },
		});
		this.bucket = bucket;
		return { client: this.client, bucket: this.bucket };
	}
}
