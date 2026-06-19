/**
 * withRetry<T> — runs an async function and retries on transient
 * Postgres errors. Used by `ProjectsService` to wrap
 * `dataSource.transaction(...)` calls so a serialization failure or
 * deadlock does not surface as a 500 to the user on a single-admin
 * workload where the contention is exceedingly rare.
 *
 * Per ADR-4 of the projects-crud design, the retryable Postgres
 * error codes are:
 *   - `40001` — `serialization_failure`. READ COMMITTED can hit this
 *     when a concurrent transaction has modified a row this
 *     transaction is trying to lock.
 *   - `40P01` — `deadlock_detected`. Two transactions waiting on
 *     each other's locks.
 *
 * Non-retryable errors throw immediately. Defaults: 3 attempts
 * total (1 initial + 2 retries), 50ms linear backoff between
 * attempts. The linear backoff is intentionally simple — the
 * single-admin profile makes exponential backoff over-engineering.
 *
 * A future change that needs more sophisticated retry behaviour
 * (exponential backoff, jitter, structured logger) can extend this
 * helper without touching the write paths.
 */

const RETRYABLE_PG_CODES = new Set(["40001", "40P01"]);

export interface WithRetryOptions {
	maxAttempts?: number;
	delayMs?: number;
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: WithRetryOptions = {},
): Promise<T> {
	const maxAttempts = options.maxAttempts ?? 3;
	const delayMs = options.delayMs ?? 50;

	let lastError: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (e) {
			lastError = e;
			const code = isPgError(e) ? e.code : undefined;
			const retryable =
				code !== undefined && RETRYABLE_PG_CODES.has(code);
			if (!retryable || attempt === maxAttempts) {
				throw e;
			}
			await sleep(delayMs * attempt);
		}
	}
	// Unreachable: the loop above always either returns or throws.
	// The throw keeps TypeScript's control-flow analysis honest.
	throw lastError;
}

function isPgError(e: unknown): e is { code: string } {
	if (typeof e !== "object" || e === null) return false;
	if (!("code" in e)) return false;
	return typeof e.code === "string";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
