import {
	Body,
	Controller,
	Get,
	HttpCode,
	Post,
	Req,
	Res,
	UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { LoginDto } from "./dto/login.dto";

// `req.user` is populated by `passport` after `JwtStrategy.validate()`
// returns. The base Express `Request` type does not declare it, so we
// narrow the type at the call site. The cast is safe because the
// `JwtAuthGuard` (Commit 5) blocks any request that does not produce
// a user object.
type AuthenticatedRequest = Request & { user: { id: string; email: string } };

const REFRESH_COOKIE_NAME = "rt";
// Both the `rt` and `access` cookies are scoped to `/` (design §7.2
// table — the access token must ride every request to the site, not
// just /admin). Shared by setRefreshCookie / clearRefreshCookie /
// setAccessCookie.
const COOKIE_PATH = "/";
// Non-HttpOnly cookie that carries the short-lived JWT access token
// so the frontend's React Router loaders can read it on the server
// during SSR (localStorage is browser-only). The bridge to the
// `useSessionStore` zustand store on the client. Attribute contract
// is the single source of truth at
// openspec/changes/auth-fetch-client/design.md §7.2.
const ACCESS_COOKIE_NAME = "access";

/**
 * Public + bearer-protected auth surface.
 *
 * - `POST /api/v1/auth/login`   — exchange email+password for an
 *   access token (body) and refresh token (`rt` HttpOnly cookie).
 * - `POST /api/v1/auth/refresh` — exchange a valid `rt` cookie for a
 *   new access token + new `rt` (rotation). The JwtAuthGuard is NOT
 *   applied here; the `rt` cookie is the credential.
 * - `POST /api/v1/auth/logout`  — revoke the presented `rt` row and
 *   clear the cookie.
 * - `GET  /api/v1/auth/profile` — return the bearer's `{ id, email }`
 *   (Guard applied at the controller level — see Commit 5).
 *
 * The cookie is `httpOnly: true, secure: true, sameSite: 'lax'`. The
 * `secure` flag means the cookie is only sent over HTTPS — the test
 * suite asserts the attribute is present, not that the browser honors
 * it.
 */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
	constructor(private readonly auth: AuthService) {}

	@Post("login")
	@HttpCode(200)
	async login(
		@Body() dto: LoginDto,
		@Res({ passthrough: true }) res: Response,
	): Promise<{ accessToken: string; expiresIn: number }> {
		const result = await this.auth.login(dto.email, dto.password);
		this.setRefreshCookie(
			res,
			result.refreshToken,
			result.refreshExpiresInSeconds,
		);
		this.setAccessCookie(res, result.accessToken, result.expiresIn);
		return { accessToken: result.accessToken, expiresIn: result.expiresIn };
	}

	@Post("refresh")
	@HttpCode(200)
	async refresh(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<{ accessToken: string; expiresIn: number }> {
		const presented = this.readRefreshCookie(req);
		const result = await this.auth.refresh(presented);
		if (result.clearCookie) {
			this.clearRefreshCookie(res);
		} else {
			this.setRefreshCookie(
				res,
				result.refreshToken,
				result.refreshExpiresInSeconds,
			);
		}
		this.setAccessCookie(res, result.accessToken, result.expiresIn);
		return { accessToken: result.accessToken, expiresIn: result.expiresIn };
	}

	@Post("logout")
	@HttpCode(200)
	async logout(
		@Req() req: Request,
		@Res({ passthrough: true }) res: Response,
	): Promise<Record<string, never>> {
		const presented = this.readRefreshCookie(req);
		const result = await this.auth.logout(presented);
		if (result.clearCookie) {
			this.clearRefreshCookie(res);
		}
		return {};
	}

	@ApiBearerAuth()
	// `JwtAuthGuard` is method-level (not class-level) per design ADR-6
	// and spec §Requirement: JwtAuthGuard. Class-level would reject the
	// public login/refresh/logout endpoints with 401 — those endpoints
	// read credentials from the `rt` cookie, not from `Authorization`.
	@UseGuards(JwtAuthGuard)
	@Get("profile")
	getProfile(@Req() req: AuthenticatedRequest): {
		id: string;
		email: string;
	} {
		return this.auth.getProfile(req.user);
	}

	private readRefreshCookie(req: Request): string | undefined {
		const cookies = req.cookies as Record<string, string> | undefined;
		return cookies?.[REFRESH_COOKIE_NAME];
	}

	private setRefreshCookie(
		res: Response,
		token: string,
		maxAgeSeconds: number,
	): void {
		res.cookie(REFRESH_COOKIE_NAME, token, {
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			path: COOKIE_PATH,
			maxAge: maxAgeSeconds * 1000,
		});
	}

	private clearRefreshCookie(res: Response): void {
		res.cookie(REFRESH_COOKIE_NAME, "", {
			httpOnly: true,
			secure: true,
			sameSite: "lax",
			path: COOKIE_PATH,
			maxAge: 0,
		});
	}

	// SSR bridge — the access JWT travels in a non-HttpOnly cookie so
	// the frontend's React Router loaders can forward it as the
	// `Authorization: Bearer` header on protected fetches, AND the
	// client-side `useSessionStore` can read it without a round-trip.
	// The `rt` cookie stays HttpOnly because it is the long-lived
	// credential that can be replayed; the access token's 15-minute
	// `JWT_EXPIRES_IN` caps the XSS exposure. Attribute contract is
	// locked at openspec/changes/auth-fetch-client/design.md §7.2.
	private setAccessCookie(
		res: Response,
		accessToken: string,
		expiresInSeconds: number,
	): void {
		res.cookie(ACCESS_COOKIE_NAME, accessToken, {
			httpOnly: false,
			secure: true,
			sameSite: "lax",
			path: COOKIE_PATH,
			maxAge: expiresInSeconds * 1000,
		});
	}
}
