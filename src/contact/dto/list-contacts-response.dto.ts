import { ApiProperty } from "@nestjs/swagger";
import { ContactResponseDto } from "./contact-response.dto";

/**
 * Plain result interface for the service's list method. The
 * service returns this (NOT a class instance) so the controller
 * can hand it back to the client verbatim. The interface keeps
 * the service signature stable without forcing a class
 * construction at every call.
 */
export interface ListContactsResult {
	data: ContactResponseDto[];
	total: number;
	page: number;
	pageSize: number;
}

/**
 * Envelope for `GET /api/v1/admin/contacts`. Shape is locked by
 * the spec scenario "Valid JWT returns paginated contacts":
 * `{ data, total, page, pageSize }`. `total` is the count of
 * rows that matched the filter, NOT the length of `data` (which
 * is capped at `pageSize`).
 */
export class ListContactsResponseDto implements ListContactsResult {
	@ApiProperty({ type: [ContactResponseDto] })
	data!: ContactResponseDto[];

	@ApiProperty({ minimum: 0 })
	total!: number;

	@ApiProperty({ minimum: 1, default: 1 })
	page!: number;

	@ApiProperty({ minimum: 1, maximum: 100, default: 20 })
	pageSize!: number;
}
