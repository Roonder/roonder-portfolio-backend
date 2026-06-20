# global-exception-filter

This is a NEW cross-cutting capability. It owns the single
`AllExceptionsFilter` registered as a global exception filter, and the
canonical JSON error envelope every HTTP response MUST carry on failure.
The filter is wired once in `src/main.ts` via `app.useGlobalFilters(...)`
and is reused by every domain (Auth, Projects, Reviews, Contact, and
any future domain). The 4xx envelope replaces NestJS's default
`HttpException` body; the 5xx envelope sanitizes the response (no stack
trace, no internal message) and logs the full error server-side for
operators.

The filter is independent of authentication, validation, and routing. It
SITS ABOVE them. Whatever an `HttpException` (or a raw `Error`) throws
flows through the filter before reaching the client, and the response
body MUST always have the shape defined here.

## ADDED Requirements

### Requirement: HttpException Renders the Canonical 4xx Envelope

When any controller method (or any other NestJS layer) throws an
`HttpException` (or any subclass, including
`BadRequestException`, `UnauthorizedException`, `NotFoundException`,
`ConflictException`, etc.), the global filter MUST convert the response
to a JSON body of the shape:

```json
{
  "statusCode": <number>,
  "error": <string>,
  "message": <string | string[]>,
  "timestamp": <ISO-8601 string>,
  "path": <request URL string>
}
```

`statusCode` MUST match the `HttpException.getStatus()` value.
`error` MUST be a short, human-readable label (e.g. `"Not Found"`,
`"Unauthorized"`). `message` MUST be the `HttpException` message as
serialized by Nest (a string for plain messages; a string array for
validation pipe errors). `timestamp` MUST be the current time as an
ISO-8601 string captured at filter time. `path` MUST be the
`req.originalUrl` (or equivalent request URL) of the request that
triggered the exception. The response Content-Type MUST be
`application/json`.

#### Scenario: NotFoundException renders through the filter

- GIVEN a route handler throws `new NotFoundException('Project not found')`
- WHEN a client sends a request to that route
- THEN the response status is `404`
- AND the response Content-Type is `application/json`
- AND the body shape is
  `{ statusCode: 404, error: 'Not Found', message: 'Project not found', timestamp: <iso>, path: <url> }`
- AND the body contains no stack trace and no other extra fields

#### Scenario: BadRequestException from the global ValidationPipe renders through the filter

- GIVEN a request body fails the global `ValidationPipe`
- WHEN the client sends the malformed request
- THEN the response status is `400`
- AND the body shape is
  `{ statusCode: 400, error: 'Bad Request', message: <string[]>, timestamp: <iso>, path: <url> }`
