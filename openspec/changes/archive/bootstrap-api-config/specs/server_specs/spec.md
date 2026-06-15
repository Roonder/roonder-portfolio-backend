# Delta for `server_specs`

Source spec: `openspec/specs/server_specs.md`. Every domain path in §§3.1–3.4
and the CORS note in §2 gain the global `/api/v1` prefix. A new "Global API
Prefix" section is added at the top of the Domain Specifications block, which
takes precedence for path resolution (full prefix semantics live in the new
`api-bootstrap` capability spec).

## MODIFIED Requirements

### Requirement: CORS in §2 Authentication & Security

The CORS line under §2 Authentication & Security MUST read: "Strictly
configured to only allow requests from the frontend domain (Vite), with
`credentials: true` and the `Access-Control-Allow-Origin` header reflecting
`FRONTEND_URL`. All routes are served under the `/api/v1` global prefix
(see Global API Prefix in §3 and the `api-bootstrap` capability)."

(Previously: "Strictly configured to only allow requests from the frontend
domain (Vite).")

#### Scenario: CORS echoes the configured frontend origin

- GIVEN `FRONTEND_URL` is set in the environment
- WHEN the browser sends an `OPTIONS` preflight to any route
- THEN `Access-Control-Allow-Origin` matches `FRONTEND_URL`
- AND `Access-Control-Allow-Credentials` is `true`

### Requirement: Auth Domain Routes (§3.1)

The Auth domain exposes the following routes, all under the global `/api/v1`
prefix:

- `POST /api/v1/auth/login`: Authenticates the admin user and returns an
  access_token.
- `GET /api/v1/auth/profile`: Returns the authenticated admin profile data
  (Protected).

(Previously: `POST /auth/login` and `GET /auth/profile` — unprefixed.)

#### Scenario: Login route is reachable under the prefix

- GIVEN the application is running with valid credentials configured
- WHEN a client sends `POST /api/v1/auth/login` with valid credentials
- THEN the response is `200 OK` and the body contains an `access_token`

#### Scenario: Unprefixed login route is rejected

- GIVEN the application is running
- WHEN a client sends `POST /auth/login`
- THEN the response is `404 Not Found`

### Requirement: Projects Domain Routes (§3.2)

The Projects domain exposes the following routes, all under the global
`/api/v1` prefix:

- `GET /api/v1/projects`: Retrieves the list of projects (public, paginated,
  filtered by `is_published`).
- `GET /api/v1/projects/slug`: Retrieves detail for a single project (public).
- `POST /api/v1/projects`: Creates a new project (Protected).
- `PATCH /api/v1/projects/:id`: Updates an existing project (Protected).
- `DELETE /api/v1/projects/:id`: Deletes a project (Protected).

`Note: Image handling (cover_image) will store the URL. File uploads can be
managed via pre-signed URLs targeting a Supabase Storage bucket.`

(Previously: same paths without the `/api/v1` prefix.)

#### Scenario: Public project list is reachable under the prefix

- GIVEN the application is running and at least one published project exists
- WHEN a client sends `GET /api/v1/projects`
- THEN the response is `200 OK` and the body contains the paginated list

#### Scenario: Unprefixed project list is rejected

- GIVEN the application is running
- WHEN a client sends `GET /projects`
- THEN the response is `404 Not Found`

### Requirement: Reviews Domain Routes (§3.3)

The Reviews domain exposes the following routes, all under the global
`/api/v1` prefix:

- `POST /api/v1/reviews`: Allows a visitor to submit a review (Public). By
  default, created with `is_approved: false`.
- `GET /api/v1/reviews`: Lists approved reviews (Public).
- `GET /api/v1/admin/reviews`: Lists all reviews for management (Protected).
- `PATCH /api/v1/admin/reviews/:id/approve`: Toggles approval status (Protected).
- `POST /api/v1/reviews/:id/comments`: Adds a comment to a specific review
  (Public).
- `DELETE /api/v1/admin/reviews/:id`: Deletes a review (Protected).

(Previously: same paths without the `/api/v1` prefix.)

#### Scenario: Public review submission is reachable under the prefix

- GIVEN the application is running
- WHEN a client sends `POST /api/v1/reviews` with a valid review body
- THEN the response is `201 Created` and the review is stored with
  `is_approved: false`

#### Scenario: Unprefixed review submission is rejected

- GIVEN the application is running
- WHEN a client sends `POST /reviews`
- THEN the response is `404 Not Found`

### Requirement: Contact Domain Routes (§3.4)

The Contact domain exposes the following routes, all under the global
`/api/v1` prefix:

- `POST /api/v1/contacts`: Receives a contact form.

**Business Logic:**

- Validates the DTO via the global `ValidationPipe` (whitelist, transform,
  forbidNonWhitelisted, enableImplicitConversion).
- Saves the record in the database (PostgreSQL) with an initial status.
- Emits an asynchronous event (NestJS EventEmitter2) to trigger the email
  service.
- The Email service connects to Resend via its SDK.
- Updates the contact record (`email_sent_log`) confirming the dispatch.

- `GET /api/v1/admin/contacts`: Lists the log of received emails (Protected).
- `PATCH /api/v1/admin/contacts/:id`: Marks a contact as read/replied
  (Protected).

(Previously: same paths without the `/api/v1` prefix.)

#### Scenario: Public contact form is reachable under the prefix

- GIVEN the application is running
- WHEN a client sends `POST /api/v1/contacts` with a valid contact body
- THEN the response is `201 Created` and the contact is persisted

#### Scenario: Unprefixed contact form is rejected

- GIVEN the application is running
- WHEN a client sends `POST /contacts`
- THEN the response is `404 Not Found`

## ADDED Requirements

### Requirement: Global API Prefix

All HTTP routes defined by the Auth, Projects, Reviews, and Contact domains
MUST be reachable only under the global `/api/v1` prefix. The full semantics
of the prefix, including scenarios, are defined in the `api-bootstrap`
capability spec (see `openspec/changes/bootstrap-api-config/specs/api-bootstrap.md`,
Requirement: Global API Prefix).

(Previously absent — the prefix is new in this change.)

## REMOVED Requirements

_None. No requirements are removed by this change._

## RENAMED Requirements

_None._
