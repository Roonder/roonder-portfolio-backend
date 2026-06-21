import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerModule } from "@nestjs/throttler";
// Modules
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ContactModule } from "./contact/contact.module";
import { ENV_CONFIG } from "./config/env.config";
import { EnvConfig } from "./config/env.config";
import { AppDataSource } from "./data-source";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validationSchema: ENV_CONFIG,
			cache: true,
			envFilePath: [".env"],
		}),
		// TypeOrmModule wiring (auth-domain commit 2). The shared AppDataSource
		// is the single source of truth for connection options; the seed CLI
		// reuses the same DataSource from src/data-source.ts.
		TypeOrmModule.forRootAsync({
			imports: [ConfigModule],
			inject: [ConfigService],
			useFactory: () => AppDataSource.options,
		}),
		// reviews-throttling (T6, ADR-2 / ADR-3): register the throttler
		// once at the AppModule level via `forRootAsync`. The factory
		// reads the three Joi-validated env vars via the typed
		// `ConfigService<EnvConfig>` and returns a single named tracker
		// `{ name: "default", ttl, limit: writeLimit }`. The default
		// tracker uses the write limit (the safer of the two); the per-
		// route `@Throttle()` decorator on each public route overrides
		// the `default` tracker with the read or write limit.
		// `ThrottlerGuard` is NOT registered as `APP_GUARD` (per ADR-2);
		// the throttler is applied per-route via the `@ThrottledWrite()`
		// / `@ThrottledRead()` factories in `src/reviews/throttle.decorator.ts`.
		ThrottlerModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (config: ConfigService<EnvConfig>) => {
				const ttl = config.get("REVIEWS_THROTTLE_TTL_MS", {
					infer: true,
				}) as number;
				const writeLimit = config.get("REVIEWS_THROTTLE_WRITE_LIMIT", {
					infer: true,
				}) as number;
				return [{ name: "default", ttl, limit: writeLimit }];
			},
		}),
		ProjectsModule,
		AuthModule,
		ReviewsModule,
		ContactModule,
	],
	controllers: [],
	providers: [],
})
export class AppModule {}
