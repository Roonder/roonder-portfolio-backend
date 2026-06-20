import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewsService } from "./reviews.service";
import { ReviewsController } from "./reviews.controller";
import { ReviewsAdminController } from "./reviews-admin.controller";
import { ReviewEntity } from "./entities/review.entity";
import { ReviewCommentEntity } from "./entities/review-comment.entity";

/**
 * Reviews domain module. The 2 entities are registered with
 * `TypeOrmModule.forFeature([...])` so the
 * `@InjectRepository(ReviewEntity)` /
 * `@InjectRepository(ReviewCommentEntity)` tokens in
 * `ReviewsService` resolve to the typeorm-managed repository
 * instances at runtime.
 *
 * The shared `AppDataSource` (from `src/data-source.ts`) is
 * bootstrapped in `AppModule` via `TypeOrmModule.forRootAsync` —
 * this module only adds the per-feature repositories. The
 * `forFeature` line is required per the spec scenario
 * "DataSource and ReviewsModule register ReviewEntity" in
 * `openspec/changes/reviews-domain/specs/reviews-domain/spec.md`.
 *
 * 2 controllers in the same module (per ADR-6): the public
 * `ReviewsController` (4 throttled routes at T9 + T14) and the
 * admin `ReviewsAdminController` (3 protected routes at T10).
 * Both controllers share the `ReviewsService` via DI; the
 * admin controller is class-level `@UseGuards(JwtAuthGuard)`
 * and the public controller is unprotected.
 *
 * `ReviewsService` is exported (per ADR-13) so the
 * `seed-reviews.ts` CLI (added at T17) can consume the service
 * directly without re-instantiating a Nest application context.
 * `ThrottlerModule` is NOT exported (per ADR-2) — it lives in
 * `AppModule` and is per-route via `@ThrottledWrite()` /
 * `@ThrottledRead()`.
 *
 * In the unit suite (`src/app.module.spec.ts`,
 * `src/main.spec.ts`) `@nestjs/typeorm` is mocked, so the
 * `forFeature` returns a no-op module. The 2 repository tokens
 * are provided as `useValue: {}` fakes via the `TestFakesModule`
 * `@Global()` block in each spec — see the T11 commit for the
 * wiring.
 */
@Module({
	imports: [TypeOrmModule.forFeature([ReviewEntity, ReviewCommentEntity])],
	controllers: [ReviewsController, ReviewsAdminController],
	providers: [ReviewsService],
	exports: [ReviewsService],
})
export class ReviewsModule {}
