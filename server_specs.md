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
- **CORS:** Strictly configured to only allow requests from the frontend domain (Vite).

## 3. Domain Specifications (Nest.js Modules)

### 3.1. Auth Domain

- `POST /auth/login`: Authenticates the admin user and returns an access_token.
- `GET /auth/profile`: Returns the authenticated admin profile data (Protected).

### 3.2. Projects Domain

Portfolio management.

- `GET /projects`: Retrieves the list of projects (public, paginated, filtered by is_published).
- `GET /projects/slug`: Retrieves detail for a single project (public).
- `POST /projects`: Creates a new project (Protected).
- `PATCH /projects/:id`: Updates an existing project (Protected).
- `DELETE /projects/:id`: Deletes a project (Protected).

`Note: Image handling (cover_image) will store the URL. File uploads can be managed via pre-signed URLs targeting a Supabase Storage bucket.`

### 3.3. Reviews Domain

Testimonial system.

- `POST /reviews`: Allows a visitor to submit a review (Public). By default, created with is_approved: false.
- `GET /reviews`: Lists approved reviews (Public).
- `GET /admin/reviews`: Lists all reviews for management (Protected).
- `PATCH /admin/reviews/:id/approve`: Toggles approval status (Protected).
- `POST /reviews/:id/comments`: Adds a comment to a specific review (Public).
- `DELETE /admin/reviews/:id`: Deletes a review (Protected).

### 3.4. Contact Domain

Mail delivery and logging.

- `POST /contacts`: Receives a contact form.

**Business Logic:**

- Validates the DTO.
- Saves the record in the database (PostgreSQL) with an initial status.
- Emits an asynchronous event (NestJS EventEmitter2) to trigger the email service.
- The Email service connects to Resend via its SDK.
- Updates the contact record (email_sent_log) confirming the dispatch.

- `GET /admin/contacts`: Lists the log of received emails (Protected)
  .
- `PATCH /admin/contacts/:id`: Marks a contact as read/replied (Protected).

## 4. Environment Variable Management (Joi Validation)

Joi will be used in ConfigModule.forRoot() to guarantee that the server does not boot if critical credentials are missing.
Required variables: `PORT, DATABASE_URL, JWT_SECRET, RESEND_API_KEY, FRONTEND_URL`.
