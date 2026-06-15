# sdd-init report — roonder-portfolio-backend

**Date**: 2026-06-15
**Persistence mode**: openspec
**Project workspace**: /home/roonder/Personal-Development/roonder-portfolio-backend

## Detected Stack

| Concern           | Detection                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Language          | TypeScript 5.7 (`tsconfig.json` strictNullChecks on, target ES2023)                      |
| Framework         | NestJS 11 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`)                 |
| Package manager   | npm (`package-lock.json` present, no pnpm/yarn lockfiles)                                |
| Build command     | `npm run build` → `nest build` (tsc under the hood, `tsconfig.build.json`)               |
| Dev run           | `npm run start:dev` → `nest start --watch`                                               |
| Prod run          | `npm run start:prod` → `node dist/main`                                                  |
| ORM               | TypeORM 1.x with PostgreSQL driver (Supabase-hosted)                                     |
| Auth              | `@nestjs/jwt` + `passport-jwt` (in-house, single admin)                                  |
| Validation        | class-validator + class-transformer (DTOs), Joi for env vars                             |
| Email             | Resend SDK                                                                               |
| API docs          | `@nestjs/swagger`                                                                        |
| CORS              | `cors` package                                                                           |
| Lint              | ESLint 9 flat config (`eslint.config.mjs`) + typescript-eslint type-checked + prettier   |
| Format            | Prettier (`tabs`, `single quotes`, `trailing commas`)                                    |
| Type check        | tsc via `nest build`                                                                     |

## Detected Architecture

- **Pattern**: NestJS module-per-domain (screaming architecture). Each top-level folder under `src/` IS a domain, not a technical layer.
- **Module layout** (under `src/`):
  - `auth/` — controller, service, dto/, entities/, module, plus colocated `*.spec.ts`
  - `projects/` — same shape
  - `reviews/` — same shape
  - `contact/` — same shape
  - `config/` — `env.config.ts` (Joi-based env validation, expected entry per `openspec/specs/server_specs.md`)
- **Cross-cutting**:
  - `main.ts` — bootstrap (currently minimal: NestFactory.create + listen; CORS, ValidationPipe, Swagger, etc. not yet wired in)
  - `app.module.ts` — imports the four domain modules
- **Naming**: kebab-case file names (`projects.controller.ts`), `.module.ts` / `.controller.ts` / `.service.ts` / `.dto.ts` / `.entity.ts` suffixes, DTOs nested in `dto/`, persistence in `entities/`.
- **Tests colocated**: `*.spec.ts` next to source files inside `src/`. E2E specs in `test/`.

## Detected Testing Capability

- **Test runner**: Jest 30 + ts-jest, configured inline in `package.json`.
  - Unit: `npm test` (or `npm run test:watch` for watch mode)
  - E2E: `npm run test:e2e` (uses `test/jest-e2e.json`)
  - Coverage: `npm run test:cov`
  - Debug: `npm run test:debug`
- **Test layers**:
  - Unit: yes (colocated `*.spec.ts`)
  - Integration: yes (supertest + @nestjs/testing in `test/*.e2e-spec.ts`)
  - E2E: yes (boots full `AppModule` against an in-memory Nest app)
- **Coverage**: `jest --coverage` available, output to `../coverage`, no threshold enforced.
- **Strict TDD**: FEASIBLE — `npm test` runs ts-jest on `.spec.ts` and `.ts` files uniformly, so RED-GREEN-REFACTOR works. The codebase already has starter specs in every module.

## Specs Layout (standard OpenSpec)

- Specs in this project live under **`openspec/specs/`** (standard OpenSpec layout).
- Files detected:
  - `openspec/specs/server_specs.md` — backend NestJS design (Auth, Projects, Reviews, Contact domains, JWT auth, env validation, Resend)
  - `openspec/specs/ui_specs.md` — frontend (React + Vite) design (Bento layout, SWR, React Hook Form, framer-motion)
  - `openspec/specs/database-schema.dbml` — PostgreSQL schema (users, projects, project_urls, reviews, review_comments, contacts)
- Delta specs from `sdd-spec` will be stored at `openspec/changes/{change-name}/specs/...` per the convention; **archive** will merge deltas back into `openspec/specs/server_specs.md` (or `ui_specs.md`) — see `openspec/config.yaml > archive` rules.

## Persisted Artifacts

| Path                                                              | Purpose                                            |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| `openspec/config.yaml`                                            | SDD project config + rules (incl. `specs_layout`)  |
| `openspec/changes/`                                               | Active change folders (empty)                      |
| `openspec/changes/archive/`                                       | Archived changes (empty)                           |
| `.atl/testing-capabilities.md`                                    | Detected testing capability + strict TDD verdict   |
| `.atl/skill-registry.md`                                          | Index of available skills for sub-agents           |
| `.atl/sdd-init-report.md`                                         | This report                                        |

## Skill Resolution Summary

- The project matches: **sdd-init, sdd-explore, sdd-propose, sdd-spec, sdd-design, sdd-tasks, sdd-apply, sdd-verify, sdd-archive** (the full SDD pipeline).
- Domain skills most likely needed: `github-pr`, `branch-pr`, `work-unit-commits`, `comment-writer`, `issue-creation`, `typescript`.
- No project-level `skills/` directory detected — only system-wide skills at `~/.config/opencode/skills/`.

## Next Recommended Step

- The project has an existing design in `openspec/specs/server_specs.md` (backend) and `openspec/specs/ui_specs.md` (frontend), but `src/` only has scaffolding stubs (no real implementations beyond `main.ts` and `app.module.ts`). A reasonable next step is `/sdd-explore` to pick a concrete first change, or `/sdd-new` to formalize one of the four domains (auth, projects, reviews, contact) as the first change.
- Suggested first change to formalize: **auth** (smallest closed loop — login, JWT, guard) or **contact** (event-driven flow with Resend is interesting but bigger).
