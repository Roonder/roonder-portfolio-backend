import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { UserEntity } from "./entities/user.entity";
import { RefreshTokenEntity } from "./entities/refresh-token.entity";
import { EnvConfig } from "../config/env.config";

@Module({
	imports: [
		TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity]),
		JwtModule.registerAsync({
			inject: [ConfigService],
			useFactory: (cs: ConfigService<EnvConfig>) => ({
				secret: cs.get("JWT_SECRET", { infer: true }) as string,
				signOptions: {
					// `StringValue` literal type from `@nestjs/jwt` (a typed
					// duration string). Cast keeps the env-driven value
					// compatible with the library's strict union.
					expiresIn: cs.get("JWT_EXPIRES_IN", {
						infer: true,
					}) as `${number}${"s" | "m" | "h" | "d" | "w" | "y"}`,
				},
			}),
		}),
		PassportModule,
	],
	controllers: [AuthController],
	providers: [AuthService, JwtStrategy, JwtAuthGuard],
})
export class AuthModule {}
