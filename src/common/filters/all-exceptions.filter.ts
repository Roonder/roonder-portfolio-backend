import {
	ArgumentsHost,
	Catch,
	ExceptionFilter,
	HttpException,
	HttpStatus,
	Logger,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { EnvConfig } from "../../config/env.config";

// Short, human-readable labels for the 4xx/5xx status codes the
// filter sees in practice. Mirrors Nest's default labels so the
// `error` field on the envelope reads naturally.
const STATUS_LABELS: Record<number, string> = {
	[HttpStatus.BAD_REQUEST]: "Bad Request",
	[HttpStatus.UNAUTHORIZED]: "Unauthorized",
	[HttpStatus.FORBIDDEN]: "Forbidden",
	[HttpStatus.NOT_FOUND]: "Not Found",
	[HttpStatus.CONFLICT]: "Conflict",
	// T15: 429 from `@nestjs/throttler`'s ThrottlerException.
	// The exception's `getResponse()` does not include an
	// `error` field; the filter falls back to STATUS_LABELS so
	// the canonical envelope reads "Too Many Requests" (not the
	// generic "Error" fallback). The Retry-After header is set
	// by the throttler BEFORE the filter receives the exception
	// (per ADR-12) and is preserved because the filter does not
	// touch `res.setHeader` / `res.getHeader`.
	[HttpStatus.TOO_MANY_REQUESTS]: "Too Many Requests",
	[HttpStatus.INTERNAL_SERVER_ERROR]: "Internal Server Error",
};

/**
 * Global exception filter that renders every uncaught error in the
 * canonical envelope shape:
 *
 *     { statusCode, error, message, timestamp, path }
 *
 * - HttpException → 4xx envelope using the exception's status +
 *   `getResponse()` payload (or a `STATUS_LABELS` fallback).
 * - Raw `Error` (e.g. a thrown `TypeError` in a service) → 5xx
 *   envelope sanitized in production, full message in dev (Task 1.7).
 *
 * Wired in `src/main.ts` via `app.useGlobalFilters(...)` after the
 * CORS / Swagger setup so it is the last word on the body.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
	private readonly logger = new Logger(AllExceptionsFilter.name);

	constructor(
		private readonly httpAdapterHost: HttpAdapterHost,
		private readonly config: ConfigService<EnvConfig>,
	) {}

	catch(exception: unknown, host: ArgumentsHost): void {
		const ctx = host.switchToHttp();
		const req = ctx.getRequest<{
			originalUrl?: string;
			url?: string;
			method?: string;
			id?: string;
			user?: { id: string };
		}>();
		const res: object = ctx.getResponse();
		const isProd =
			this.config.get("NODE_ENV", { infer: true }) === "production";
		const path = req.originalUrl ?? req.url ?? "";
		const requestId = req.id;
		const method = req.method ?? "";

		let statusCode: number;
		let error: string;
		let message: string | string[];

		if (exception instanceof HttpException) {
			statusCode = exception.getStatus();
			const r = exception.getResponse();
			const obj =
				typeof r === "string"
					? { message: r }
					: (r as Record<string, unknown>);
			error =
				(obj.error as string | undefined) ??
				STATUS_LABELS[statusCode] ??
				"Error";
			message =
				(obj.message as string | string[] | undefined) ??
				exception.message;
		} else {
			// Task 1.7 fills the raw-Error branch with the prod/dev
			// 5xx sanitization. The 1.6 commit is intentionally narrow.
			statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
			error = STATUS_LABELS[statusCode];
			message = isProd
				? "Internal server error"
				: ((exception as Error)?.message ?? "Unknown error");
		}

		// Server-side log for 5xx OR raw Error.
		if (statusCode >= 500 || !(exception instanceof HttpException)) {
			this.logger.error({
				requestId,
				userId: req.user?.id,
				method,
				path,
				message: (exception as Error)?.message,
				stack: (exception as Error)?.stack,
			});
		}

		const body = {
			statusCode,
			error,
			message,
			timestamp: new Date().toISOString(),
			path,
		};
		this.httpAdapterHost.httpAdapter.reply(res, body, statusCode);
	}
}
