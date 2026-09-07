import { ApiProperty } from "@nestjs/swagger";

/**
 * Response body of `GET /api/v1/admin/stats`. Backs the three admin
 * overview cards (Active Works, Reviews, Inbox) — see
 * `app/admin/projects/pages/overview.tsx` on the frontend.
 */
export class AdminStatsResponseDto {
	@ApiProperty({ description: "Published project count" })
	activeWorks!: number;

	@ApiProperty({ description: "Projects published in the current calendar month" })
	activeWorksThisMonth!: number;

	@ApiProperty({ description: "Reviews awaiting approval" })
	reviewsPending!: number;

	@ApiProperty({ description: "Contact submissions still in 'pending' status" })
	inboxPending!: number;
}
