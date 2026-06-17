# Design: Auth Domain (login, JWT, guard, superuser seed, refresh rotation)

## Goal & Non-Goals

**Goal.** Land the entire auth domain on the existing `domain/auth` branch in
one branch: TypeORM wiring, `User` and `RefreshToken` entities, the four
`/api/v1/auth/*` endpoints, JWT access + rotating refresh cookies, the
`JwtAuthGuard`, and the `npm run seed:superuser` CLI. Satisfies the
`auth-domain` capability spec (10 ADDED Requirements, 31 scenarios), the
`server_specs` delta (1 MODIFIED + 5 ADDED env keys), and the
`database-schema` delta (`refresh_tokens` table).

**Non-goals.** Roles / RBAC, password reset, email verification, account
lockout, sliding refresh, the first `typeorm migration:generate`, CORS /
ValidationPipe / Swagger / global prefix (owned by `bootstrap-api-config`).

## Architecture Overview

### Module / file layout

```
src/
├── data-source.ts                    # NEW — TypeORM DataSource (no migrations yet)
├── app.module.ts                     # MOD — adds TypeOrmModule.forRootAsync
├── config/env.config.ts              # MOD — 5 new Joi keys
├── auth/
│   ├── auth.module.ts                # MOD — JwtModule + Passport + TypeOrm.forFeature
│   ├── auth.controller.ts            # MOD — 4 endpoints + @UseGuards on /profile
│   ├── auth.service.ts               # MOD — login / refresh / logout / getProfile
│   ├── entities/
│   │   ├── user.entity.ts            # REPL — TypeORM @Entity matching dbml users
│   │   └── refresh-token.entity.ts   # NEW — TypeORM @Entity matching dbml refresh_tokens
│   ├── dto/
│   │   ├── login.dto.ts              # NEW — @IsEmail + @IsString @MinLength(8)
│   │   ├── refresh.dto.ts            # NEW — empty DTO; token comes from cookie
│   │   └── auth-response.dto.ts      # NEW — { accessToken, expiresIn } @ApiProperty
│   ├── strategies/
│   │   └── jwt.strategy.ts           # NEW — PassportStrategy(Strategy, 'jwt')
│   └── guards/
│       └── jwt-auth.guard.ts         # NEW — extends AuthGuard('jwt')
└── cli/
    └── seed-superuser.ts             # NEW — ts-node script, idempotent upsert
```

### Data flow

**Login** (`POST /api/v1/auth/login`, public)

```
Request ─► ValidationPipe ─► AuthController.login(LoginDto)
  ─► AuthService.login(email, password)
     ├─ userRepo.findOne({ where: { email } })   // password NOT in default select
     ├─ bcrypt.compare(plain, row.password)      // constant-time, no timing oracle
     ├─ jwtSvc.signAsync(payload, { secret, expiresIn }) // access token
     ├─ crypto.randomBytes(32) → refresh plaintext
     ├─ sha256(plaintext) → hashedToken
     ├─ rtRepo.insert({ user_id, family_id: uuid, hashed_token, expires_at })
     └─ return { accessToken, expiresIn }
  ─► @Res({ passthrough: true }) writes Set-Cookie: rt=<plain>; HttpOnly; Secure;
       SameSite=Lax; Path=/; Max-Age=<refresh expires_in seconds>
```

**Refresh** (`POST /api/v1/auth/refresh`, public, reads `rt` cookie)

```
Request ─► AuthController.refresh()
  ─► AuthService.refresh(rtCookie)
     ├─ sha256(rtCookie) → presentedHash
     ├─ rtRepo.findOne({ where: { hashed_token: presentedHash } })
     │    // unique index on hashed_token (dbml)
     ├─ MISSING or expires_at < now → 401 + Set-Cookie rt=; Max-Age=0
     ├─ row.revoked_at IS NOT NULL
     │    // REUSE: revoke the whole family
     │    UPDATE refresh_tokens SET revoked_at = now()
     │      WHERE family_id = row.family_id AND revoked_at IS NULL
     │    ─► 401 + Set-Cookie rt=; Max-Age=0
     ├─ happy path:
     │    UPDATE row SET revoked_at = now()                     // current
     │    family_id ← row.family_id                              // stable lineage
     │    newRt ← randomBytes(32); newHash ← sha256(newRt)
     │    INSERT refresh_tokens (... family_id, newHash, ...)
     │    UPDATE row SET replaced_by = newRow.id                 // chain link
     │    jwtSvc.signAsync(new access)
     │    ─► 200 { accessToken, expiresIn } + new Set-Cookie rt=<newRt>
```

**Logout** (`POST /api/v1/auth/logout`, public, reads `rt` cookie)

```
Request ─► AuthService.logout(rtCookie)
  ├─ presentedHash = sha256(rtCookie)
  ├─ rtRepo.findOne({ where: { hashed_token: presentedHash } })
  ├─ if not found → 401
  └─ UPDATE row SET revoked_at = now()  // presented row ONLY
       ─► 200 {} + Set-Cookie rt=; Max-Age=0
```

