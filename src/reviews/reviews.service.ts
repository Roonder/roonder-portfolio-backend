import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ReviewEntity } from "./entities/review.entity";
import { ReviewCommentEntity } from "./entities/review-comment.entity";
import { CreateReviewDto } from "./dto/create-review.dto";
import { ListReviewsQueryDto } from "./dto/list-reviews-query.dto";
import { ListReviewsResult } from "./dto/list-reviews-response.dto";
import { CreateReviewCommentDto } from "./dto/create-review-comment.dto";
import { ListCommentsQueryDto } from "./dto/list-comments-query.dto";
import { ListCommentsResponseDto } from "./dto/list-comments-response.dto";
import {
	toReviewResponse,
	toReviewCommentResponse,
} from "./review-response.mapper";

/**
 * Reviews domain service.
 *
 * `create` (T8a): persists a new `ReviewEntity` with
 * `isApproved: false` (the public submission contract — no review
 * is ever approved at insert time, per the design ADR-1 + the spec
 * "Submit Review (Public)" requirement). Maps the persisted row
 * through `toReviewResponse` for the response shape.
 *
 * The 4 other methods (`findAllApproved`, `findAllForAdmin`,
 * `toggleApproval`, `remove`) land in T8b/T8c; the comment methods
 * (`addComment`, `findApprovedCommentsByReviewId`) land in T13.
 * The constructor signature is stable from T8 onward — both
 * repository tokens are injected up front so T8b/T8c/T13 can
 * extend the same class without DI churn.
 *
 * No `DataSource` injection, no `withRetry` wrapper (no slug race;
 * the throttler is per-route, not in the service). The cascade on
 * delete is at the DB layer (`ON DELETE CASCADE` on
 * `review_comments.review_id`, locked #4 / ADR-8) — the service
 * does NOT issue a manual `this.comments.delete(...)` call.
 */
@Injectable()
export class ReviewsService {
	constructor(
		@InjectRepository(ReviewEntity)
		private readonly reviews: Repository<ReviewEntity>,
		@InjectRepository(ReviewCommentEntity)
		private readonly comments: Repository<ReviewCommentEntity>,
	) {}

	// --- T8a: write path -----------------------------------------------

	/**
	 * `POST /api/v1/reviews` — public create. Persists the row with
	 * `isApproved: false` regardless of the DTO contents. The author
	 * `authorName` defaults to `'Anónimo'` at the DB level when the
	 * DTO omits it; the DTO layer also accepts the field as optional
	 * with `@IsOptional() @MaxLength(100)`. Returns the response DTO
	 * via `toReviewResponse` (the `comments` field defaults to `[]`
	 * because the relation is not eager-loaded here).
	 */
	async create(
		dto: CreateReviewDto,
	): Promise<ReturnType<typeof toReviewResponse>> {
		const row = this.reviews.create({
			authorName: dto.authorName ?? "Anónimo",
			authorRole: dto.authorRole ?? null,
			content: dto.content,
			rating: dto.rating,
			isApproved: false,
		});
		const saved = await this.reviews.save(row);
		return toReviewResponse(saved);
	}

	// --- T8b: public + admin list (placeholders) ----------------------

	/**
	 * `GET /api/v1/reviews` — public list, paginated + filterable.
	 * Filters to `isApproved: true` only (the existence-leak guard
	 * from ADR-11). `?rating=5` is supported. `pageSize > 100` is
	 * silently clamped.
	 */
	async findAllApproved(
		query: ListReviewsQueryDto,
	): Promise<ListReviewsResult> {
		const page = query.page ?? 1;
		const pageSize = Math.min(query.pageSize ?? 20, 100);

		const qb = this.reviews
			.createQueryBuilder("review")
			.where("review.is_approved = :isApproved", { isApproved: true })
			.orderBy("review.created_at", "DESC")
			.skip((page - 1) * pageSize)
			.take(pageSize);

		if (query.rating !== undefined) {
			qb.andWhere("review.rating = :rating", { rating: query.rating });
		}

		const [rows, total] = await qb.getManyAndCount();
		return {
			data: rows.map(toReviewResponse),
			total,
			page,
			pageSize,
		};
	}

	/**
	 * `GET /api/v1/admin/reviews` — admin list, paginated + filterable.
	 * Defaults to ALL reviews (approved + pending). `?isApproved=true|false`
	 * filters. Same envelope shape as the public list.
	 */
	async findAllForAdmin(
		query: ListReviewsQueryDto,
	): Promise<ListReviewsResult> {
		const page = query.page ?? 1;
		const pageSize = Math.min(query.pageSize ?? 20, 100);

		const qb = this.reviews
			.createQueryBuilder("review")
			.orderBy("review.created_at", "DESC")
			.skip((page - 1) * pageSize)
			.take(pageSize);

		if (query.isApproved !== undefined) {
			qb.where("review.is_approved = :isApproved", {
				isApproved: query.isApproved,
			});
		}
		if (query.rating !== undefined) {
			qb.andWhere("review.rating = :rating", { rating: query.rating });
		}

		const [rows, total] = await qb.getManyAndCount();
		return {
			data: rows.map(toReviewResponse),
			total,
			page,
			pageSize,
		};
	}

