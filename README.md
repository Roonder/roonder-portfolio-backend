# roonder-portfolio-backend

RESTful API for a personal portfolio, built with NestJS 11, TypeORM, and PostgreSQL. Single-admin in-house JWT auth, public read endpoints, and a contact flow that dispatches email through Resend.

> **Status:** scaffolding. The HTTP bootstrap is wired (global `/api/v1` prefix, Joi-validated `ConfigModule`, global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`, CORS from `FRONTEND_URL`, and Swagger at `/api/v1/docs`), but the four domain modules are still stubbed. Treat this as the foundation, not a finished product.

## Stack

- **Runtime:** Node.js, TypeScript 5.7
- **Framework:** NestJS 11 (module-per-domain, screaming layout)
- **ORM:** TypeORM 1.x with PostgreSQL (Supabase-hosted)
- **Auth:** `@nestjs/jwt` + `passport-jwt` (in-house, single admin)
- **Validation:** `class-validator` + `class-transformer` (DTOs), `Joi` for env vars
- **Email:** `resend` SDK via NestJS `EventEmitter2`
- **API docs:** `@nestjs/swagger` mounted at `/api/v1/docs` (JSON spec at `/api/v1/docs-json`)
- **CORS:** `cors` package, configured from `FRONTEND_URL` with `credentials: true`
- **Testing:** Jest 30 + ts-jest, supertest + `@nestjs/testing` for E2E

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- npm
- A PostgreSQL database (Supabase works out of the box)
- A Resend API key for the contact flow

### Install

```bash
npm install
```

### Environment variables

Create a `.env` file at the project root. The server **refuses to boot** if any of these are missing — they are validated by Joi at startup.

```env
PORT=3000
DATABASE_URL=postgres://user:password@host:5432/db
JWT_SECRET=replace-with-a-long-random-string
RESEND_API_KEY=re_xxx
FRONTEND_URL=http://localhost:5173
```

See `openspec/specs/server_specs.md` (section 4) for the source-of-truth list.

### Run

```bash
# Dev with watch + reload
npm run start:dev

# Debug mode (--inspect + watch)
npm run start:debug

# Production build + start
npm run build
npm run start:prod
```

The server listens on `PORT` (default `3000`).

## Scripts

| Command               | What it does                                              |
| --------------------- | --------------------------------------------------------- |
| `npm run build`       | Compile TypeScript via `nest build`                       |
| `npm run start`       | Start once (no watch)                                     |
| `npm run start:dev`   | Start with watch + reload                                 |
| `npm run start:debug` | Start with inspector + watch                              |
| `npm run start:prod`  | Run compiled `dist/main`                                  |
| `npm test`            | Run unit tests (`*.spec.ts` colocated in `src/`)          |
| `npm run test:watch`  | Run unit tests in watch mode                              |
| `npm run test:cov`    | Run unit tests with coverage report                       |
| `npm run test:debug`  | Run unit tests with Node inspector                        |
| `npm run test:e2e`    | Run E2E tests in `test/` via `jest-e2e.json`              |
| `npm run lint`        | ESLint with auto-fix on `src/`, `apps/`, `libs/`, `test/` |
| `npm run format`      | Prettier on `src/**/*.ts` and `test/**/*.ts`              |

## Project Structure

```
src/
├── main.ts                      # HTTP bootstrap (currently minimal)
├── app.module.ts                # Root module: imports all domain modules
├── config/
│   └── env.config.ts            # Joi schema for env validation
├── auth/                        # Auth domain (controller, service, dto/, entities/)
├── projects/                    # Projects domain
├── reviews/                     # Reviews domain
└── contact/                     # Contact domain

test/                            # E2E specs (*.e2e-spec.ts) + jest-e2e.json
openspec/                        # Spec-Driven Development artifacts
├── config.yaml                  # SDD project config + phase rules
├── changes/                     # Active changes (one folder per change)
└── specs/
    ├── server_specs.md          # Backend design source of truth
    ├── ui_specs.md              # Frontend design (companion repo)
    └── database-schema.dbml     # PostgreSQL schema (DBML)
```

Each domain module under `src/` follows the same shape:

```
domain/
├── domain.module.ts
├── domain.controller.ts
├── domain.controller.spec.ts
├── domain.service.ts
├── domain.service.spec.ts
├── dto/                         # create-*, update-*
└── entities/                    # TypeORM entities
```

Unit tests are colocated next to the source they cover.

## API Surface

All HTTP routes are mounted under the global **`/api/v1`** prefix (see `src/main.ts` → `app.setGlobalPrefix('api/v1')`). The unprefixed paths below 404. See `openspec/specs/server_specs.md` for the full design. Summary:

### Swagger

- **UI:** [`/api/v1/docs`](http://localhost:3000/api/v1/docs) — interactive documentation.
- **JSON spec:** `/api/v1/docs-json` — raw OpenAPI 3.0 document (use this for codegen / clients).
- **Auth scheme:** Bearer JWT, registered via `addBearerAuth()`.

### Auth

| Method | Path                   | Auth   | Purpose                            |
| ------ | ---------------------- | ------ | ---------------------------------- |
| POST   | `/api/v1/auth/login`   | Public | Authenticate admin, return JWT     |
| GET    | `/api/v1/auth/profile` | JWT    | Return authenticated admin profile |

### Projects

| Method | Path                      | Auth   | Purpose                                          |
| ------ | ------------------------- | ------ | ------------------------------------------------ |
| GET    | `/api/v1/projects`        | Public | List projects (paginated, `is_published` filter) |
| GET    | `/api/v1/projects/:slug`  | Public | Project detail by slug                           |
| POST   | `/api/v1/projects`        | JWT    | Create project                                   |
| PATCH  | `/api/v1/projects/:id`    | JWT    | Update project                                   |
| DELETE | `/api/v1/projects/:id`    | JWT    | Delete project                                   |

`cover_image` stores a URL; uploads are intended to use pre-signed URLs against a Supabase Storage bucket.

### Reviews

| Method | Path                                 | Auth   | Purpose                                      |
| ------ | ------------------------------------ | ------ | -------------------------------------------- |
| POST   | `/api/v1/reviews`                    | Public | Submit review (`is_approved: false` default) |
| GET    | `/api/v1/reviews`                    | Public | List approved reviews                        |
| GET    | `/api/v1/admin/reviews`              | JWT    | List all reviews (admin)                     |
| PATCH  | `/api/v1/admin/reviews/:id/approve`  | JWT    | Toggle approval                              |
| POST   | `/api/v1/reviews/:id/comments`       | Public | Add comment to a review                      |
| DELETE | `/api/v1/admin/reviews/:id`          | JWT    | Delete review (admin)                        |

### Contact

| Method | Path                       | Auth   | Purpose                                                                      |
| ------ | -------------------------- | ------ | ---------------------------------------------------------------------------- |
| POST   | `/api/v1/contacts`         | Public | Submit contact form (validates, persists, dispatches email async via Resend) |
| GET    | `/api/v1/admin/contacts`   | JWT    | List contact log (admin)                                                     |
| PATCH  | `/api/v1/admin/contacts/:id` | JWT    | Mark contact as read/replied (admin)                                         |

The contact flow uses `EventEmitter2` to dispatch the email asynchronously and records the outcome in `email_sent_log`.

### DTO conventions

The global `ValidationPipe` is configured with `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true`, and `transformOptions: { enableImplicitConversion: true }` (see `src/main.ts`). With `enableImplicitConversion`, the pipe uses `class-transformer`'s `plainToInstance` to coerce incoming values to the DTO's declared types. To keep coercion **sound**, follow this convention:

- **`@Query()` and `@Param()` DTOs** — wire formats are strings, so implicit conversion is the intended behaviour. **You MUST** annotate numeric and date fields with `@Type(() => Number)` / `@Type(() => Date)` to get safe coercion:
  ```ts
  import { Type } from "class-transformer";
  import { IsInt, IsOptional, Min } from "class-validator";

  export class ListProjectsQueryDto {
  	@IsOptional()
  	@Type(() => Number)
  	@IsInt()
  	@Min(1)
  	page?: number = 1;
  }
  ```
- **`@Body()` DTOs** — clients send JSON; numeric/date values arrive as native types or as strings by accident. Let the strict pipe reject malformed values. **Do NOT** add `@Type(() => Number)` / `@Type(() => Date)` on body fields, or you risk silent coercion (e.g. a `slug` field getting a Number if the wire says so).

## Testing

Unit tests run with `npm test`. They are colocated as `*.spec.ts` inside `src/` (Jest `rootDir: src`, `testRegex: .*\\.spec\\.ts$`) and exercise the same modules the runtime imports.

E2E tests live in `test/` as `*.e2e-spec.ts` and use supertest against a booted `AppModule`:

```bash
npm run test:e2e
```

Coverage:

```bash
npm run test:cov
# Output in ./coverage
```

No coverage threshold is enforced. Raise it as the project matures — do it as a focused change so review stays small.

## Linting and Formatting

- ESLint 9 flat config with `typescript-eslint` (type-checked) + `prettier` plugin
- Prettier: tabs, single quotes, trailing commas

```bash
npm run lint
npm run format
```

## Spec-Driven Development

This project uses SDD (Spec-Driven Development) for non-trivial changes. The artifact store is file-based under `openspec/`.

- `openspec/specs/` — source of truth for the backend, frontend, and database schema
- `openspec/changes/{change-name}/` — active change artifacts (proposal, delta specs, design, tasks)
- `openspec/changes/archive/` — completed changes
- `openspec/config.yaml` — phase rules, test/build/lint commands, and `specs_layout`

The full SDD pipeline:

```
proposal -> specs --> tasks -> apply -> verify -> archive
             ^
             |
           design
```

`proposal` and `design` are run as needed; `specs` feeds both `design` and `tasks`. See `openspec/config.yaml` for the per-phase rules this project follows.

## License

[MIT](./LICENSE) — see the [LICENSE](./LICENSE) file for full text.