**Profile** (`GET /api/v1/auth/profile`, `@UseGuards(JwtAuthGuard)`)

```
Request ─► JwtAuthGuard
  ├─ JwtStrategy extracts "Authorization: Bearer <jwt>"
  ├─ passport-jwt verifies signature with JWT_SECRET + checks exp
  ├─ valid → req.user = { id: sub, email }
  └─ invalid / missing → 401
─► AuthController.profile(@Req() req)
  └─ return { id: req.user.id, email: req.user.email }
```

### Where things live

- **DataSource**: `src/data-source.ts` (exported `AppDataSource`) is the
  TypeORM `DataSource` instance. `AppModule` imports
  `TypeOrmModule.forRootAsync({ useFactory: ... })` that delegates to the
  same config. No migrations yet — `synchronize: false` from day one.
- **Guard wiring**: per-controller `@UseGuards(JwtAuthGuard)` on
  `AuthController.profile` only. NOT a global `APP_GUARD` (see ADR-6).
- **Seed CLI**: standalone `src/cli/seed-superuser.ts` invoked via
  `ts-node`. Initializes its own `DataSource` from `src/data-source.ts`,
  upserts, closes. No Nest application context.

## Architecture Decisions

### ADR-1: TypeORM wiring strategy

**Choice**. Export the `DataSource` from `src/data-source.ts` and wire
`TypeOrmModule.forRootAsync({ useFactory })` in `AppModule` that returns
the same config. `synchronize: false` from day one; the `entities` array
declares `[UserEntity, RefreshTokenEntity]` (forward-declared by file
import order). Migrations folder is declared (`migrations: []`) but
empty — first migration is a follow-up change.

**Alternatives considered**.
- (a) Inline the `TypeOrmModule.forRoot({...})` options in `AppModule`.
  **Rejected**: the seed CLI needs a standalone `DataSource` (no Nest
  application context). Defining the options in two places invites drift.
- (b) `synchronize: true`. **Rejected**: the spec pins `false` (dbml is
  the source of truth; production must not be auto-mutated by entity
  metadata).
- (c) Defer the data source file until the first migration change.
  **Rejected**: the seed CLI needs a `DataSource` to upsert, and the
  `AuthService` needs the repository registered in `AppModule` before
  any controller can be exercised in tests.

**Rationale**. The shared `DataSource` is the same pattern NestJS
documents for `migration:run` / `migration:generate` scripts. ADR-7
reuses it for the seed CLI. `forRootAsync` keeps the `ConfigService`
injection path (typed env access per `bootstrap-api-config`); the
factory reads `DATABASE_URL` and returns the TypeORM options. The
`Test.createTestingModule` overrides use `useFactory` with the same
shape so the test module and the real module share the entity list.

### ADR-2: User entity shape & password hashing

**Choice**. `UserEntity` (`src/auth/entities/user.entity.ts`) is a
TypeORM `@Entity({ name: 'users' })` matching the `users` table in
`openspec/specs/database-schema.dbml` (uuid id, unique email, varchar
password, timestamps). `@Column({ select: false })` on `password` so
default repository selects never return the hash. **No
`@BeforeInsert` / `@BeforeUpdate` hooks.** Hashing happens in the
service layer (`AuthService.login`, `seedSuperuser`) via
`bcrypt.hash(plain, 12)` before the row is inserted/updated.

**Alternatives considered**.
- (a) `@BeforeInsert` / `@BeforeUpdate` hooks. **Rejected** for this
  change: the hook receives a `UserEntity` instance whose `password`
  field is plaintext, but TypeORM's lifecycle hooks bypass the
  application's "I forgot to hash it" audit trail — a future endpoint
  that does `userRepo.save({ email, password: 'plain' })` will silently
  persist a plaintext row. Centralizing the hash in the service layer
  makes the contract explicit. Cost: `AuthService` has to remember
  to call `bcrypt.hash` before every save. Mitigated by colocated
  unit tests on the service.
- (b) Hash in a `BeforeInsert`/`BeforeUpdate` hook AND keep the
  `select: false` default. **Rejected**: still the silent-persistence
  risk above, and we lose the test seam.
- (c) `bcryptjs` (pure JS) over `bcrypt` (native). **Rejected** —
  decided in the proposal: native is ~6× faster at 12 rounds and
  Node 22 LTS ships prebuilt binaries.

**Rationale**. The service layer is the only writer of `users` rows in
this change (login never writes; `seedSuperuser` does). The hook vs
service question is a trade-off between ergonomics and auditability;
for a single-admin system with one writer path, the service-layer
hash is the safer default and is what the spec scenario "Password is
hashed before insert" exercises. `select: false` ensures the hash
never leaks through `userRepo.findOne()` default selects. The
`UserEntity` test in Commit 2 asserts both invariants.

### ADR-3: Refresh-token storage model

