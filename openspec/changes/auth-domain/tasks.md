# Tasks: Auth Domain (login, JWT, guard, superuser seed, refresh rotation)

## Conventions

- **Strict TDD is ON** (`openspec/config.yaml > rules.apply.tdd: true`). Every code task lists a RED step (write a failing test first) and a GREEN step (make it pass). Each work-unit commit is its own RED → GREEN cycle so a junior reviewer can read commit N and see the failing test + passing code + green run in one place.
- **Test commands**: unit `npm test`, e2e `npm run test:e2e`, coverage `npm run test:cov`, build `npm run build`, lint `npm run lint`, format `npm run format`.
- **File conventions** (per `openspec/config.yaml > rules.apply.test_convention`):
  - Unit tests: `*.spec.ts` colocated next to the source file under `src/` (Jest `rootDir: src`, `testRegex: .*\\.spec\\.ts$`).
  - E2E tests: `test/*.e2e-spec.ts` (separate runner `test/jest-e2e.json`).
- **Commit conventions**: 7 work-unit commits per the `work-unit-commits` skill — each commit self-contained, tests pass independently, conventional commits only, no AI attribution.
- **`sdd-apply` responsibilities**: read all artifacts end-to-end; follow the task list in order; defer spec-delta merges to `sdd-archive` (Commits 7's spec edits are deferred to archive — apply only edits the bootstrap test + README).

## A. Goal & constraints

Land the entire auth domain in **7 work-unit commits** on `domain/auth`, ordered RED-first per `rules.apply.tdd`. The change ships: bcrypt-hashed `User` + `RefreshToken` entities on a wired TypeORM data source; `POST /api/v1/auth/{login,refresh,logout}` and `GET /api/v1/auth/profile`; JWT access + rotating refresh cookies; per-controller `JwtAuthGuard`; and `npm run seed:superuser`. Forecast: ~350 LOC additions + ~20 deletions → ~370 net. **Hard constraints**: 400-line PR review budget; no `APP_GUARD` (per-controller only); `synchronize: false`; hardcoded `bcrypt.hash(plain, 12)`; bootstrap tests must swap their `/api/v1/auth` probe to `__bootstrap_fixture` (Commit 7) so Commits 1-6 stay green.

## B. Work-unit commit plan

| # | Commit (conventional) | Scope | Files touched | Test files touched | Expected LOC add | Pre-commit checks |
|---|---|---|---|---|---|---|
| 1 | `chore(auth): add typeorm/passport/bcrypt/pg deps and 5 new Joi keys` | deps + env schema | `package.json`, `package-lock.json`, `src/config/env.config.ts`, `test/bootstrap.e2e-spec.ts` (process.env stubs + missing-env spec) | (no new spec file; extends the (f) missing-env test) | ~20 | `npm run build`, `npm test`, `npm run lint` |
| 2 | `feat(data): wire TypeORM and add User entity` | TypeOrmModule wiring + UserEntity | `src/data-source.ts` (new), `src/app.module.ts`, `src/auth/auth.module.ts`, `src/auth/entities/user.entity.ts` (replaces `auth.entity.ts`), delete `src/auth/entities/auth.entity.ts`, delete `src/auth/dto/create-auth.dto.ts` + `update-auth.dto.ts` | `src/auth/entities/user.entity.spec.ts` (new), `src/app.module.spec.ts` (extended) | ~50 | `npm run build`, `npm test`, `npm run lint` |
| 3 | `feat(auth): bcrypt password + JWT sign/verify + AuthService methods` | AuthService (pure) | `src/auth/auth.service.ts` (replaced), `src/auth/entities/refresh-token.entity.ts` (new), `src/auth/auth.module.ts` (providers), `src/auth/auth.service.spec.ts` (replaced) | `src/auth/auth.service.spec.ts` (9-branches) | ~80 | `npm run build`, `npm test -- --testPathPattern=auth.service`, `npm run lint` |
| 4 | `feat(auth): controller endpoints, DTOs, Swagger tags` | AuthController + DTOs | `src/auth/auth.controller.ts` (replaced), `src/auth/dto/login.dto.ts` (new), `src/auth/dto/refresh.dto.ts` (new), `src/auth/dto/auth-response.dto.ts` (new), `src/auth/auth.controller.spec.ts` (replaced), `test/auth.e2e-spec.ts` (new, happy paths) | both above | ~70 | `npm run build`, `npm test -- --testPathPattern=auth.controller`, `npm run test:e2e -- --testPathPattern=auth.e2e`, `npm run lint` |
| 5 | `feat(auth): JwtStrategy + JwtAuthGuard per-controller` | guard wiring | `src/auth/strategies/jwt.strategy.ts` (new), `src/auth/guards/jwt-auth.guard.ts` (new), `src/auth/auth.module.ts` (providers), `src/auth/auth.controller.ts` (`@UseGuards` on profile), `test/auth.e2e-spec.ts` (extended — bearer + reuse-detect) | extended e2e | ~50 | `npm run build`, `npm run test:e2e -- --testPathPattern=auth.e2e`, `npm run lint` |
| 6 | `feat(cli): seed:superuser script` | CLI | `src/cli/seed-superuser.ts` (new), `src/cli/seed-superuser.spec.ts` (new), `package.json` (script) | new spec | ~30 | `npm run build`, `npm test -- --testPathPattern=seed-superuser`, `npm run lint` |
| 7 | `chore(specs): apply bootstrap test fixup + README; defer spec deltas to archive` | test fixup + docs | `src/main.spec.ts` (swap `/api/v1/auth` → `/api/v1/__bootstrap_fixture`), `test/bootstrap.e2e-spec.ts` (same swap), `README.md` (auth table + seed command) | both modified | ~50 | `npm run build`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run format` |

**Total additions**: ~350 LOC. **Deletions**: ~20 LOC (stub `AuthController` 42 lines + `create-auth.dto.ts`/`update-auth.dto.ts`/`auth.entity.ts` = ~3 small files). **Net changed**: ~370 LOC. **Largest single commit**: Commit 3 (~80 LOC).

## C. Hierarchical task list

> Every code task is RED → GREEN. Pure refactor tasks (e.g. 7.3, 7.4) describe what to swap.

### 1. Commit 1 — deps + env schema (`chore(auth): ...`)

- [ ] 1.1 **RED**: extend the (f) `describe('missing required env var prevents boot')` block in `test/bootstrap.e2e-spec.ts` to also cover the 5 new keys. Each missing key (one test per key, parameterized) must throw a Joi error referencing the missing key name. Run `npm run test:e2e` — fails because `ENV_CONFIG` doesn't yet require them.
- [ ] 1.2 **GREEN (env schema)**: extend `EnvConfig` interface in `src/config/env.config.ts` with `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD`. Extend `ENV_CONFIG` Joi schema per design ADR-5/§server_specs.md ADDED Requirements:
  - `JWT_EXPIRES_IN: Joi.string().required()` (NestJS duration parser will validate format at issue time)
  - `JWT_REFRESH_SECRET: Joi.string().min(32).invalid(Joi.ref('JWT_SECRET')).required()`
  - `JWT_REFRESH_EXPIRES_IN: Joi.string().pattern(/^\d+$/).required()` (seconds-notation)
  - `SUPERUSER_EMAIL: Joi.string().email().required()`
  - `SUPERUSER_PASSWORD: Joi.string().min(8).required()`
- [ ] 1.3 **GREEN (test stubs)**: update the `process.env` stub at the top of `test/bootstrap.e2e-spec.ts` and `src/main.spec.ts` and `src/app.module.spec.ts` to provide the 5 new keys (e.g. `JWT_EXPIRES_IN='15m'`, `JWT_REFRESH_SECRET='refresh-secret-32-chars-min-.......'`, `JWT_REFRESH_EXPIRES_IN='2592000'`, `SUPERUSER_EMAIL='admin@test.io'`, `SUPERUSER_PASSWORD='test-password'`). Without these, even unit tests that import `AppModule` would fail at module-decoration.
- [ ] 1.4 **GREEN (deps)**: `npm install @nestjs/typeorm@^11 @nestjs/passport@^11 bcrypt@^5 pg@^8` (deps) and `npm install --save-dev @types/bcrypt@^5 @types/pg@^8`. Verify `package.json` and `package-lock.json` reflect the additions; run `npm run build` and `npm test` to confirm nothing regressed.
- [ ] 1.5 Run `npm run lint`, `npm run format` on touched files. Commit with body that lists the 5 new keys.

### 2. Commit 2 — TypeORM wiring + User entity (`feat(data): ...`)

- [ ] 2.1 **RED**: create `src/auth/entities/user.entity.spec.ts`. Test the entity metadata:
  - `expect(columns).toContain('id', 'email', 'password', 'createdAt', 'updatedAt')` (use `getMetadata(UserEntity).columns.map(c => c.propertyName)`)
  - `expect(emailColumn.unique).toBe(true)`
  - `expect(passwordColumn.select).toBe(false)`
  - Run `npm test -- --testPathPattern=user.entity` — fails because `UserEntity` doesn't exist yet.
- [ ] 2.2 **GREEN**: create `src/auth/entities/user.entity.ts` matching `openspec/specs/database-schema.dbml` `users` table:
  ```ts
  @Entity('users')
  export class UserEntity {
    @PrimaryGeneratedColumn('uuid') id!: string;
    @Column({ type: 'varchar', unique: true }) email!: string;
    @Column({ type: 'varchar', select: false }) password!: string;
    @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
    @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
  }
  ```
  Delete `src/auth/entities/auth.entity.ts` (stub). Run `npm test -- --testPathPattern=user.entity` — passes.
- [ ] 2.3 **GREEN (data-source)**: create `src/data-source.ts` exporting `AppDataSource`:
  ```ts
  export const AppDataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [UserEntity /* + RefreshTokenEntity later in Commit 3 */],
    migrations: [],
    synchronize: false,
  });
  ```
  This file is currently NOT yet imported by `AppModule` — that lands in 2.4. The seed CLI in Commit 6 will reuse it.
- [ ] 2.4 **GREEN (module wiring)**: extend `src/app.module.ts` with `TypeOrmModule.forRootAsync({ useFactory: cs => AppDataSource.options, inject: [ConfigService] })`. Extend `src/auth/auth.module.ts` with `TypeOrmModule.forFeature([UserEntity])`.
- [ ] 2.5 **RED (bootstrap still green)**: confirm `src/main.spec.ts` prefix probe at line 40-56 still hits `POST /api/v1/auth` and expects 201 (it still does — the stub `AuthController` is still in place). No test change in this commit. The fixup is Commit 7.
- [ ] 2.6 **RED (DTO deletion — net negative LOC, not a test)**: delete `src/auth/dto/create-auth.dto.ts` and `src/auth/dto/update-auth.dto.ts` — they are referenced only by the stub `AuthController` (still alive) and `auth.controller.spec.ts` (still alive). The 2.7 task fixes the imports.
- [ ] 2.7 **GREEN (test import fixup)**: update `src/auth/auth.controller.spec.ts` and `src/auth/auth.service.spec.ts` to drop imports of the deleted DTO files. They still smoke-test the stubs — Commit 3 + Commit 4 will replace those tests wholesale.
- [ ] 2.8 Run `npm run build`, `npm test`, `npm run lint`, `npm run format`. Commit. (Note: `AuthService` and `AuthController` are still the stubs; the bootstrap e2e prefix probe at line 107-121 in `test/bootstrap.e2e-spec.ts` still passes because the stub `AuthController` returns 201 on `POST /api/v1/auth`.)

### 3. Commit 3 — AuthService + bcrypt + JWT (`feat(auth): ...`)

- [ ] 3.1 **RED**: replace `src/auth/auth.service.spec.ts` with 9 branches:
  - login happy path → returns `{ accessToken, expiresIn, refreshToken, refreshExpiresInSeconds }`; `bcrypt.compare` invoked on the stored hash; `rtRepo.insert` called with `{ user_id, family_id: <uuid>, hashed_token: sha256(refreshToken), expires_at }`
  - login unknown email → throws `UnauthorizedException`; NO `bcrypt.compare` against a real hash (constant-time dummy compare path is a follow-up — see Open Question §G.2)
  - login wrong password → throws `UnauthorizedException`; `bcrypt.compare` called once and returned false
  - refresh happy → old row `revoked_at` set + `replaced_by` points to new row; new row shares `family_id`; new `Set-Cookie` payload returned
  - refresh reuse-detected (presented cookie's row already has `revoked_at`) → throws `UnauthorizedException`; `rtRepo.update` called with `{ revoked_at: now() }` for ALL rows matching the family
  - refresh missing cookie → throws `UnauthorizedException`; no DB mutation
  - refresh expired cookie (row `expires_at < now`) → throws `UnauthorizedException`; row left unchanged; clear-cookie signal returned
  - logout presented token only → row `revoked_at` set on the presented row ONLY; clear-cookie signal returned
  - logout missing cookie → throws `UnauthorizedException`; no DB mutation
  - getProfile with bearer payload `{ id, email }` → returns `{ id, email }` (no DB hit needed in the happy path)
  Run `npm test -- --testPathPattern=auth.service` — fails because `AuthService` is still the stub.
- [ ] 3.2 **GREEN (refresh-token entity)**: create `src/auth/entities/refresh-token.entity.ts` matching the dbml delta:
  ```ts
  @Entity('refresh_tokens')
  @Index('idx_refresh_tokens_family_id', ['familyId'])
  @Index('idx_refresh_tokens_user_id', ['userId'])
  export class RefreshTokenEntity {
    @PrimaryGeneratedColumn('uuid') id!: string;
    @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
    @Column({ name: 'family_id', type: 'uuid' }) familyId!: string;
    @Column({ name: 'hashed_token', type: 'varchar', unique: true }) hashedToken!: string;
    @Column({ name: 'expires_at', type: 'timestamp' }) expiresAt!: Date;
    @Column({ name: 'revoked_at', type: 'timestamp', nullable: true }) revokedAt!: Date | null;
    @Column({ name: 'replaced_by', type: 'uuid', nullable: true }) replacedBy!: string | null;
    @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  }
  ```
- [ ] 3.3 **GREEN (AuthService.login)**: replace `src/auth/auth.service.ts`. Inject `@InjectRepository(UserEntity)`, `@InjectRepository(RefreshTokenEntity)`, `JwtService`, `ConfigService<EnvConfig>`. `login(email, password)`:
  1. `userRepo.findOne({ where: { email }, select: ['id', 'email', 'password'] })` (force-select because `password` has `select: false`)
  2. `if (!user) throw new UnauthorizedException()`
  3. `const ok = await bcrypt.compare(password, user.password); if (!ok) throw new UnauthorizedException()`
  4. `const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email }, { secret: cs.get('JWT_SECRET'), expiresIn: cs.get('JWT_EXPIRES_IN') })`
  5. `const refreshToken = crypto.randomBytes(32).toString('base64url')`
  6. `const hashedToken = sha256(refreshToken)`
  7. `const familyId = randomUUID()`
  8. `const expiresAt = new Date(Date.now() + Number(cs.get('JWT_REFRESH_EXPIRES_IN')) * 1000)`
  9. `await rtRepo.insert({ userId: user.id, familyId, hashedToken, expiresAt })`
  10. Return `{ accessToken, expiresIn: <derived from JWT_EXPIRES_IN seconds>, refreshToken, refreshExpiresInSeconds: Number(cs.get('JWT_REFRESH_EXPIRES_IN')) }`
- [ ] 3.4 **GREEN (AuthService.refresh)**: `refresh(presentedToken)`:
  1. If `!presentedToken` → `throw new UnauthorizedException()`
  2. `const presentedHash = sha256(presentedToken)`
  3. `const row = await rtRepo.findOne({ where: { hashedToken: presentedHash } })`
  4. If `!row` or `row.expiresAt < new Date()` → throw + return `{ clearCookie: true }`
  5. If `row.revokedAt !== null` → REUSE: `await rtRepo.update({ familyId: row.familyId, revokedAt: IsNull() }, { revokedAt: new Date() })`; throw + return `{ clearCookie: true }`
  6. Happy path: `await rtRepo.update(row.id, { revokedAt: new Date() })`
  7. `const newRefreshToken = crypto.randomBytes(32).toString('base64url')`
  8. `const newHash = sha256(newRefreshToken)`
  9. `const newRow = await rtRepo.insert({ userId: row.userId, familyId: row.familyId, hashedToken: newHash, expiresAt: ... })`
  10. `await rtRepo.update(row.id, { replacedBy: newRow.identifiers[0].id })`
  11. Issue new access token, return same shape as login + `{ clearCookie: false, refreshToken: newRefreshToken }`
- [ ] 3.5 **GREEN (AuthService.logout)**: `logout(presentedToken)`:
  1. If `!presentedToken` → throw
  2. `const presentedHash = sha256(presentedToken)`
  3. `const row = await rtRepo.findOne({ where: { hashedToken: presentedHash } })`
  4. If `!row` → throw + return `{ clearCookie: true }`
  5. `await rtRepo.update(row.id, { revokedAt: new Date() })` (presented row ONLY — spec question #3 resolved)
  6. Return `{ clearCookie: true }`
- [ ] 3.6 **GREEN (AuthService.getProfile)**: `getProfile(reqUser)` returns `{ id: reqUser.id, email: reqUser.email }` (pure mapping).
- [ ] 3.7 **GREEN (AuthModule providers)**: extend `src/auth/auth.module.ts`:
  ```ts
  imports: [JwtModule.registerAsync({ useFactory: cs => ({ secret: cs.get('JWT_SECRET'), signOptions: { expiresIn: cs.get('JWT_EXPIRES_IN') } }), inject: [ConfigService] }), PassportModule, TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity])],
  providers: [AuthService],
  ```
  (JwtStrategy and JwtAuthGuard land in Commit 5; for now the service tests inject `JwtService` directly via `JwtModule.register`.)
- [ ] 3.8 Run `npm run build`, `npm test -- --testPathPattern=auth.service`, `npm run lint`, `npm run format`. Commit. Note: the bootstrap e2e prefix probe at `test/bootstrap.e2e-spec.ts:107` STILL passes (the stub `AuthController` is alive).

### 4. Commit 4 — AuthController + DTOs + Swagger (`feat(auth): ...`)

- [x] 4.1 **RED**: replace `src/auth/auth.controller.spec.ts` with HTTP-shape assertions via supertest:
  - `POST /api/v1/auth/login` with `{ email: 'admin@x.io', password: 'correct' }` → 200, body `{ accessToken, expiresIn, refreshToken, refreshExpiresInSeconds }`, header `Set-Cookie: rt=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<n>`
  - `POST /api/v1/auth/login` with bad creds → 401, NO `Set-Cookie`
  - `POST /api/v1/auth/login` with `{ email: 'not-an-email', password: 'short' }` → 400 (validation pipe)
  - `GET /api/v1/auth/profile` (stub for now — guard lands in Commit 5) with no `Authorization` → 401 (handled by guard in 5; mark test as `.skip` until 5)
  Run `npm test -- --testPathPattern=auth.controller` — fails because `AuthController` is still the stub returning the literal `"This action adds a new auth"`.
- [x] 4.2 **GREEN (DTOs)**: create `src/auth/dto/login.dto.ts`:
  ```ts
  export class LoginDto {
    @ApiProperty({ format: 'email' })
    @IsEmail()
    email!: string;
    @ApiProperty({ minLength: 8 })
    @IsString()
    @MinLength(8)
    password!: string;
  }
  ```
  Create `src/auth/dto/refresh.dto.ts` (empty class, exists for Swagger metadata + future-proofing).
  Create `src/auth/dto/auth-response.dto.ts` with `@ApiProperty` for `{ accessToken: string; expiresIn: number; refreshToken: string; refreshExpiresInSeconds: number }`.
- [x] 4.3 **GREEN (controller replacement)**: replace `src/auth/auth.controller.ts`:
  ```ts
  @ApiTags('auth')
  @Controller('auth')
  export class AuthController {
    constructor(private readonly auth: AuthService) {}
    @Post('login')
    @HttpCode(200)
    async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
      const result = await this.auth.login(dto.email, dto.password);
      this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresInSeconds);
      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    }
    @Post('refresh')
    @HttpCode(200)
    async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
      const presented = req.cookies?.['rt'];
      const result = await this.auth.refresh(presented);
      if (result.clearCookie) this.clearRefreshCookie(res);
      else this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresInSeconds);
      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    }
    @Post('logout')
    @HttpCode(200)
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
      const presented = req.cookies?.['rt'];
      const result = await this.auth.logout(presented);
      if (result.clearCookie) this.clearRefreshCookie(res);
      return {};
    }
    @ApiBearerAuth()
    @Get('profile')
    getProfile(@Req() req: Request) {
      return this.auth.getProfile(req.user as { id: string; email: string });
    }
    private setRefreshCookie(res: Response, token: string, maxAgeSeconds: number) {
      res.cookie('rt', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: maxAgeSeconds * 1000 });
    }
    private clearRefreshCookie(res: Response) {
      res.cookie('rt', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
    }
  }
  ```
- [x] 4.4 **GREEN (cookie-parser for `req.cookies`)**: install `cookie-parser@^1` and `@types/cookie-parser@^1`. Add to `package.json`. Wire `cookieParser()` in `src/main.ts` (and mirror in `test/bootstrap.e2e-spec.ts`'s `bootstrapTestApp`). Required for `req.cookies['rt']` to work; both unit and e2e tests will otherwise see `undefined`.
- [x] 4.5 **GREEN (e2e happy paths)**: create `test/auth.e2e-spec.ts` with 4 happy-path blocks: login → expect 200 + cookie + refresh row; refresh happy → expect 200 + new cookie + `replaced_by`; logout → expect 200 + clear cookie; profile → mark as `.skip` until Commit 5 lands guard. Run `npm run test:e2e -- --testPathPattern=auth.e2e` — passes for login/refresh/logout.
- [x] 4.6 Run `npm run build`, `npm test`, `npm run test:e2e -- --testPathPattern=auth.e2e`, `npm run lint`, `npm run format`. Commit.

### 5. Commit 5 — JwtStrategy + JwtAuthGuard (`feat(auth): ...`)

- [x] 5.1 **RED**: extend `test/auth.e2e-spec.ts` with the 4 guard branches:
  - `GET /api/v1/auth/profile` without `Authorization` → 401 (controller method NOT invoked)
  - `GET /api/v1/auth/profile` with `Authorization: Bearer <expired>` → 401
  - `GET /api/v1/auth/profile` with `Authorization: Bearer <bad-sig>` → 401
  - `GET /api/v1/auth/profile` with valid bearer → 200 + `{ id, email }`
  Run `npm run test:e2e -- --testPathPattern=auth.e2e` — fails because no guard is wired (the route would 500 or pass-through).
- [x] 5.2 **RED (no APP_GUARD)**: extend `src/app.module.spec.ts` with a static assertion that `AppModule`'s source contains NO `APP_GUARD` provider referencing `JwtAuthGuard`:
  ```ts
  const appModuleSource = readFileSync(resolve(__dirname, 'app.module.ts'), 'utf8');
  expect(appModuleSource).not.toMatch(/APP_GUARD.*JwtAuthGuard/);
  ```
  Run `npm test` — fails because `JwtAuthGuard` doesn't exist yet.
- [x] 5.3 **GREEN (JwtStrategy)**: create `src/auth/strategies/jwt.strategy.ts`:
  ```ts
  @Injectable()
  export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
    constructor(cs: ConfigService<EnvConfig>) {
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        secretOrKey: cs.get('JWT_SECRET')!,
      });
    }
    async validate(payload: { sub: string; email: string }) {
      return { id: payload.sub, email: payload.email };
    }
  }
  ```
- [x] 5.4 **GREEN (JwtAuthGuard)**: create `src/auth/guards/jwt-auth.guard.ts`:
  ```ts
  @Injectable()
  export class JwtAuthGuard extends AuthGuard('jwt') {}
  ```
- [x] 5.5 **GREEN (per-controller wiring)**: apply `@UseGuards(JwtAuthGuard)` on `AuthController` class (controller-scope — matches spec §3.1 "Protected"). Add `JwtStrategy` and `JwtAuthGuard` to `AuthModule.providers`. (ADR-6 picked per-controller over method-level — the per-controller annotation is one line, the guard skips `/login`, `/refresh`, `/logout` automatically because no `Authorization` header there. The e2e in 5.1 confirms each.)
- [x] 5.6 **GREEN (app.module.spec assertion)**: the assertion in 5.2 now passes — `app.module.ts` has no `APP_GUARD` line.
- [x] 5.7 Run `npm run build`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run format`. Commit.

