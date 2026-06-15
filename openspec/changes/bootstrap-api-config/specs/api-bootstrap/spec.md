# api-bootstrap

This is a NEW cross-cutting HTTP bootstrap capability. It defines how the NestJS
application is wired at boot: global API prefix, request validation, CORS,
Swagger surface, and typed environment access. Domain modules (Auth, Projects,
Reviews, Contact) live in `server_specs.md` and are not affected by this delta.

## ADDED Requirements

### Requirement: Global API Prefix

The application MUST mount every HTTP route under the `/api/v1` prefix. The
prefix SHALL be applied globally at bootstrap time. Routes declared in domain
controllers MUST be reachable at `<domain-path>` prefixed with `/api/v1`; the
bare `<domain-path>` (e.g. `/auth/login`) MUST return `404 Not Found`.

#### Scenario: Domain route is reachable under the prefix

- GIVEN the application is running
- WHEN a client sends `POST /api/v1/auth/login` with valid credentials
- THEN the Auth controller handles the request and returns a response

#### Scenario: Unprefixed domain route is rejected

- GIVEN the application is running
- WHEN a client sends `POST /auth/login`
- THEN the response is `404 Not Found`

### Requirement: Global Validation Pipe

The application MUST register a global `ValidationPipe` for every HTTP route
with the following options: `whitelist: true`, `transform: true`,
`forbidNonWhitelisted: true`, and `transformOptions: { enableImplicitConversion: true }`.
A request body or query that contains a property not declared on the receiving
DTO MUST be rejected with `400 Bad Request`.

#### Scenario: Request with only DTO-declared fields succeeds

- GIVEN an endpoint bound to a DTO that declares field `email`
- WHEN a client sends `POST <endpoint>` with body `{ "email": "x@y.z" }`
- THEN the controller method is invoked and the DTO is populated

#### Scenario: Request with an unknown field is rejected

- GIVEN an endpoint bound to a DTO that declares field `email`
- WHEN a client sends `POST <endpoint>` with body `{ "email": "x@y.z", "isAdmin": true }`
- THEN the response is `400 Bad Request` and the controller method is not invoked

### Requirement: CORS Reflecting Frontend Origin

The application MUST enable CORS using the value of the `FRONTEND_URL`
environment variable (validated by the `ENV_CONFIG` Joi schema) as the
`Access-Control-Allow-Origin` response header. The `credentials` flag MUST be
set to `true`. Requests originating from a different origin MUST NOT receive a
matching `Access-Control-Allow-Origin` header.

#### Scenario: Preflight from the configured frontend origin succeeds

- GIVEN `FRONTEND_URL` is set to `https://app.example.com`
- WHEN a client sends an `OPTIONS` preflight to any route with an
  `Origin: https://app.example.com` header
- THEN the response includes `Access-Control-Allow-Origin: https://app.example.com`
- AND the response includes `Access-Control-Allow-Credentials: true`

#### Scenario: Preflight from a different origin is not echoed

- GIVEN `FRONTEND_URL` is set to `https://app.example.com`
- WHEN a client sends an `OPTIONS` preflight with an
  `Origin: https://evil.example.com` header
- THEN the response does NOT include
  `Access-Control-Allow-Origin: https://evil.example.com`

### Requirement: Swagger API Documentation

The application MUST expose the OpenAPI documentation at `/api/v1/docs` and the
underlying JSON spec at `/api/v1/docs-json`. The Swagger UI MUST advertise
bearer-token authentication registered through `addBearerAuth()`. The OpenAPI
document MUST declare title `"Roonder Portfolio API"` and version `"1.0"`.

#### Scenario: Swagger UI is reachable

- GIVEN the application is running
- WHEN a client sends `GET /api/v1/docs`
- THEN the response is `200 OK` and the body is the Swagger UI HTML

#### Scenario: Swagger JSON is reachable and shaped correctly

- GIVEN the application is running
- WHEN a client sends `GET /api/v1/docs-json`
- THEN the response is `200 OK`
- AND the JSON body contains a top-level `openapi` property
- AND the document title is `"Roonder Portfolio API"` and version is `"1.0"`

#### Scenario: Bearer auth is advertised in the OpenAPI document

- GIVEN the application is running
- WHEN a client sends `GET /api/v1/docs-json`
- THEN the JSON body's `components.securitySchemes` includes a bearer auth
  scheme registered via `addBearerAuth()`

### Requirement: Typed Environment Access via ConfigService

The application MUST read environment variables through the NestJS
`ConfigService` typed against the existing `EnvConfig` interface, and MUST use
the `ENV_CONFIG` Joi schema for validation. The `bootstrap()` function in
`main.ts` MUST NOT read any environment variable directly via `process.env.*`.
The `ConfigModule` MUST be registered with `isGlobal: true` and `cache: true`
so that subsequent `ConfigService.get()` calls are served from cache.

#### Scenario: Server port is read from ConfigService

- GIVEN `PORT=4000` is set in the process environment
- WHEN the application bootstraps
- THEN `ConfigService.get('PORT', { infer: true })` returns `4000`
- AND `main.ts` does not contain any `process.env.PORT` reference

#### Scenario: Missing required env var prevents boot

- GIVEN `JWT_SECRET` is absent from the process environment
- WHEN the application bootstraps
- THEN the application throws a configuration error referencing the
  `ENV_CONFIG` Joi schema
- AND the HTTP listener is never started

## Out of Scope

Domain implementations, DTO shapes, coverage thresholds, `tsconfig` strict
tightening, custom exception filter, custom `ConfigService` augmentation.