**Choice**. A new `refresh_tokens` table
(`src/auth/entities/refresh-token.entity.ts`) with columns
`id, user_id, family_id, hashed_token, expires_at, revoked_at,
replaced_by, created_at` (see spec delta). The plaintext is
`crypto.randomBytes(32).toString('base64url')` (256 bits of entropy);
the row stores `sha256(plaintext)` as a 64-char lowercase hex string.
`family_id` is a uuid generated at login and shared across every
rotation in the lineage. `replaced_by` is a self-FK that links the
chain. Indexes on `family_id` and `user_id`; the unique constraint on
`hashed_token` is the lookup key.

**Alternatives considered**.
- (a) Stateless refresh (JWT-as-refresh, no DB row). **Rejected**: the
  spec mandates family-level reuse detection on the server. Stateless
  refresh cannot revoke a stolen token without a separate deny-list,
  which is the same DB cost without the lineage signal.
- (b) Store the plaintext refresh token in the row. **Rejected**: a DB
  leak would leak every active session. The hash is enough — the
  server can look up the row by `hashed_token` and the plaintext
  never leaves the response Set-Cookie.
- (c) One table per user. **Rejected**: doesn't scale and breaks the
  family-id query.

**Rationale**. The family_id is the theft signal. The scenario
"Replaying a revoked cookie revokes the whole family" needs to flip
`revoked_at` on every row that shares the `family_id` in a single
`UPDATE`. The index on `family_id` makes that O(matches-in-family).
`replaced_by` is a debuggability aid (chain reconstruction) and is
the only way to assert the rotation invariant in a test without
re-deriving lineage from timestamps. The "At most one active row per
family" invariant (spec delta §Refresh Token Lifecycle Invariants)
is enforced at the application layer via `rtRepo.save` + transaction.

### ADR-4: Refresh transport & cookie attributes

**Choice**. The refresh token travels in a cookie named `rt` with
attributes `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<n>` where
`<n>` is `Number(JWT_REFRESH_EXPIRES_IN)` (the Joi-validated
seconds-notation integer string). The access token travels in
`Authorization: Bearer <jwt>`. Cookie writes go through
`@Res({ passthrough: true })` on the controller method so the service
can return the body and the cookie in the same handler.

