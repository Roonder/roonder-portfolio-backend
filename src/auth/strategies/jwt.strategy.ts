import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { EnvConfig } from "../../config/env.config";

interface JwtPayload {
	sub: string;
	email: string;
}

/**
 * Passport strategy that validates the `Authorization: Bearer <jwt>`
 * header against the `JWT_SECRET` env value. The returned `validate()`
 * shape is what `req.user` is set to in downstream controllers
 * (consumed by `AuthController.getProfile`).
 *
 * Wired into `AuthModule.providers` (per design ADR-6: per-controller
 * guard, NOT a global `APP_GUARD`).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
	constructor(cs: ConfigService<EnvConfig>) {
		// `passport-jwt`'s types declare the strategy options as `any`;
		// the runtime shape matches the documented `StrategyOptions`
		// interface. The `super()` call inherits the same loose typing.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
		super({
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			ignoreExpiration: false,
			secretOrKey: cs.get("JWT_SECRET", { infer: true }) as string,
		});
	}

	// The return value is attached to `req.user`. We map the JWT
	// `sub` claim to `id` to match the rest of the auth domain.
	validate(payload: JwtPayload): { id: string; email: string } {
		return { id: payload.sub, email: payload.email };
	}
}
