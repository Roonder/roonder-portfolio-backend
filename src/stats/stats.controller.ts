import { Controller, Get, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { StatsService } from "./stats.service";
import { AdminStatsResponseDto } from "./dto/admin-stats-response.dto";

/**
 * `GET /api/v1/admin/stats` — aggregate counts for the admin overview
 * cards. JwtAuthGuard-protected, `@SkipThrottle()` like the rest of
 * the authenticated admin surface (see `src/auth/throttle.decorator.ts`).
 */
@ApiTags("admin-stats")
@Controller("admin/stats")
export class StatsController {
	constructor(private readonly stats: StatsService) {}

	@Get()
	@ApiBearerAuth()
	@UseGuards(JwtAuthGuard)
	@SkipThrottle()
	@ApiOperation({ summary: "Get aggregate admin overview stats" })
	@ApiResponse({ status: 200, type: AdminStatsResponseDto })
	@ApiResponse({ status: 401, description: "Missing or invalid bearer" })
	getStats(): Promise<AdminStatsResponseDto> {
		return this.stats.getAdminStats();
	}
}