**Alternatives considered**.
- (a) SameSite=Strict. **Rejected** (decided in spec question #2):
  breaks the legitimate "click an email link to the admin UI" flow.
- (b) Return the refresh token in the response body. **Rejected**:
  JS-driven XSS exfiltrates it. HttpOnly is the only cookie attribute
  that protects against `document.cookie` reads.
- (c) LocalStorage + `Authorization: Bearer`. **Rejected**: localStorage
  is XSS-readable; the spec is explicit on cookie transport.

**Rationale**. `HttpOnly` blocks JS reads; `Secure` enforces HTTPS in
production; `SameSite=Lax` blocks cross-site POST CSRF while
permitting top-level navigation; `Path=/` keeps the cookie readable
from every endpoint (the seed CLI never sees the cookie — it is a
server-to-server script). `Max-Age` is RFC 7231 delta-seconds, not an
RFC 1123 date, and is the integer value of
`JWT_REFRESH_EXPIRES_IN` — direct mapping, no `@nestjs/jwt` duration
parser in this code path (per spec §Refresh Cookie Transport). The
controller test asserts the literal `Set-Cookie` substring
`HttpOnly; Secure; SameSite=Lax; Path=/` and that `Max-Age` parses
to the configured integer.

### ADR-5: JWT signing strategy

**Choice**. HS256 with two distinct secrets. `JwtModule.registerAsync`
reads `JWT_SECRET` (access) and `JWT_REFRESH_SECRET` (refresh) from
`ConfigService<EnvConfig>`. `signOptions.expiresIn` is
`JWT_EXPIRES_IN` (NestJS duration string, e.g. `"15m"`). The refresh
token's `exp` is set explicitly via `sign(payload, { secret, expiresIn: Number(JWT_REFRESH_EXPIRES_IN) })` in the service layer.

**Alternatives considered**.
- (a) RS256 with a key pair. **Rejected** for a single-admin app:
  adds a JWKS endpoint, a key-rotation story, and an asymmetric
  dependency for no real benefit — there is no third-party resource
  server verifying our tokens.
- (b) Reuse `JWT_SECRET` for both access and refresh. **Rejected**:
  spec §JWT_REFRESH_SECRET forbids it explicitly (compromise of one
  must not compromise the other). Joi enforces
  `not(Joi.ref('JWT_SECRET'))`.
- (c) No `exp` on the refresh token (rely on the DB `expires_at`).
  **Rejected**: defense in depth — the JWT signature carries an
  expiry that the verifier checks before the DB roundtrip, and the
  DB row enforces the durable lifetime.

**Rationale**. The two-secret split is the spec-mandated
authentication boundary. The access token's `expiresIn` uses the
Nest duration parser because `@nestjs/jwt` is already the issuer
and rejects ambiguous formats; the refresh token's `expiresIn` is
the integer seconds string from `JWT_REFRESH_EXPIRES_IN` (the spec
pins that format for the cookie `Max-Age` mapping).

### ADR-6: Guard wiring scope

**Choice**. `JwtAuthGuard` (`@nestjs/passport` `AuthGuard('jwt')`)
is applied **per-controller** with `@UseGuards(JwtAuthGuard)` on
`AuthController.profile` only. NOT registered as a global `APP_GUARD`
in `AppModule`. `JwtStrategy` is registered in `AuthModule`'s
`providers` so the strategy name `'jwt'` resolves when
`AuthGuard('jwt')` instantiates.

**Alternatives considered**.
- (a) Global `APP_GUARD` provider in `AppModule`. **Rejected**: the
  spec requires that future public endpoints like `GET /projects`
  "must not opt out" — i.e. the default is public, opt-in is
  protected. A global guard inverts the default and forces every
  public endpoint to carry `@Public()` metadata.
- (b) Method-level `@UseGuards(JwtAuthGuard)` on `profile()` only.
  **Rejected**: same effect as per-controller, but controller-level
  is one annotation instead of N — and the spec's
  "only `AuthController.profile` carries `@UseGuards(JwtAuthGuard)`"
  scenario is the controller-scope test.
- (c) Custom `@Public()` decorator + global guard with reflection.
  **Rejected**: feature creep for a single protected endpoint.

**Rationale**. The user pre-decided the per-controller scope. The
test scenario "Guard is controller-scoped, not global" is asserted
in Commit 7 by grepping `AppModule` source for `APP_GUARD` and
asserting the absence. The auth module stays self-contained:
`JwtStrategy` + `JwtAuthGuard` + the controller are all in
`src/auth/`, no global registration in `AppModule`.

### ADR-7: Seed CLI architecture

**Choice**. `src/cli/seed-superuser.ts` is a standalone `ts-node`
script (not a Nest application). It imports `AppDataSource` from
`src/data-source.ts`, calls `dataSource.initialize()`, then runs
`seedSuperuser(email, password, userRepo)` and `dataSource.destroy()`.
The pure function is exported and lives in the same file so the
unit test (`src/cli/seed-superuser.spec.ts`) can call it with a fake
repository and no DB. `package.json` adds
`"seed:superuser": "ts-node src/cli/seed-superuser.ts"`. The script
exits non-zero (and prints to stderr) if `SUPERUSER_EMAIL` or
`SUPERUSER_PASSWORD` is missing or if `SUPERUSER_PASSWORD.length < 8`
— checked BEFORE any `dataSource.initialize()` so no DB connection
is opened on a bad config.

**Alternatives considered**.
- (a) Nest standalone application (`NestFactory.createApplicationContext`).
  **Rejected**: pulls the entire `AppModule` (validation pipe, CORS,
  global prefix) for what is a single-row upsert. The DB cost is
  zero; the framework cost is not.
- (b) A Nest `Command` runner (`nest-commander` or similar). **Rejected**:
  new dependency for one command. The repo's "AGAINST IMMEDIACY"
  rule says: pick the boring tool.
- (c) A custom `npm run` script that `psql`s the row directly.
  **Rejected**: spec scenario "Plaintext password is never persisted"
  is best asserted by going through the same `bcrypt.hash` call the
  app uses, not a side-channel SQL file.

**Rationale**. The pure `seedSuperuser(email, password, userRepo)`
function is testable in isolation: pass an in-memory fake repo
(Jest `jest.fn()`) and assert the `upsert` semantics (insert when
missing, update when present, no duplication). The I/O wrapper
(sourcing env, opening the DataSource) is the only thing that
needs `ts-node`; the unit test never invokes it. The script's
"fail fast on missing env" is the spec scenario; the test asserts
both the exit code and the message.

### ADR-8: Bootstrap test fixup

**Choice**. `main.spec.ts` (line 40-56) and `bootstrap.e2e-spec.ts`
(line 107-121) currently probe `POST /api/v1/auth` and assert
status 201. Once this change replaces `AuthController` (and the
body is no longer `CreateAuthDto = {}` — it becomes
`LoginDto = { email, password }`), both probes break. The fixup is
to mirror the `__bootstrap_fixture` pattern from
`bootstrap-api-config` ADR-1: declare a throwaway `FixtureDto` and
`@Controller('__bootstrap_fixture') class FixtureController` **in
the test file itself**, register it as a `FixtureModule` in the
`Test.createTestingModule` (e2e) or import it into the test module
(unit), and assert the prefix against `POST /api/v1/__bootstrap_fixture`
→ 201 and `POST /__bootstrap_fixture` → 404. The auth-specific
endpoints are then exercised in their own e2e
(`test/auth.e2e-spec.ts`).

**Alternatives considered**.
- (a) Keep the probe against `POST /api/v1/auth` and assert 400
  (validation error) instead of 201. **Rejected**: changes the
  test's semantic — prefix reachability is decoupled from DTO
  validation, and the DTO shape will keep evolving. The bootstrap
  test is about the prefix, not the auth shape.
- (b) Drop the prefix probe from the bootstrap test entirely.
  **Rejected**: the prefix assertion is the only test the
  `bootstrap-api-config` change shipped against `setGlobalPrefix`
  behavior; losing it would silently regress the prefix on future
  changes.
- (c) Spawn a new e2e file per domain. **Accepted, but later**: this
  change ships `test/auth.e2e-spec.ts` (login / refresh / logout /
  profile / reuse-detect) but does not move the prefix probe there.

**Rationale**. The bootstrap test must assert the prefix without
coupling to any domain DTO. The `__bootstrap_fixture` is a
documented pattern (used by `bootstrap-api-config` ADR-1 for the
`forbidNonWhitelisted` test). Reusing it for the prefix probe is
consistent and makes the diff small. The PR description must call
this out: "the swap from `/api/v1/auth` to `/api/v1/__bootstrap_fixture`
is the same fixture pattern; the auth domain's own endpoints are
covered in `test/auth.e2e-spec.ts`."

### ADR-9: Work-unit commit ordering

Strict TDD (RED-first per `openspec/config.yaml > rules.apply.tdd`)
means each commit is its own RED → GREEN cycle, with the test
landing in the same commit as the code that makes it pass. The
seven-commit sequence from the proposal maps to this contract.

| # | Commit | Tests-first | Implementation-last | RED-first rationale |
|---|--------|-------------|---------------------|---------------------|
| 1 | `chore(deps): add typeorm, passport, bcrypt, pg` | `env.config.spec.ts`: missing-env-var rejects for the 5 new keys | `package.json` deps, `EnvConfig` interface, `ENV_CONFIG` Joi entries | Env-validation is the cheapest RED; no DB, no HTTP, no Nest — pure `Joi.object({...})` test. |
| 2 | `feat(data): wire TypeORM and add User entity` | `user.entity.spec.ts`: column shape, `select: false` on `password`, hash-on-save (via `seedSuperuser` shim) | `src/data-source.ts`, `TypeOrmModule.forRootAsync` in `AppModule`, `UserEntity`, `TypeOrmModule.forFeature` in `AuthModule` | User requested this as its own work-unit commit. The entity metadata is the only assertion; the controller does not yet exist. |
| 3 | `feat(auth): bcrypt password + JWT sign/verify + service methods` | `auth.service.spec.ts`: login happy / wrong-pw / unknown-email / refresh happy / refresh-reuse / logout | `AuthService` (login, refresh, logout, getProfile), `bcrypt.hash(plain, 12)`, `sha256`, `crypto.randomBytes`, `JwtService.signAsync` | Service-layer is pure (fake repos, real `bcrypt`, real `JwtService.signAsync` against an in-memory key — see Test Strategy). Controller not yet wired. |
| 4 | `feat(auth): controller endpoints, DTOs, Swagger tags` | `auth.controller.spec.ts` + `test/auth.e2e-spec.ts`: 200/401/400 on each endpoint, `Set-Cookie` attributes, Swagger padlock on `/profile` | `AuthController` (4 endpoints), `LoginDto`, `RefreshDto`, `AuthResponseDto`, `@ApiTags('auth')`, `@ApiBearerAuth()` on `/profile` | RED-first exercises the HTTP surface (status, headers, body shape) — the contract the spec owns. |
| 5 | `feat(auth): JwtStrategy + JwtAuthGuard per-controller` | `auth.e2e-spec.ts`: `/profile` 200 with bearer, 401 missing/expired/invalid; `app.module.spec.ts` (new) asserts NO `APP_GUARD` for `JwtAuthGuard` | `JwtStrategy`, `JwtAuthGuard`, `@UseGuards(JwtAuthGuard)` on `profile()` | Guard is wired last so the controller test in Commit 4 can run without a guard (login/refresh/logout are public). |
| 6 | `feat(cli): seed:superuser script` | `seed-superuser.spec.ts`: missing-env exits non-zero with the right name, first run creates row, second run upserts (idempotent), password hashed | `src/cli/seed-superuser.ts`, `package.json` script | Pure-function test (fake repo) covers the upsert logic; the I/O wrapper is untested at this layer (manual + e2e in a later change). |
| 7 | `chore(specs): apply server_specs + database-schema deltas + bootstrap test fixup` | All existing tests still pass; new scenario assertions live in their owning commits; the swap to `__bootstrap_fixture` is the only test diff | `openspec/changes/auth-domain/specs/...` is already written; the apply step mirrors the deltas at archive time | Spec-only commit; the bootstrap test fixup is the only code change, and it is a test-only swap, not a behavior change. |

**Rationale**. Each commit is ≤80 LOC and self-contained. Commits 1, 2,
6 can land independently of each other; Commits 3-5 must land in order
(5 depends on 3 + 4). Commit 7 is the spec archive mirror and the
bootstrap test fixup. RED-first is enforced per commit, not per
"feature" — a junior reviewer can read commit 3 and see the failing
tests, the implementation, and the green run in one place.

### ADR-10: bcrypt rounds — hardcode 12

**Choice**. `bcrypt.hash(plain, 12)` is hardcoded in the service
layer and the seed CLI. No `BCRYPT_ROUNDS` env var, no
`ConfigService` lookup. The DBML pins 12 in the column comment
(`// Bcrypt 12 rounds`); the spec scenario "First run creates the
user" asserts `bcrypt.compare(SUPERUSER_PASSWORD, row.password) ===
true`, which is true for any reasonable rounds count — but the spec
delta says explicitly "bcrypt 12-round hash" in Requirement: User
Entity.

**Alternatives considered**.
- (a) `BCRYPT_ROUNDS` env var with Joi validation. **Rejected**: the
  value is fixed by the spec; making it configurable invites drift
  between dev / test / prod (tests would need to set a lower value
  to keep the suite fast). Hardcoding means there is exactly one
  truth.
- (b) A `BcryptRounds` constant in `src/auth/auth.constants.ts`.
  **Rejected**: the constant would be used in exactly two places
  (service, seed CLI). Inlining is the right call at N=2.

**Rationale**. ADR-2 already centralizes the hash call in the
service layer. The constant lives next to the call. The DBML is
the documentation; the spec is the contract. Tests assert the
behavior (`bcrypt.compare(plain, row.password) === true`), not the
rounds count, so a future bump is a one-line change with no test
churn.

## Test Strategy

Strict TDD per `openspec/config.yaml > rules.apply.tdd: true`. Two
test layers:

### Unit (colocated `*.spec.ts` inside `src/`)

| File | Covers | Mocking strategy |
|------|--------|------------------|
| `src/auth/auth.service.spec.ts` | login / refresh / logout / getProfile, all branches (happy, wrong-pw, unknown-email, reuse-detect, missing cookie, expired cookie) | **Real `bcrypt.compare`** (cheap at 12 rounds, ~30ms); **real `JwtService.signAsync`** against an in-memory `JWT_SECRET` (e2e-accurate token shape); **fake repositories** via `getRepositoryToken`; **real `crypto.randomBytes` and `sha256`** (no need to mock). |
| `src/auth/auth.controller.spec.ts` | 4 endpoints, status codes, body shape, `Set-Cookie` header attributes (regex match for `HttpOnly; Secure; SameSite=Lax; Path=/` and `Max-Age=<n>`) | **Real `AuthService`** (per strict-TDD's "no mocks of own code"); **fake DTO** for the `@Body()` shape; supertest against the controller. |
| `src/auth/entities/user.entity.spec.ts` | `UserEntity` column metadata (id/email/password/createdAt/updatedAt, `unique: true` on email, `select: false` on password), `bcrypt.hash` invoked by `seedSuperuser` shim | TypeORM metadata inspector; no DB. |
| `src/cli/seed-superuser.spec.ts` | `seedSuperuser(email, pw, repo)` happy / missing-env / upsert idempotency | Fake `userRepo` (Jest `jest.fn()`); env via `process.env` stub. |
| `src/main.spec.ts` (modified) | prefix probe now hits `__bootstrap_fixture`; everything else (typed env access, ValidationPipe options, CORS echo, Swagger) unchanged | Same as `bootstrap-api-config` ADR-3 — `process.env` pre-import, `bootstrap()` invoked. |
| `src/app.module.spec.ts` (extended) | NEW: asserts no `APP_GUARD` provider references `JwtAuthGuard` (spec scenario "Guard is controller-scoped, not global") | `readFileSync(app.module.ts, 'utf8')` regex. |

### E2E (`test/*.e2e-spec.ts`)

| File | Covers | Approach |
|------|--------|----------|
| `test/bootstrap.e2e-spec.ts` (modified) | prefix probe switches to `__bootstrap_fixture`; everything else (CORS echo/non-echo, Swagger, ValidationPipe, missing-env) unchanged | Per `bootstrap-api-config` ADR-1, ADR-3, ADR-4, ADR-5. |
| `test/auth.e2e-spec.ts` (new) | login happy / 401 / 400; refresh happy / reuse-detect (replay old cookie → whole family revoked, `Set-Cookie: rt=; Max-Age=0`); logout happy / missing-cookie 401; profile 200 with bearer / 401 missing / 401 expired / 401 invalid signature; Swagger UI lists `Auth` tag with the four endpoints and `/profile` has the bearer padlock | `Test.createTestingModule` with `AppModule`; `supertest` against `app.getHttpServer()`. The `User` and `RefreshToken` repositories are mocked at the `getRepositoryToken` level (no live DB — see Migration / Rollout below for the rationale). |

### bcrypt / jwt mocking convention

- **bcrypt**: use the real `bcrypt.compare` and `bcrypt.hash` in unit
  tests. 12 rounds is ~30-50ms per call in CI; the service test
  makes ~20 hash/compare calls. Total budget: <2s, well under the
  default Jest timeout. No `bcryptjs` substitution.
- **JwtService**: instantiate `JwtService` with
  `new JwtService({ secret: 'test-secret-32-chars-min-..................' })`
  in the unit test and call `.signAsync` / `.verifyAsync` against
  the same in-memory secret. This gives the test the real token
  shape and signature, so `passport-jwt` can verify it in the e2e
  without a second code path.
- **Repositories**: `getRepositoryToken(UserEntity)` and
  `getRepositoryToken(RefreshTokenEntity)` are replaced with
  `useValue` objects that implement the methods the service calls
  (`findOne`, `save`, `createQueryBuilder`, `update`, `insert`). No
  TypeORM in-memory DB (the project doesn't use `better-sqlite3` for
  tests; introducing it here is out of scope).

### Seed CLI test

The pure `seedSuperuser(email, password, userRepo)` function is
unit-tested in `src/cli/seed-superuser.spec.ts` with a fake repo.
The I/O wrapper (env sourcing, DataSource lifecycle) is exercised
manually in this change and will get a dedicated e2e in the
follow-up migration change. The spec scenarios "Missing
SUPERUSER_EMAIL exits non-zero" and "Re-run updates the existing
user" are both covered by the unit test against the pure function.

## Affected Areas (per-file implementation notes)

Cross-references the proposal's Affected Areas; adds implementation
notes per file.

| File | Action | Implementation note |
|------|--------|---------------------|
| `src/auth/auth.controller.ts` | Replaced | 4 endpoints; `@ApiTags('auth')` at controller, `@ApiBearerAuth()` on `profile`; `@Res({ passthrough: true })` for cookie writes on login/refresh/logout; `@UseGuards(JwtAuthGuard)` on `profile`. |
| `src/auth/auth.service.ts` | Replaced | `login`, `refresh`, `logout`, `getProfile`; injects `JwtService`, `ConfigService<EnvConfig>`, `Repository<UserEntity>`, `Repository<RefreshTokenEntity>`. Pure service: no HTTP concerns, no cookies — returns `{ accessToken, expiresIn, refreshToken, refreshExpiresInSeconds }` and lets the controller write the cookie. |
| `src/auth/auth.module.ts` | Modified | `JwtModule.registerAsync({ useFactory: cs => ({ secret: cs.get('JWT_SECRET'), signOptions: { expiresIn: cs.get('JWT_EXPIRES_IN') } }) })`, `PassportModule`, `TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity])`, providers `[AuthService, JwtStrategy]`. |
| `src/auth/entities/user.entity.ts` | Replaced | `@Entity('users')`, `select: false` on `password`, `@CreateDateColumn`/`@UpdateDateColumn` named `created_at`/`updated_at`. |
| `src/auth/entities/refresh-token.entity.ts` | New | `@Entity('refresh_tokens')` matching the dbml delta; `@Index` on `family_id` and `user_id`; `unique` on `hashed_token`; self-FK `replaced_by` with `nullable: true`. |
| `src/auth/dto/login.dto.ts` | New | `email: @IsEmail()`, `password: @IsString() @MinLength(8)`. |
| `src/auth/dto/refresh.dto.ts` | New | Empty class — the token is in the cookie, not the body. Exists for Swagger metadata and future-proofing. |
| `src/auth/dto/auth-response.dto.ts` | New | `@ApiProperty` `{ accessToken, expiresIn }` for Swagger. |
| `src/auth/strategies/jwt.strategy.ts` | New | `PassportStrategy(Strategy, 'jwt')`; `jwtFromRequest = ExtractJwt.fromAuthHeaderAsBearerToken()`; `ignoreExpiration = false`; `secretOrKey = configService.get('JWT_SECRET')`; `validate({ sub, email }) = { id: sub, email }`. |
| `src/auth/guards/jwt-auth.guard.ts` | New | `@Injectable() class JwtAuthGuard extends AuthGuard('jwt') {}` — the default `handleRequest` is fine for this app (401 on missing/invalid). |
| `src/cli/seed-superuser.ts` | New | Standalone `ts-node` script; pure `seedSuperuser` exported for unit tests; I/O wrapper reads `process.env`, initializes the `DataSource`, calls the function, destroys. |
| `src/data-source.ts` | New | `new DataSource({ type: 'postgres', url: configService.get('DATABASE_URL'), entities: [UserEntity, RefreshTokenEntity], migrations: [], synchronize: false })`. Imported by `AppModule` and the seed CLI. |
| `src/app.module.ts` | Modified | Add `TypeOrmModule.forRootAsync({ useFactory: cs => new DataSource({...}).options, inject: [ConfigService] })`. No `APP_GUARD`. |
| `src/config/env.config.ts` | Modified | 5 new keys: `JWT_EXPIRES_IN` (Joi.string().required()), `JWT_REFRESH_SECRET` (Joi.string().min(32).invalid(Joi.ref('JWT_SECRET')).required()), `JWT_REFRESH_EXPIRES_IN` (Joi.string().pattern(/^\d+$/).required()), `SUPERUSER_EMAIL` (Joi.string().email().required()), `SUPERUSER_PASSWORD` (Joi.string().min(8).required()). |
| `src/main.spec.ts` | Modified | Prefix probe replaces `/api/v1/auth` with `/api/v1/__bootstrap_fixture` via the test-only controller (per ADR-8). |
| `test/bootstrap.e2e-spec.ts` | Modified | Same fixup as `main.spec.ts`. |
| `test/auth.e2e-spec.ts` | New | E2E for the four endpoints; the reuse-detection scenario spins up a fake repo, presents a known-revoked cookie, asserts the 401 + `Set-Cookie: rt=; Max-Age=0` + the whole-family `revoked_at` flip. |
| `package.json` | Modified | 4 new deps, 2 new devDeps, 1 new script (`seed:superuser`). |
| `README.md` | Modified | New endpoints table; seed command documented with a warning that `SUPERUSER_PASSWORD` is a bootstrap secret (per proposal risk #5). |
| `openspec/specs/server_specs.md` | Modified | At archive time only — apply phase does not touch this file. |
| `openspec/specs/database-schema.dbml` | Modified | At archive time only — apply phase does not touch this file. |

## Migration / Rollout

`No migration required` for this PR. The new `refresh_tokens` table
is declared in the entity but is NOT auto-created (`synchronize:
false`). The first `typeorm migration:generate` is explicitly
deferred to the next DB-touching change (proposal §Out of Scope).
The seed CLI's `dataSource.initialize()` will throw on missing
tables — the risk in the proposal table calls this out, and the
mitigation is "the seed CLI is run in dev after the migration is
applied". The unit + e2e tests use fake repositories; no live DB is
required for the test suite to pass.

Rollback (per proposal): single PR, no schema-on-prod. `git revert`
on `domain/auth` and redeploy. The new endpoints disappear and the
stub `AuthController` is restored. The bootstrap test fixup MUST
be reverted in the same commit (or the bootstrap test will fail
against the restored stub).

## Open Questions for the Apply Phase

None blocking. The design resolves all 10 ADRs above. Two
implementation-level questions for the apply phase to confirm as
it works through Commit 3:

1. **Hashing the password in `seed-superuser.ts`**: confirm that
   the seed CLI calls `bcrypt.hash(plain, 12)` itself rather than
   re-using a service method. Rationale: the CLI does not import
   the Nest application context, and the service depends on
   `JwtService` and repositories it doesn't need.
2. **Constant-time password compare**: `bcrypt.compare` is
   constant-time, but `userRepo.findOne` followed by an early
   `if (!user) return 401` is NOT. The spec scenario "Wrong
   password returns 401" hints at this; the implementation should
   consider hashing a dummy value on the "user not found" path
   to keep the response time constant. If the apply phase chooses
   to add this, it lands in `AuthService.login` and is testable
   with `jest.spyOn(bcrypt, 'compare')` to assert both branches
   call it.

Neither question is blocking; both are quality-of-implementation
nits the apply phase can resolve on its own.

## Review Workload Forecast

**Single PR feasible at ~350 LOC.**

Re-forecast from the design perspective:

- Commit 1 (deps + env schema): ~20 LOC
- Commit 2 (TypeORM wiring + User entity): ~50 LOC
- Commit 3 (AuthService + bcrypt + JWT): ~80 LOC
- Commit 4 (AuthController + DTOs + Swagger): ~70 LOC
- Commit 5 (JwtStrategy + JwtAuthGuard): ~50 LOC
- Commit 6 (seed-superuser CLI): ~30 LOC
- Commit 7 (bootstrap test fixup + spec deltas): ~50 LOC

**Total: ~350 LOC additions + ~20 LOC deletions** (the stub
`AuthController` and `CreateAuthDto` are replaced). This is **under
the 400-line review budget** with ~50 LOC of headroom.

**Risk to the forecast**:

- The `test/auth.e2e-spec.ts` file is the unknown. If the
  reuse-detection test needs 30+ scenarios to cover the spec
  matrix (revoke-on-rotation, revoke-on-logout, revoke-on-reuse,
  `Max-Age=0` clear-cookie, family-stability across rotation,
  no-duplicate-active-row invariant), the test file alone could
  push to ~150 LOC, making the PR ~470 LOC.
- The `AuthService` test (`auth.service.spec.ts`) has 9 branches
  per the spec matrix (login happy / unknown-email / wrong-pw /
  malformed-body-via-controller; refresh happy / missing / expired /
  reuse; logout happy / missing). Each branch is ~10 LOC of test.
  ~90 LOC for the service test alone.

**Recommendation**: **single PR is feasible**, ask on risk only if
the e2e test file grows past 120 LOC. Mitigation if it does: split
the test file in Commit 4 (controller-level happy paths) from
Commit 5 (guard + reuse-detection in the e2e), keeping the
reuse-detection scenario as a separate follow-up commit. That
keeps each PR ≤400 LOC. The chained-PR gate is **NOT** triggered
by this design; the orchestrator can ship it as a single PR
backed by the 7-commit sequence above.
