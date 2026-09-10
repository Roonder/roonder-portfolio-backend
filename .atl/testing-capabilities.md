# Testing Capabilities

**Strict TDD Mode**: enabled
**Detected**: 2026-06-15
**Project**: roonder-portfolio-backend

## Test Runner

- Command: `npm test` (alias for `jest`)
- Watch mode: `npm run test:watch` (`jest --watch`)
- Debug: `npm run test:debug`
- Framework: Jest 30 with ts-jest
- Config: inline in `package.json` under `jest` key
  - `rootDir`: `src`
  - `testRegex`: `.*\\.spec\\.ts$`
  - `transform`: `ts-jest`
  - `testEnvironment`: `node`
- E2E runner: `npm run test:e2e` using `test/jest-e2e.json`
  - `testRegex`: `.e2e-spec.ts$`

## Test Layers

| Layer       | Available | Tool                              |
| ----------- | --------- | --------------------------------- |
| Unit        | yes       | Jest + ts-jest (colocated `*.spec.ts`) |
| Integration | yes       | supertest + @nestjs/testing (`*.e2e-spec.ts` in `test/`) |
| E2E         | yes       | supertest with full AppModule bootstrap |

## Coverage

- Available: yes
- Command: `npm run test:cov` (`jest --coverage`)
- `collectCoverageFrom`: `**/*.(t|j)s` (in `src/` since rootDir=src)
- `coverageDirectory`: `../coverage`
- Threshold: not configured (0 by default)

## Quality Tools

| Tool         | Available | Command                  |
| ------------ | --------- | ------------------------ |
| Linter       | yes       | `npm run lint` (ESLint 9 flat config + typescript-eslint type-checked + prettier) |
| Type checker | yes       | `tsc --noEmit` (built into `npm run build` via `nest build`) |
| Formatter    | yes       | `npm run format` (Prettier, tabs, single quotes, trailing commas) |

## Strict TDD Feasibility

- Strict TDD is FEASIBLE: Jest runs the same transform (ts-jest) on `*.spec.ts` and source `.ts` files, so tests can be authored and executed against not-yet-written code in RED-GREEN-REFACTOR cycles.
- Conventions already in place: every domain module (auth, projects, reviews, contact) has colocated `controller.spec.ts` and `service.spec.ts` files. Continue this pattern.
- Recommendation: write the failing spec first, then implement the smallest change to pass, then refactor. Use `npm run test:watch` for rapid feedback.
