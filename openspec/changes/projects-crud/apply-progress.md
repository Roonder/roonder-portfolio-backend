# Apply progress — projects-crud

## PR1 — Foundation (started 2026-06-18)
Anchored by commit: chore(sdd): pr1-foundation start
Scope: 2 entities (Project, ProjectUrl) + DataSource registration + DBML delta + first TypeORM migration + AllExceptionsFilter + main.ts wiring + NODE_ENV env config.

| Task | Title | Status | Commit | Note |
|------|-------|--------|--------|------|
| 1.1  | Project entity | ✅ | 80d11c6 | 10 columns + uuid pk + slug unique + isPublished default false + tags text[] + one-to-many (string target, resolved in 1.2) |
| 1.2  | ProjectUrl entity | pending | — | — |
| 1.3  | DataSource registration | pending | — | — |
| 1.4  | DBML delta | pending | — | — |
| 1.5  | TypeORM migration | pending | — | — |
| 1.6  | AllExceptionsFilter HttpException path | pending | — | — |
| 1.7  | AllExceptionsFilter raw Error path + prod/dev | pending | — | — |
| 1.8  | Wire filter globally in main.ts | pending | — | — |
| 1.9  | NODE_ENV in env.config.ts Joi schema | pending | — | — |