- AND `message` is an array of validation messages (per
  `class-validator`'s default serialization)

#### Scenario: ConflictException renders through the filter

- GIVEN a service throws `new ConflictException('Slug already in use')`
- WHEN a client triggers that code path
- THEN the response status is `409`
- AND the body shape is
  `{ statusCode: 409, error: 'Conflict', message: 'Slug already in use', timestamp: <iso>, path: <url> }`

### Requirement: Raw Error Renders a Sanitized 500 in Production

When any code path throws a non-`HttpException` `Error` (a raw
`throw new Error('db connection lost')`, a thrown `TypeError`, a
re-thrown driver error, etc.), the global filter MUST convert the
response to a `500 Internal Server Error` JSON body that LEAKS NO
INTERNAL DETAILS in production: NO stack trace in the body, NO
exception class name, NO `message` from the original `Error`, NO
database / library / framework strings. The body shape MUST be the
canonical envelope with a fixed, generic `message` (e.g.
`"Internal server error"`) and a fixed `error` label
(`"Internal Server Error"`). The `statusCode` MUST be `500`.

#### Scenario: Raw Error in production returns a sanitized 500

- GIVEN `NODE_ENV` is `production`
- AND a service throws `throw new Error('postgres ECONNREFUSED on host 10.0.0.5:5432')`
- WHEN the client triggers that code path
- THEN the response status is `500`
- AND the body shape is
  `{ statusCode: 500, error: 'Internal Server Error', message: 'Internal server error', timestamp: <iso>, path: <url> }`
- AND the body does NOT contain the substring `'postgres'`
- AND the body does NOT contain the substring `'ECONNREFUSED'`
- AND the body does NOT contain the substring `'10.0.0.5'`
- AND the body does NOT contain a `stack` field

#### Scenario: Raw Error in development returns the full 500

- GIVEN `NODE_ENV` is `development` (or otherwise not `production`)
- AND a service throws `throw new Error('postgres ECONNREFUSED on host 10.0.0.5:5432')`
- WHEN the client triggers that code path
- THEN the response status is `500`
- AND the body `message` is the raw `Error.message` (e.g.
  `'postgres ECONNREFUSED on host 10.0.0.5:5432'`)
- AND the body shape is the canonical envelope
  (`{ statusCode, error, message, timestamp, path }`)
- AND the response Content-Type is `application/json`

#### Scenario: Filter does not double-format a NestJS HttpException

- GIVEN a controller method throws `new BadRequestException('bad input')`
- WHEN the response is rendered
- THEN the body shape is the canonical envelope exactly ONCE
- AND there is no nested `error`/`message` structure from
  Nest's default `HttpException` serializer bleeding through

### Requirement: 5xx Server-Side Log Includes Full Diagnostic Context

For every 5xx response rendered by the global filter (HttpException
with status `>= 500` OR raw `Error`), the filter MUST emit a
server-side log entry (via the NestJS `Logger` or equivalent) that
includes, at minimum:

- the full error message and stack trace (for raw `Error`s; for
  `HttpException` with status 5xx, the message at minimum),
- a `requestId` (or correlation id) if one is present on the request
  (e.g. `x-request-id` header, or a value previously attached by
  middleware),
- the authenticated user id when the request was made by a known
  user (sourced from `req.user.id` if `JwtAuthGuard` ran; otherwise
  the field is omitted or `null`),
- the HTTP `path` of the request,
- the HTTP `method` of the request.

The log entry MUST NOT be returned in the response body (production).

#### Scenario: Raw Error is logged with full context

- GIVEN a service throws a raw `Error` and the response is sanitized to 500
- WHEN the filter renders the response
- THEN a single server-side log entry is emitted
- AND the log entry contains the full `Error.message` and `Error.stack`
- AND the log entry contains the request `path` and `method`
- AND when the request carried an `x-request-id` header, the log entry
  contains that id
- AND when `req.user.id` is set (authenticated), the log entry contains
  the user id
- AND the log entry is NOT present in the response body

#### Scenario: 5xx HttpException is logged

- GIVEN a controller method throws `new InternalServerErrorException('downstream failed')`
- WHEN the filter renders the response
- THEN the response body uses the canonical envelope
- AND a server-side log entry is emitted with the same minimum context
  (message, request id, user id if any, path, method)

### Requirement: Auth Flow Body Shape Is Preserved

The global filter MUST NOT alter the body shape, status code, or
`Set-Cookie` semantics of the responses produced by the auth domain
(`/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/logout`,
`/api/v1/auth/profile`). Specifically: a `401 Unauthorized` thrown
inside the auth domain (or by `JwtAuthGuard` upstream of a controller)
MUST still be rendered as the canonical envelope, NOT as Nest's
default plain `401` text response, and the `Set-Cookie: rt=...; ...`
attribute set on successful login / refresh / logout MUST survive
intact. The filter is registered GLOBALLY; this requirement is the
explicit guarantee that the filter does not regress the auth flow that
the `auth-domain` capability shipped.

#### Scenario: 401 from JwtAuthGuard renders through the filter (no body shape change)

- GIVEN a client sends a request to a `JwtAuthGuard`-protected route
  without an `Authorization` header
- WHEN the guard throws `UnauthorizedException`
- THEN the response status is `401`
- AND the body shape is the canonical envelope
  (`{ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized', timestamp: <iso>, path: <url> }`)
- AND the body is JSON (not Nest's default plain-text 401)

#### Scenario: Successful login still sets the rt Set-Cookie

- GIVEN a client sends valid credentials to `POST /api/v1/auth/login`
- WHEN the controller returns the access token
- THEN the response carries `Set-Cookie: rt=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<n>`
- AND the filter does NOT strip or rewrite the `Set-Cookie` header

### Requirement: Filter Is Registered Globally in main.ts

The `AllExceptionsFilter` MUST be registered as a global exception
filter via `app.useGlobalFilters(new AllExceptionsFilter())` (or the
DI-aware equivalent) in `src/main.ts`'s `configureApp` function. The
registration MUST happen after the global prefix, cookie-parser,
`ValidationPipe`, CORS, and Swagger setup, so the filter's response
shape is the last word on the body before it leaves the application.
The filter MUST be instantiated and active in the production app AND
in every `Test.createTestingModule(...)` that builds the full app
(verified by the e2e suite, not just the unit suite).

#### Scenario: Filter is registered in main.ts

- GIVEN the application is running
- WHEN a request triggers an unhandled error
- THEN the response body uses the canonical envelope
- AND the canonical envelope is produced by the registered global
  filter, NOT by NestJS's default unhandled-error path

#### Scenario: Filter handles 404 on unknown routes

- GIVEN a client sends a request to a route that does not exist
  (e.g. `GET /api/v1/this-does-not-exist`)
- WHEN Nest's router throws `NotFoundException`
- THEN the response status is `404`
- AND the body is the canonical envelope
  (`{ statusCode: 404, error: 'Not Found', message: <...>, timestamp: <iso>, path: <url> }`)
- AND the body is `application/json` (not HTML)

## MODIFIED Requirements

_None. No existing requirements in `openspec/specs/server_specs.md`,
`openspec/specs/api-bootstrap/spec.md`, or `openspec/specs/auth-domain/spec.md`
are modified by this change. The filter is additive — the existing
auth-domain 401/400 body shape (the canonical envelope) is preserved
by the new filter rather than altered._

## REMOVED Requirements

_None._
