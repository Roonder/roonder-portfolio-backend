# Software Design Document (SDD) - Backend (Nest.js)

## 1. Architectural Overview

The backend will serve as a monolithic RESTful API built with Nest.js, focusing on dynamic content management for the portfolio.

- **Language:** TypeScript (Strict Mode).
- **Framework:** Nest.js.
- **ORM:** TypeORM (Driver: PostgreSQL).
- **Database:** PostgreSQL (Hosted on Supabase).
- **Environment Validation**: Joi.
- **Data Validation:** class-validator and class-transformer (Data Transfer Objects - DTOs).

## 2. Authentication & Security (In-House)

Since the system is designed for a single administrator (the owner), a proprietary in-house authentication system will be implemented to avoid third-party dependencies.

- **Strategy:** JSON Web Tokens (JWT) via @nestjs/jwt and passport-jwt.
- **Password Hashing:** bcrypt using 12 rounds (salts) in TypeORM hooks (BeforeInsert/BeforeUpdate).
- **Route Protection:** Implementation of a global or controller-level JwtAuthGuard to protect sensitive (Admin) endpoints.
- **CORS:** Strictly configured to only allow requests from the frontend domain (Vite), with `credentials: true` and the `Access-Control-Allow-Origin` header reflecting `FRONTEND_URL`. All routes are served under the `/api/v1` global prefix (see Global API Prefix in §3 and the `api-bootstrap` capability).

## 3. Domain Specifications (Nest.js Modules)

### 3.1. Auth Domain

- `POST /api/v1/auth/login`: Authenticates the admin user and returns an access_token.
- `GET /api/v1/auth/profile`: Returns the authenticated admin profile data (Protected).

### 3.2. Projects Domain

Portfolio management.

- `GET /api/v1/projects`: Retrieves the list of projects (public, paginated, filtered by is_published).
- `GET /api/v1/projects/slug`: Retrieves detail for a single project (public).
- `POST /api/v1/projects`: Creates a new project (Protected).
- `PATCH /api/v1/projects/:id`: Updates an existing project (Protected).
- `DELETE /api/v1/projects/:id`: Deletes a project (Protected).

`Note: Image handling (cover_image) will store the URL. File uploads can be managed via pre-signed URLs targeting a Supabase Storage bucket.`

### 3.3. Reviews Domain

Testimonial system.

- `POST /api/v1/reviews`: Allows a visitor to submit a review (Public). By default, created with is_approved: false.
- `GET /api/v1/reviews`: Lists approved reviews (Public).
- `GET /api/v1/admin/reviews`: Lists all reviews for management (Protected).
- `PATCH /api/v1/admin/reviews/:id/approve`: Toggles approval status (Protected).
- `POST /api/v1/reviews/:id/comments`: Adds a comment to a specific review (Public).
- `DELETE /api/v1/admin/reviews/:id`: Deletes a review (Protected).

### 3.4. Contact Domain

Mail delivery and logging.

- `POST /api/v1/contacts`: Receives a contact form.

**Business Logic:**

- Validates the DTO via the global `ValidationPipe` (whitelist, transform, forbidNonWhitelisted, enableImplicitConversion).
- Saves the record in the database (PostgreSQL) with an initial status.
- Emits an asynchronous event (NestJS EventEmitter2) to trigger the email service.
- The Email service connects to Resend via its SDK.
- Updates the contact record (email_sent_log) confirming the dispatch.

- `GET /api/v1/admin/contacts`: Lists the log of received emails (Protected)
  .
- `PATCH /api/v1/admin/contacts/:id`: Marks a contact as read/replied (Protected).

### 3.5. Global API Prefix

All HTTP routes defined by the Auth, Projects, Reviews, and Contact domains MUST be reachable only under the global `/api/v1` prefix. The full semantics of the prefix, including scenarios, are defined in the `api-bootstrap` capability spec (see `openspec/specs/api-bootstrap/spec.md`, Requirement: Global API Prefix).

## 4. Environment Variable Management (Joi Validation)

Joi will be used in ConfigModule.forRoot() to guarantee that the server does not boot if critical credentials are missing.
Required variables: `PORT, DATABASE_URL, JWT_SECRET, RESEND_API_KEY, FRONTEND_URL`.
