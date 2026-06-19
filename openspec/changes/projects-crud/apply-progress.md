# Apply progress — projects-crud

## PR1 — Foundation (started 2026-06-18)
Anchored by commit: chore(sdd): pr1-foundation start
Scope: 2 entities (Project, ProjectUrl) + DataSource registration + DBML delta + first TypeORM migration + AllExceptionsFilter + main.ts wiring + NODE_ENV env config.

| Task | Title | Status | Commit | Note |
|------|-------|--------|--------|------|
| 1.1  | Project entity | ✅ | 80d11c6 | 10 columns + uuid pk + slug unique + isPublished default false + tags text[] + one-to-many (string target, resolved in 1.2) |
| 1.2  | ProjectUrl entity | ✅ | 926e566 | 6 columns + project_id snake_case + @JoinColumn + @ManyToOne onDelete: CASCADE |
| 1.3  | DataSource registration | ✅ | c259ea2 | Added Project + ProjectUrl to entities array; added migrations glob |
| 1.4  | DBML delta | ✅ | 1e2170b | tags varchar[]→text[]; CASCADE note on FK; 2 indexes (slug_lower, tags_gin) |
| 1.5  | TypeORM migration | ✅ | 66369dd | Hand-written 20260618205116-create-projects-and-project-urls.ts; FK CASCADE + slug_lower + tags_gin indexes |
| 1.6  | AllExceptionsFilter HttpException path | ✅ | 3a79ac4 | Envelope { statusCode, error, message, timestamp, path } for 404/400 (string[])/409 |
| 1.7  | AllExceptionsFilter raw Error path + prod/dev | ✅ | a3d563e | Added 2 specs (prod sanitize, dev full message) + 5xx log context (requestId, userId, method, path, stack). Implementation already in 3a79ac4. |
| 1.8  | Wire filter globally in main.ts | ✅ | af18e3d | useGlobalFilters(new AllExceptionsFilter(HttpAdapterHost, ConfigService)) + main.spec.ts wiring assertion |
| 1.9  | NODE_ENV in env.config.ts Joi schema | ✅ | 0c2bba9 | Joi.valid('development','test','production').default('development') + 5 spec cases |
