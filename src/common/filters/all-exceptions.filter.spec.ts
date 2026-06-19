import {
	BadRequestException,
	ConflictException,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import type { ArgumentsHost, HttpServer } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AllExceptionsFilter } from "./all-exceptions.filter";

// Capture the body that the filter writes via
// `httpAdapter.reply(res, body, status)`. We fake the adapter so we
// can assert on the shape + headers without spinning up Nest.
function makeAdapterHost(): {
	httpAdapter: HttpServer;
	host: HttpAdapterHost;
	reply: jest.Mock;
} {
	const reply: jest.Mock = jest.fn();
	// Bind the mock to a stable `this` so the
	// `@typescript-eslint/unbound-method` rule doesn't flag the
	// pull-out of `httpAdapter.reply` below. The function never
	// reads `this`, so the binding is a no-op semantically.
	const replyBound: jest.Mock = reply.bind(null) as jest.Mock;
	const httpAdapter: HttpServer = {
		reply: replyBound as unknown as HttpServer["reply"],
	} as unknown as HttpServer;
	return {
		httpAdapter,
		host: { httpAdapter } as unknown as HttpAdapterHost,
		reply,
	};
}

function makeHost(
	overrides: Partial<{
		originalUrl: string;
		method: string;
		id: string | undefined;
		user: { id: string } | undefined;
	}> = {},
): ArgumentsHost {
	return {
		switchToHttp: () => ({
			getRequest: <T = unknown>() =>
				({
					originalUrl: overrides.originalUrl ?? "/api/v1/projects/x",
					method: overrides.method ?? "GET",
					id: overrides.id,
					user: overrides.user,
				}) as T,
			getResponse: <T = unknown>() => ({}) as T,
			getNext: <T = unknown>() => ({}) as T,
		}),
	} as unknown as ArgumentsHost;
}

describe("AllExceptionsFilter — raw Error path + prod/dev branch", () => {
	let reply: jest.Mock;
	let host: HttpAdapterHost;
	let config: ConfigService;
	let filter: AllExceptionsFilter;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		errorSpy = jest
			.spyOn(Logger.prototype, "error")
			.mockImplementation(() => {});
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	function buildFilter(nodeEnv: string | undefined): AllExceptionsFilter {
		const env = makeAdapterHost();
		reply = env.reply;
		host = env.host;
		const getMock: jest.Mock = jest.fn(() => nodeEnv);
		config = { get: getMock } as unknown as ConfigService;
		return new AllExceptionsFilter(host, config);
	}

	it("raw Error in production is sanitized to 500 with a generic message; no internal strings leak", () => {
		filter = buildFilter("production");
		const exception = new Error(
			"postgres ECONNREFUSED on host 10.0.0.5:5432",
		);
		filter.catch(
			exception,
			makeHost({
				originalUrl: "/api/v1/projects",
				method: "POST",
				id: "req-abc",
				user: { id: "user-1" },
			}),
		);
		expect(reply).toHaveBeenCalledTimes(1);
		const [, body, status] = reply.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
			number,
		];
		expect(status).toBe(500);
		expect(body).toMatchObject({
			statusCode: 500,
			error: "Internal Server Error",
			message: "Internal server error",
			path: "/api/v1/projects",
		});
		// Sanitization: the body MUST NOT contain the original
		// internal strings (host, port, lib name, error class).
		const serialized = JSON.stringify(body);
		expect(serialized).not.toMatch(/postgres/);
		expect(serialized).not.toMatch(/ECONNREFUSED/);
		expect(serialized).not.toMatch(/10\.0\.0\.5/);
		// No `stack` field in the body — the spec is explicit about
		// the canonical envelope having only the 5 fixed keys.
		expect(Object.keys(body).sort()).toEqual(
			["error", "message", "path", "statusCode", "timestamp"].sort(),
		);
		// 5xx → server-side log fired with the full diagnostic
		// context (requestId, userId, method, path, stack).
		expect(errorSpy).toHaveBeenCalledTimes(1);
		const logArg = (errorSpy.mock.calls[0] as unknown[])[0] as Record<
			string,
			unknown
		>;
		expect(logArg.requestId).toBe("req-abc");
		expect(logArg.userId).toBe("user-1");
		expect(logArg.method).toBe("POST");
		expect(logArg.path).toBe("/api/v1/projects");
		expect(logArg.message).toMatch(/postgres ECONNREFUSED/);
		expect(typeof logArg.stack).toBe("string");
	});

	it("raw Error in development surfaces the full Error.message in the body (no stack in the body)", () => {
		filter = buildFilter("development");
		const exception = new Error(
			"postgres ECONNREFUSED on host 10.0.0.5:5432",
		);
		filter.catch(
			exception,
			makeHost({ originalUrl: "/api/v1/projects/1", method: "GET" }),
		);
		expect(reply).toHaveBeenCalledTimes(1);
		const [, body, status] = reply.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
			number,
		];
		expect(status).toBe(500);
		expect(body).toMatchObject({
			statusCode: 500,
			error: "Internal Server Error",
			message: "postgres ECONNREFUSED on host 10.0.0.5:5432",
			path: "/api/v1/projects/1",
		});
		// Canonical envelope — no `stack` field in the body even
		// in dev (the spec locks the 5-key shape; only `message` flips).
		expect(Object.keys(body).sort()).toEqual(
			["error", "message", "path", "statusCode", "timestamp"].sort(),
		);
	});
});

