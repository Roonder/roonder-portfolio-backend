import { withRetry } from "./with-retry";

describe("withRetry", () => {
	it("returns the result on first success without retrying", async () => {
		const fn = jest.fn().mockResolvedValue("ok");
		const result = await withRetry(fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on Postgres code 40001 (serialization_failure) and succeeds on second attempt", async () => {
		const fn = jest
			.fn()
			.mockRejectedValueOnce({
				code: "40001",
				message: "could not serialize access",
			})
			.mockResolvedValueOnce("ok");
		const result = await withRetry(fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("retries on Postgres code 40P01 (deadlock_detected) and succeeds on second attempt", async () => {
		const fn = jest
			.fn()
			.mockRejectedValueOnce({
				code: "40P01",
				message: "deadlock detected",
			})
			.mockResolvedValueOnce("ok");
		const result = await withRetry(fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("throws after maxAttempts on persistent 40001 (no success on any attempt)", async () => {
		const err = { code: "40001", message: "could not serialize access" };
		const fn = jest.fn().mockRejectedValue(err);
		await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toBe(err);
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("throws immediately on non-retryable error (no retry, no backoff)", async () => {
		const err = new Error("boom");
		const fn = jest.fn().mockRejectedValue(err);
		await expect(withRetry(fn)).rejects.toBe(err);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("respects custom maxAttempts and delayMs", async () => {
		const err = { code: "40001", message: "could not serialize access" };
		const fn = jest.fn().mockRejectedValue(err);
		await expect(
			withRetry(fn, { maxAttempts: 2, delayMs: 1 }),
		).rejects.toBe(err);
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
