import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import * as bcrypt from "bcrypt";
import { UserEntity } from "./entities/user.entity";
import { RefreshTokenEntity } from "./entities/refresh-token.entity";
import { EnvConfig } from "../config/env.config";

export interface AuthTokens {
	accessToken: string;
	expiresIn: number;
	refreshToken: string;
	refreshExpiresInSeconds: number;
}

export interface RefreshResult extends AuthTokens {
	clearCookie: boolean;
}

export interface LogoutResult {
	clearCookie: boolean;
}

function sha256(plain: string): string {
	return createHash("sha256").update(plain).digest("hex");
}

// `@nestjs/jwt` accepts a Nest-style duration string (e.g. "15m", "1h").
// We translate it to whole seconds so the controller can return a numeric
// `expiresIn` matching RFC 6749's OAuth 2.0 contract.
function durationStringToSeconds(duration: string): number {
	const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration);
	if (!match) return 900; // safe fallback: 15 minutes
	const n = Number(match[1]);
	const unit = match[2];
	switch (unit) {
		case "ms":
			return Math.max(1, Math.round(n / 1000));
		case "s":
			return n;
		case "m":
			return n * 60;
		case "h":
			return n * 60 * 60;
		case "d":
			return n * 60 * 60 * 24;
		default:
			return 900;
	}
}

@Injectable()
export class AuthService {
	constructor(
		@InjectRepository(UserEntity)
		private readonly userRepo: Repository<UserEntity>,
		@InjectRepository(RefreshTokenEntity)
		private readonly refreshTokenRepo: Repository<RefreshTokenEntity>,
		private readonly jwt: JwtService,
		private readonly config: ConfigService<EnvConfig>,
	) {}

	async login(email: string, password: string): Promise<AuthTokens> {
		// `password` is declared `select: false` on the entity — we have to
		// opt in here, otherwise the bcrypt.compare would receive undefined.
		const user = await this.userRepo.findOne({
			where: { email },
			select: { id: true, email: true, password: true },
		});
		if (!user) {
			throw new UnauthorizedException("Invalid credentials");
		}
		const ok = await bcrypt.compare(password, user.password);
		if (!ok) {
			throw new UnauthorizedException("Invalid credentials");
		}
		return this.issueTokensForUser(user.id, user.email);
	}

	async refresh(presentedToken: string | undefined): Promise<RefreshResult> {
		if (!presentedToken) {
			throw new UnauthorizedException("Missing refresh token");
		}
		const presentedHash = sha256(presentedToken);
		const row = await this.refreshTokenRepo.findOne({
			where: { hashedToken: presentedHash },
		});
		if (!row || row.expiresAt < new Date()) {
			throw new UnauthorizedException("Invalid or expired refresh token");
		}
		// Reuse detection: presented row is already revoked. Revoke the
		// whole family (the spec scenario "Replaying a revoked cookie
		// revokes the whole family"). The cookie MUST be cleared so the
		// client cannot continue to retry with a stale value.
		if (row.revokedAt !== null) {
			await this.refreshTokenRepo.update(
				{ familyId: row.familyId, revokedAt: IsNull() },
				{ revokedAt: new Date() },
			);
			throw new UnauthorizedException("Refresh token reuse detected");
		}
		// Happy path: revoke current row, mint a new row in the same family,
		// link them via replaced_by, and issue a fresh access token. The
		// new refresh token is generated here (not inside
		// `issueTokensForUser`) so we can persist it before returning it.
		await this.refreshTokenRepo.update(row.id, { revokedAt: new Date() });
		const newRefreshToken = randomBytes(32).toString("base64url");
		const newHash = sha256(newRefreshToken);
		const expiresAt = new Date(
			Date.now() +
				Number(
					this.config.get("JWT_REFRESH_EXPIRES_IN", { infer: true }),
				) *
					1000,
		);
		const inserted = await this.refreshTokenRepo.insert({
			userId: row.userId,
			familyId: row.familyId,
			hashedToken: newHash,
			expiresAt,
		});
		const newId = (inserted.identifiers[0] as { id: string }).id;
		await this.refreshTokenRepo.update(row.id, { replacedBy: newId });
		// Look up the user's email to sign the access token. We keep the
		// refresh_tokens schema denormalization-free and pay one extra
		// round-trip on rotation only.
		const user = await this.userRepo.findOne({
			where: { id: row.userId },
			select: { id: true, email: true },
		});
		if (!user) {
			throw new UnauthorizedException("User not found");
		}
		const accessToken = await this.signAccessToken(user.id, user.email);
		return {
			accessToken,
			expiresIn: this.accessTokenExpiresInSeconds(),
			refreshToken: newRefreshToken,
			refreshExpiresInSeconds: Number(
				this.config.get("JWT_REFRESH_EXPIRES_IN", { infer: true }),
			),
			clearCookie: false,
		};
	}

	async logout(presentedToken: string | undefined): Promise<LogoutResult> {
		if (!presentedToken) {
			throw new UnauthorizedException("Missing refresh token");
		}
		const presentedHash = sha256(presentedToken);
		const row = await this.refreshTokenRepo.findOne({
			where: { hashedToken: presentedHash },
		});
		if (!row) {
			throw new UnauthorizedException("Invalid refresh token");
		}
		// Spec §Logout: revoke ONLY the presented row, not the family.
		// Future device-management will switch this to family-level
		// revocation (documented as a follow-up change).
		await this.refreshTokenRepo.update(row.id, { revokedAt: new Date() });
		return { clearCookie: true };
	}

	getProfile(reqUser: { id: string; email: string }): {
		id: string;
		email: string;
	} {
		return { id: reqUser.id, email: reqUser.email };
	}

	// --- internal helpers ------------------------------------------------

	private async issueTokensForUser(
		userId: string,
		email: string,
	): Promise<AuthTokens> {
		const accessToken = await this.signAccessToken(userId, email);
		const refreshToken = randomBytes(32).toString("base64url");
		const hashedToken = sha256(refreshToken);
		const familyId = randomUUID();
		const expiresAt = new Date(
			Date.now() +
				Number(
					this.config.get("JWT_REFRESH_EXPIRES_IN", { infer: true }),
				) *
					1000,
		);
		await this.refreshTokenRepo.insert({
			userId,
			familyId,
			hashedToken,
			expiresAt,
		});
		return {
			accessToken,
			expiresIn: this.accessTokenExpiresInSeconds(),
			refreshToken,
			refreshExpiresInSeconds: Number(
				this.config.get("JWT_REFRESH_EXPIRES_IN", { infer: true }),
			),
		};
	}

	private signAccessToken(userId: string, email: string): Promise<string> {
		return this.jwt.signAsync(
			{ sub: userId, email },
			{
				secret: this.config.get("JWT_SECRET", {
					infer: true,
				}) as string,
				expiresIn: this.config.get("JWT_EXPIRES_IN", {
					infer: true,
				}) as `${number}${"s" | "m" | "h" | "d" | "w" | "y"}`,
			},
		);
	}

	private accessTokenExpiresInSeconds(): number {
		return durationStringToSeconds(
			(this.config.get("JWT_EXPIRES_IN", { infer: true }) as string) ??
				"15m",
		);
	}
}