### 6. Commit 6 — seed-superuser CLI (`feat(cli): ...`)

- [ ] 6.1 **RED**: create `src/cli/seed-superuser.spec.ts` with 5 branches on the pure function `seedSuperuser(email, password, userRepo)`:
  - happy: `userRepo.findOne` returns null → calls `userRepo.create({ email, password: hashed })` + `userRepo.save(...)`
  - existing row: `userRepo.findOne` returns row → calls `userRepo.update(row.id, { password: hashed })`
  - `bcrypt.compare(SUPERUSER_PASSWORD, row.password)` would be true after a re-run (asserted via the spec's idempotency contract)
  - missing `SUPERUSER_EMAIL`: throws an error naming `SUPERUSER_EMAIL` BEFORE any `repo` call (spy on `userRepo.findOne` — should NOT be invoked)
  - missing/short `SUPERUSER_PASSWORD`: same as above for `SUPERUSER_PASSWORD`
  Run `npm test -- --testPathPattern=seed-superuser` — fails because the file doesn't exist.
- [ ] 6.2 **GREEN (pure function)**: create `src/cli/seed-superuser.ts` with the exported pure function:
  ```ts
  export async function seedSuperuser(email: string, password: string, userRepo: Repository<UserEntity>): Promise<void> {
    if (!email) throw new Error('SUPERUSER_EMAIL is required');
    if (!password || password.length < 8) throw new Error('SUPERUSER_PASSWORD is required (min 8 chars)');
    const hashed = await bcrypt.hash(password, 12);
    const existing = await userRepo.findOne({ where: { email } });
    if (existing) await userRepo.update(existing.id, { password: hashed });
    else await userRepo.save(userRepo.create({ email, password: hashed }));
  }
  ```
- [ ] 6.3 **GREEN (I/O wrapper)**: in the same file, add the `main()` function:
  ```ts
  async function main() {
    const email = process.env.SUPERUSER_EMAIL;
    const password = process.env.SUPERUSER_PASSWORD;
    try {
      await AppDataSource.initialize();
      const repo = AppDataSource.getRepository(UserEntity);
      await seedSuperuser(email!, password!, repo);
      await AppDataSource.destroy();
      console.log(`✓ Superuser ${email} seeded.`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  if (require.main === module) void main();
  ```
- [ ] 6.4 **GREEN (npm script)**: add to `package.json` `"scripts"`:
  ```json
  "seed:superuser": "ts-node src/cli/seed-superuser.ts"
  ```
- [ ] 6.5 Run `npm run build`, `npm test -- --testPathPattern=seed-superuser`, `npm run lint`, `npm run format`. Commit.

### 7. Commit 7 — bootstrap test fixup + README + spec deltas (`chore(specs): ...`)

> Spec deltas (`openspec/specs/server_specs.md` §3.1 + `database-schema.dbml` `refresh_tokens` table) are NOT touched in apply. They are merged by `sdd-archive`. Apply only fixes the broken bootstrap tests and ships the README.

- [ ] 7.1 **RED (refactor — describes the swap)**: in `src/main.spec.ts`, the prefix probe at line 40-56 currently calls `POST /api/v1/auth` and expects 201. Once Commit 4 replaced `AuthController`, this returns 401 (validation pipe rejects empty body). The fixup per design ADR-8: replace the `POST /api/v1/auth` probe with `POST /api/v1/__bootstrap_fixture` (the test-only `FixtureController` already exists in `test/bootstrap.e2e-spec.ts` but NOT in the unit test file — copy the pattern over).
- [ ] 7.2 **GREEN (unit test swap)**: in `src/main.spec.ts`, mirror the fixture pattern from `test/bootstrap.e2e-spec.ts`:
  ```ts
  class FixtureDto { @IsString() name!: string; }
  @Controller('__bootstrap_fixture') class FixtureController { @Post() post(@Body() dto: FixtureDto) { return dto; } }
  @Module({ controllers: [FixtureController] }) class FixtureModule {}
  ```
  Then replace the `Test.createTestingModule({ imports: [AppModule] })` import list with `{ imports: [AppModule, FixtureModule] }`. Update the prefix probe (line 45-49) to `POST /api/v1/__bootstrap_fixture` with `{ name: 'x' }` body and expect 201. Keep the `POST /__bootstrap_fixture` (unprefixed) 404 assertion.
- [ ] 7.3 **GREEN (e2e swap)**: in `test/bootstrap.e2e-spec.ts`:
  - The `describe('global /api/v1 prefix')` block at lines 106-122 currently probes `POST /api/v1/auth` (expects 201). Swap to `POST /api/v1/__bootstrap_fixture` with `{ name: 'x' }` body → 201, and `POST /__bootstrap_fixture` → 404. The fixture module is ALREADY imported (`FixtureModule` at line 49) — no new module declaration needed; just change the URL.
  - The CORS preflight test at line 169-180 currently hits `/api/v1/auth/login`. Change to `/api/v1/__bootstrap_fixture`.
  - The CORS preflight non-echo test at line 184-193 currently hits `/auth/login`. Change to `/__bootstrap_fixture`.
- [ ] 7.4 **GREEN (README)**: in `README.md`:
  - Extend the `### Auth` table (line 129-134) to include `/api/v1/auth/refresh` and `/api/v1/auth/logout` rows
  - Update `### Environment variables` (line 38-44) to list the 5 new vars
  - Add a `### Bootstrap` subsection after the env table documenting `npm run seed:superuser` with a warning that `SUPERUSER_PASSWORD` is a bootstrap secret (production deployments MUST rotate after first login)
  - Extend the `### Scripts` table (line 66-79) with the new `seed:superuser` script
- [ ] 7.5 **GREEN (deletion — bootstrap stubs)**: delete `src/auth/dto/create-auth.dto.ts` and `src/auth/dto/update-auth.dto.ts` if not already deleted in 2.6, and `src/auth/entities/auth.entity.ts` if not already deleted in 2.2. Verify `git grep -n 'CreateAuthDto\|UpdateAuthDto\|AuthEntity'` returns no matches in `src/`.
- [ ] 7.6 Run `npm run build`, `npm test`, `npm run test:e2e`, `npm run lint`, `npm run format`. Confirm all 4 prefix-related assertions (2 in `src/main.spec.ts`, 2 in `test/bootstrap.e2e-spec.ts`) pass against `/api/v1/__bootstrap_fixture` and that `test/auth.e2e-spec.ts` covers the 4 auth endpoints + guard. Commit.

## D. Test strategy

Per the design §Test Strategy, two layers with strict TDD:

**Unit (`*.spec.ts` colocated in `src/`)**

| File | Covers | Mocking strategy |
|------|--------|------------------|
| `src/auth/auth.service.spec.ts` (Commit 3) | 9 branches of login/refresh/logout/getProfile | Real `bcrypt.compare` (cheap at 12 rounds, ~30ms); real `JwtService.signAsync` against an in-memory `JWT_SECRET` via `JwtModule.register({ secret: 'test-secret-32-chars-min-..................' })`; fake `UserRepository` + `RefreshTokenRepository` via `getRepositoryToken` |
| `src/auth/auth.controller.spec.ts` (Commit 4) | HTTP-shape: 200 + body + `Set-Cookie` attrs on login; 401 on bad creds; 400 on malformed body; 401 on missing bearer (until Commit 5) | Real `AuthService` (no mocks of own code per strict TDD); supertest against `Test.createTestingModule` |
| `src/auth/entities/user.entity.spec.ts` (Commit 2) | `UserEntity` column metadata: `id`, `email`, `password`, `createdAt`, `updatedAt`; `unique: true` on `email`; `select: false` on `password` | TypeORM metadata inspector via `getMetadata(UserEntity)`; no DB |
| `src/cli/seed-superuser.spec.ts` (Commit 6) | 5 branches: happy create / happy update / password > 8 / missing email / missing password | Fake `userRepo` (`jest.fn()`); env via `process.env` stub |
| `src/main.spec.ts` (Commit 7 modified) | prefix probe via `__bootstrap_fixture`; `process.env.PORT` direct-read forbidden; `ValidationPipe` option bag; CORS echo; Swagger mount + JSON shape | Per `bootstrap-api-config` ADR-3 — `process.env` pre-import, `bootstrap()` invoked |
| `src/app.module.spec.ts` (Commit 2 extended, Commit 5 extended) | (Commit 2) `ConfigModule` global; (Commit 5) NO `APP_GUARD` for `JwtAuthGuard` | `readFileSync(app.module.ts)` regex |

**E2E (`test/*.e2e-spec.ts`)**

| File | Covers | Approach |
|------|--------|----------|
| `test/bootstrap.e2e-spec.ts` (Commit 7 modified) | prefix probe via `__bootstrap_fixture`; CORS echo/non-echo; Swagger; missing-env | Per `bootstrap-api-config` ADR-1/3/4/5. The `__bootstrap_fixture` is already declared at line 38-49. URL swaps per 7.3. |
| `test/auth.e2e-spec.ts` (Commit 4 new, extended Commit 5) | login happy/401/400; refresh happy/reuse-detect (replay old cookie → whole family revoked); logout happy/missing-cookie; profile 200 with bearer/401 missing/401 expired/401 invalid sig; Swagger `Auth` tag + bearer padlock | `Test.createTestingModule` with `AppModule`; `supertest` against `app.getHttpServer()`. Repositories mocked at `getRepositoryToken` level (no live DB — per design §Migration / Rollout). `__bootstrap_fixture`-style "test-only" approach is NOT used here; `test/auth.e2e-spec.ts` IS the auth domain's contract test. |

**bcrypt / jwt mocking convention** (mirrors `bootstrap-api-config` ADR-1 fixtures):

- **bcrypt**: real `bcrypt.compare` + `bcrypt.hash` in unit tests. 12 rounds is ~30-50ms; ~20 calls per `auth.service.spec.ts` ≈ <2s total, well under default Jest timeout. No `bcryptjs` substitution.
- **JwtService**: instantiate via `JwtModule.register({ secret: 'test-secret-32-chars-min-..................', signOptions: { expiresIn: '15m' } })` in the unit test; `.signAsync` and `.verifyAsync` against the same in-memory secret. Gives the real token shape so `passport-jwt` can verify it in e2e without a second code path.
- **Repositories**: `getRepositoryToken(UserEntity)` and `getRepositoryToken(RefreshTokenEntity)` replaced with `useValue` objects implementing the methods the service calls (`findOne`, `save`, `update`, `insert`, `create`). No in-memory DB (no `better-sqlite3` in deps).
- **Fixtures in tests** mirror `bootstrap-api-config` ADR-1: declare test-only DTO + controller + module inside the test file (NOT in `src/`); commit 7 reuses the pattern for the prefix probe.

## E. Risk register

| Risk | Likelihood | Tasks-phase mitigation |
|------|------------|------------------------|
| `bcrypt` native binding fails to install in CI / deploy image. | Low | Commit 1.4 adds the dep + a post-install smoke (`node -e "require('bcrypt')"` in CI); `package.json` records the Node version pin in `.nvmrc` (already present). |
| Refresh-token reuse-detection false-positive revokes a legitimate user mid-session. | Low | Commit 3.1 test 5 (refresh reuse-detected) and Commit 5 reuse-detect e2e both cover this. The 401 + clear-cookie + client-treats-as-re-login contract is pinned in spec question #4 (resolved). |
| `synchronize: false` leaves schema out of sync with entity on first run. | Med | Commit 2.3 declares `AppDataSource` with `synchronize: false`. Commit 6's seed CLI's `dataSource.initialize()` will throw on missing tables (documented in design §Migration / Rollout); first migration is explicitly out of scope per proposal. README Commit 7.4 warns that the seed CLI requires the migration to be applied first. |
| `main.spec.ts` + `bootstrap.e2e-spec.ts` swap weakens the prefix test. | Med | The bootstrap tests assert the PREFIX, not the auth controller. The `__bootstrap_fixture` pattern (design ADR-8, mirrored from `bootstrap-api-config` ADR-1) is the documented contract. Commit 7 PR description must call out: "swap from `/api/v1/auth` to `/api/v1/__bootstrap_fixture`; auth domain's own endpoints covered in `test/auth.e2e-spec.ts`." |
| Hardcoded seed email/password sitting in `.env` for a long-lived superuser. | Med | Commit 7.4 README warns `SUPERUSER_PASSWORD` is a bootstrap secret; production deployments MUST rotate after first login. Login + change-password is explicitly a follow-up change. |
| Commit 4's e2e file grows past 120 LOC, pushing the PR over budget. | Med | The 4 happy-path branches in Commit 4 are ~60 LOC; Commit 5 adds the 4 guard branches (~40 LOC); the reuse-detect family assertion is ~30 LOC and lands in Commit 5. If the total e2e file exceeds 150 LOC, split per design §Review Workload Forecast ("split the test file in Commit 4 from Commit 5, keeping reuse-detection in Commit 5"). |
| Timing oracle in `login` (early `if (!user) throw` leaks via response time). | Low | Open Question §G.2; if apply decides to fix, it lands in Commit 3.3 by hashing a dummy value on the unknown-email path before the `throw` and asserting both branches call `bcrypt.compare` via `jest.spyOn`. |
| `cookie-parser` not wired → `req.cookies` is `undefined` → refresh/logout always 401. | Low | Commit 4.4 installs and wires `cookieParser()` in `main.ts` AND in the e2e's `bootstrapTestApp`. The auth.controller.spec.ts test module also needs `cookieParser()` middleware (`app.use(cookieParser())`) for the unit test. |

## F. Review Workload Forecast

> The orchestrator gates `sdd-apply` on this section.

### Forecast numbers

| Field | Value | Source |
|-------|-------|--------|
| Lines added total | ~350 | Per-commit LOC table in §B; design §Review Workload Forecast |
| Lines deleted total | ~20 | `auth.controller.ts` (42) + `auth.service.ts` (26) − stub `.spec.ts` rewrites are swaps not deletes; `auth.entity.ts` (1), `create-auth.dto.ts` (1), `update-auth.dto.ts` (4) |
| Net changed lines | ~370 | additions + deletions |
| Largest single commit LOC | ~80 | Commit 3 (AuthService + RefreshToken entity + 9-branch test) |
| Auth e2e test file LOC | ~150 | 4 happy (Commit 4, ~60 LOC) + 4 guard (Commit 5, ~40 LOC) + 1 reuse-detect family assertion (~30 LOC) + bootstrap (~20 LOC) |
| AuthService test file LOC | ~90 | 9 branches × ~10 LOC |
| 400-line budget risk | Low | Net 370 < 400, ~30 LOC headroom |
| Chained PRs recommended | No | Largest commit (80 LOC) < 150 LOC threshold; net (370) < 400; e2e (150) > 120 LOC threshold BUT can be split per design §Review Workload Forecast ("split Commit 4 test from Commit 5"). Acceptable single PR. |
| Decision needed before apply | Yes | Per `ask-always` delivery strategy — orchestrator MUST ask user before launching `sdd-apply`. |
| Proposed slices (if user picks chained) | (empty — chained not recommended; see below for fallback) | |

**Forecast plain-text lines (literal contract)**:

```
Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
```

### If the user opts for chained PRs anyway (fallback slice plan)

If the orchestrator's ask-always conversation surfaces budget concerns (e.g. the user reads the design's caveat about e2e file growth past 120 LOC), a defensible split is:

- **Slice A — Commits 1+2**: deps + env schema + TypeORM + User entity (~70 LOC). Self-contained foundation; user can review "the new schema infra" first.
- **Slice B — Commits 3+4+5**: AuthService + controller + guard + DTOs + RefreshToken entity + Swagger (~200 LOC e2e included). The core auth domain.
- **Slice C — Commits 6+7**: seed CLI + bootstrap test fixup + README (~80 LOC). Wrap-up + spec mirror.

Each slice is independently shippable and tests independently. Slice B is the only one at risk of the 400-line budget if the e2e test file grows past 150 LOC; the fallback inside Slice B is to split Commit 4's e2e (happy paths) from Commit 5's e2e (guard + reuse-detect) — at that point you have a 4-slice plan.

## G. Open questions for the apply phase

The design is the source of truth. These are the only nits the apply phase should resolve as it works through Commit 3 (per design §Open Questions for the Apply Phase):

1. **Hashing in `seed-superuser.ts`**: confirm Commit 6.2 calls `bcrypt.hash(plain, 12)` inside the pure function (already specified in 6.2), NOT by re-using a service method. Rationale: the CLI does not import the Nest application context, and the service depends on `JwtService` and repositories it doesn't need.
2. **Constant-time password compare**: `bcrypt.compare` is constant-time, but `userRepo.findOne` followed by an early `if (!user) throw 401` is NOT. The apply phase MAY choose to add a dummy `bcrypt.compare` on the unknown-email path before the `throw` to equalize response time. If implemented, it lands in Commit 3.3 and is testable with `jest.spyOn(bcrypt, 'compare')` asserting both branches call it. Not blocking.

No other open questions. The 4 spec-phase questions are resolved in the spec delta (table at the end of `specs/auth-domain/spec.md`). All 10 ADRs in `design.md` are decisions, not open questions.

---

## Forecast summary

- **Total LOC**: ~370 net (350 add + 20 delete). **Under 400-line review budget** with ~30 LOC headroom.
- **Single PR feasible** per design §Review Workload Forecast. The user's `ask-always` delivery strategy means the orchestrator will surface this forecast to the user, who can override to chained.
- **Strict TDD ON** — every commit is RED → GREEN. Commit 7 is the bootstrap test fixup (refactor-only swap), so its "RED" is a description of what the swap achieves, not a failing test.
- **All 4 pre-decided open questions** are resolved by the spec delta — apply phase does not re-litigate.
- **Risk-aware**: 7 risks catalogued in §E, each with a per-task mitigation.

**Next step (per orchestrator gate)**: hand the forecast to the orchestrator; the orchestrator must ask the user whether to ship as a single PR or chain per `ask-always`. On user confirmation, launch `sdd-apply` for `auth-domain`.