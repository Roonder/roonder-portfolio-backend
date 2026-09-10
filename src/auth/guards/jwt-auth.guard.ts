import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * `passport-jwt` guard applied method-level with
 * `@UseGuards(JwtAuthGuard)` on `AuthController.getProfile` (per spec
 * §Requirement: JwtAuthGuard and design ADR-6). Login/refresh/logout
 * are public because the guard is NOT applied to those routes.
 *
 * The default `handleRequest` returns 401 on any failure (missing
 * header, invalid signature, expired token).
 *
 * NOT registered as a global `APP_GUARD` — see the static guard-rail
 * assertion in `src/app.module.spec.ts`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {}