describe("AllExceptionsFilter — HttpException path", () => {
	let reply: jest.Mock;
	let host: HttpAdapterHost;
	let config: ConfigService;
	let filter: AllExceptionsFilter;

	beforeEach(() => {
		// Silence the Nest Logger so the test output is not polluted
		// by the 4xx info-level log lines (the filter currently logs
		// 5xx only; this is a safety net for future additions).
		jest.spyOn(Logger.prototype, "error").mockImplementation(() => {});
		jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
		const env = makeAdapterHost();
		// Use the original `jest.fn()` reference (not the bound
		// adapter shim) so the spec can introspect `.mock.calls`.
		reply = env.reply;
		host = env.host;
		const getMock: jest.Mock = jest.fn(() => "development");
		config = { get: getMock } as unknown as ConfigService;
		filter = new AllExceptionsFilter(host, config);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("NotFoundException renders the canonical 404 envelope", () => {
		const exception = new NotFoundException("Project not found");
		filter.catch(
			exception,
			makeHost({ originalUrl: "/api/v1/projects/x" }),
		);
		expect(reply).toHaveBeenCalledTimes(1);
		const call = reply.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
			number,
		];
		const [res, body, status] = call;
		expect(status).toBe(404);
		expect(body).toMatchObject({
			statusCode: 404,
			error: "Not Found",
			message: "Project not found",
			path: "/api/v1/projects/x",
		});
		// `timestamp` MUST be an ISO-8601 string.
		const ts = body.timestamp as string;
		expect(typeof ts).toBe("string");
		expect(new Date(ts).toISOString()).toBe(ts);
		// No extras — the envelope is the only body.
		expect(Object.keys(body).sort()).toEqual(
			["error", "message", "path", "statusCode", "timestamp"].sort(),
		);
		// `res` is the empty response object the host handed us.
		expect(res).toEqual({});
	});

	it("BadRequestException from the global ValidationPipe renders the canonical 400 envelope with a string[] message", () => {
		// ValidationPipe emits a BadRequestException with a string[]
		// message (one entry per failed constraint). The filter MUST
		// surface that array unchanged.
		const validationMessage = [
			"title must be a string",
			"slug is required",
		];
		const exception = new BadRequestException({
			statusCode: 400,
			error: "Bad Request",
			message: validationMessage,
		});
		filter.catch(exception, makeHost({ originalUrl: "/api/v1/projects" }));
		expect(reply).toHaveBeenCalledTimes(1);
		const [, body, status] = reply.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
			number,
		];
		expect(status).toBe(400);
		expect(body).toMatchObject({
			statusCode: 400,
			error: "Bad Request",
			message: validationMessage,
			path: "/api/v1/projects",
		});
	});

	it("ConflictException renders the canonical 409 envelope with the STATUS_LABELS fallback when no error field is provided", () => {
		// `new ConflictException('Slug already in use')` produces a
		// response object with shape `{ statusCode, error, message }`
		// where `error` is "Conflict". The filter MUST use the
		// response's `error` if present, otherwise the STATUS_LABELS
		// map's entry for the status code.
		const exception = new ConflictException("Slug already in use");
		filter.catch(exception, makeHost({ originalUrl: "/api/v1/projects" }));
		const [, body, status] = reply.mock.calls[0] as [
			unknown,
			Record<string, unknown>,
			number,
		];
		expect(status).toBe(409);
		expect(body).toMatchObject({
			statusCode: 409,
			error: "Conflict",
			message: "Slug already in use",
			path: "/api/v1/projects",
		});
	});
});