	// --- T8c: admin write paths ---------------------------------------

	/**
	 * `PATCH /api/v1/admin/reviews/:id/approve` — toggles `isApproved`.
	 * Idempotent (called twice = original value). 404 on missing
	 * (existence-leak guard, ADR-11). Reads the current value,
	 * flips, saves. Maps via `toReviewResponse` (the `comments`
	 * relation is not eager-loaded here so the mapper defaults to
	 * `[]`).
	 */
	async toggleApproval(
		id: string,
	): Promise<ReturnType<typeof toReviewResponse>> {
		const row = await this.reviews.findOne({ where: { id } });
		if (!row) {
			throw new NotFoundException("Review not found");
		}
		row.isApproved = !row.isApproved;
		const saved = await this.reviews.save(row);
		return toReviewResponse(saved);
	}

	/**
	 * `DELETE /api/v1/admin/reviews/:id` — hard delete. The FK
	 * CASCADE removes child comments. 404 on missing (existence-leak
	 * guard, ADR-11). **No manual `comments.delete(...)`** — the FK
	 * ON DELETE CASCADE (locked #4 / ADR-8) does the work at the DB
	 * layer; the spec asserts `comments.delete` is NEVER called.
	 */
	async remove(id: string): Promise<void> {
		const result = await this.reviews.delete({ id });
		if (result.affected === 0) {
			throw new NotFoundException("Review not found");
		}
	}

	// --- T13: comment methods ----------------------------------------

	/**
	 * `POST /api/v1/reviews/:id/comments` — adds a comment.
	 *
	 * Pre-checks the parent's existence via
	 * `this.reviews.findOne({ where: { id: reviewId } })`. If the
	 * parent is missing → `NotFoundException("Review not found")`.
	 *
	 * **Asymmetric existence-leak guard (ADR-11)**: this method
	 * does NOT 404 on an unapproved parent. The user can comment
	 * on a pending review; the comment is persisted with
	 * `isApproved: false` (locked #3) and the admin can approve
	 * both at once. The complementary `findApprovedCommentsByReviewId`
	 * DOES 404 on unapproved parents (the asymmetric counterpart).
	 *
	 * Returns the response DTO via `toReviewCommentResponse` (the
	 * 6-field shape from `ReviewCommentResponseDto`, T12).
	 */
	async addComment(
		reviewId: string,
		dto: CreateReviewCommentDto,
	): Promise<ReturnType<typeof toReviewCommentResponse>> {
		const parent = await this.reviews.findOne({
			where: { id: reviewId },
			select: { id: true },
		});
		if (!parent) {
			throw new NotFoundException("Review not found");
		}
		const row = this.comments.create({
			reviewId,
			authorName: dto.authorName ?? "Anónimo",
			content: dto.content,
			isApproved: false,
		});
		const saved = await this.comments.save(row);
		return toReviewCommentResponse(saved);
	}

	/**
	 * `GET /api/v1/reviews/:id/comments` — paginated approved
	 * comments. The list is filtered to `isApproved: true` at the
	 * query level (per ADR-7).
	 *
	 * **Existence-leak guard (ADR-11)**: pre-checks the parent's
	 * existence AND `isApproved` status. If the parent is
	 * missing OR `isApproved: false` →
	 * `NotFoundException("Review not found")` with the SAME
	 * message for both cases (byte-equal — the test asserts
	 * this). A client cannot tell apart "review doesn't exist"
	 * from "review exists but is unapproved" by inspecting the
	 * 404 body.
	 *
	 * `pageSize > 100` is silently clamped (mirrors
	 * `findAllApproved`). The DTO's `@Max(100)` is the
	 * wire-level guard.
	 */
	async findApprovedCommentsByReviewId(
		reviewId: string,
		query: ListCommentsQueryDto,
	): Promise<ListCommentsResponseDto> {
		const parent = await this.reviews.findOne({
			where: { id: reviewId },
			select: { id: true, isApproved: true },
		});
		if (!parent || !parent.isApproved) {
			throw new NotFoundException("Review not found");
		}
		const page = query.page ?? 1;
		const pageSize = Math.min(query.pageSize ?? 20, 100);
		const [rows, total] = await this.comments.findAndCount({
			where: { reviewId, isApproved: true },
			order: { createdAt: "DESC" },
			skip: (page - 1) * pageSize,
			take: pageSize,
		});
		return {
			data: rows.map(toReviewCommentResponse),
			total,
			page,
			pageSize,
		};
	}
}
