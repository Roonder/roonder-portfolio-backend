import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ReviewEntity } from "./entities/review.entity";
import { ReviewCommentEntity } from "./entities/review-comment.entity";
import { CreateReviewDto } from "./dto/create-review.dto";
import { toReviewResponse } from "./review-response.mapper";

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
	async create(dto: CreateReviewDto): Promise<ReturnType<typeof toReviewResponse>> {
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
	 * silently clamped. Lands in T8b.
	 */
	findAllApproved(
		_query: ListReviewsQueryDtoShape,
	): Promise<ListReviewsResultShape> {
		return Promise.resolve({
			data: [],
			total: 0,
			page: 1,
			pageSize: 20,
		});
	}

	/**
	 * `GET /api/v1/admin/reviews` — admin list, paginated + filterable.
	 * Defaults to ALL reviews (approved + pending). `?isApproved=true|false`
	 * filters. Lands in T8b.
	 */
	findAllForAdmin(
		_query: ListReviewsQueryDtoShape,
	): Promise<ListReviewsResultShape> {
		return Promise.resolve({
			data: [],
			total: 0,
			page: 1,
			pageSize: 20,
		});
	}

	// --- T8c: admin write paths (placeholders) ------------------------

	/**
	 * `PATCH /api/v1/admin/reviews/:id/approve` — toggles `isApproved`.
	 * Idempotent (called twice = original value). 404 on missing.
	 * Lands in T8c.
	 */
	toggleApproval(
		_id: string,
	): Promise<ReturnType<typeof toReviewResponse>> {
		return Promise.resolve({
			id: _id,
			authorName: "",
			authorRole: null,
			content: "",
			rating: 0,
			isApproved: false,
			createdAt: new Date(),
			comments: [],
		});
	}

	/**
	 * `DELETE /api/v1/admin/reviews/:id` — hard delete. The FK CASCADE
	 * removes child comments. 404 on missing. Lands in T8c.
	 */
	remove(_id: string): Promise<void> {
		return Promise.resolve();
	}

	// --- T13: comment methods (placeholders) --------------------------

	/**
	 * `POST /api/v1/reviews/:id/comments` — adds a comment. 404 on
	 * missing parent; does NOT 404 on unapproved parent (asymmetric
	 * existence-leak guard, ADR-11). Lands in T13.
	 */
	addComment(
		_reviewId: string,
		_dto: CreateReviewCommentDtoShape,
	): Promise<ReturnType<typeof toReviewResponse>> {
		return Promise.resolve({
			id: "",
			authorName: "",
			authorRole: null,
			content: "",
			rating: 0,
			isApproved: false,
			createdAt: new Date(),
			comments: [],
		});
	}

	/**
	 * `GET /api/v1/reviews/:id/comments` — paginated approved comments.
	 * 404 on missing OR unapproved parent (existence-leak guard).
	 * Lands in T13.
	 */
	findApprovedCommentsByReviewId(
		_reviewId: string,
		_query: ListCommentsQueryDtoShape,
	): Promise<ListCommentsResultShape> {
		return Promise.resolve({
			data: [],
			total: 0,
			page: 1,
			pageSize: 20,
		});
	}
}

// Local structural types so the service does not require the
// DTO classes (added in T7 / T12) to exist at the type level.
// The runtime values are the same shape as the DTOs; the DTO
// classes are `@ApiProperty`-decorated wrappers around the same
// field set.
interface ListReviewsQueryDtoShape {
	page?: number;
	pageSize?: number;
	rating?: number;
	isApproved?: boolean;
}
interface ListReviewsResultShape {
	data: Array<{ id: string }>;
	total: number;
	page: number;
	pageSize: number;
}
interface CreateReviewCommentDtoShape {
	authorName?: string;
	content: string;
}
interface ListCommentsQueryDtoShape {
	page?: number;
	pageSize?: number;
}
interface ListCommentsResultShape {
	data: Array<{ id: string }>;
	total: number;
	page: number;
	pageSize: number;
}
