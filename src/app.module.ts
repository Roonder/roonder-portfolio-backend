import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerModule } from "@nestjs/throttler";
import { EventEmitterModule } from "@nestjs/event-emitter";
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
		// reviews-throttling (T6, ADR-2 / ADR-3) + contact-throttling
		// (T1.2): register the throttler once at the AppModule level via
		// `forRootAsync`. The factory reads the three reviews env vars
		// AND the three contact env vars via the typed
		// `ConfigService<EnvConfig>` and returns a single named tracker
		// `{ name: "default", ttl, limit: Math.min(...) }`. The default
		// tracker uses the smaller of the two domain write limits so
		// an operator who forgets to set a domain-specific env still
		// gets a safe default. The per-route `@Throttle()` decorator on
		// each public route (the reviews and contact public routes)
		// OVERRIDES this `default` tracker with the domain-specific
		// limit. `ThrottlerGuard` is NOT registered as `APP_GUARD` (per
		// ADR-2); the throttler is applied per-route via the
		// `@ThrottledWrite()` / `@ThrottledRead()` / `@ThrottledContactWrite()`
		// factories in `src/{reviews,contact}/throttle.decorator.ts`.
		ThrottlerModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (config: ConfigService<EnvConfig>) => {
				const reviewsTtl = config.get("REVIEWS_THROTTLE_TTL_MS", {
					infer: true,
				}) as number;
				const reviewsWriteLimit = config.get(
					"REVIEWS_THROTTLE_WRITE_LIMIT",
					{ infer: true },
				) as number;
				const contactTtl = config.get("CONTACT_THROTTLE_TTL_MS", {
					infer: true,
				}) as number;
				const contactWriteLimit = config.get(
					"CONTACT_THROTTLE_WRITE_LIMIT",
					{ infer: true },
				) as number;
				// The "default" tracker uses the smaller of the two
				// domain TTLs + write limits so the operator never gets
				// an unthrottled default. Per-route @Throttle() on the
				// reviews and contact public routes overrides this
				// with the domain-specific values.
				const ttl = Math.min(reviewsTtl, contactTtl);
				const limit = Math.min(reviewsWriteLimit, contactWriteLimit);
				return [{ name: "default", ttl, limit }];
			},
		}),
		// contact-domain (T1.2): register the global EventEmitter2 bus.
		// `forRoot()` makes the bus global so any module (in particular
		// the contact module's `ContactEmailListener`) can subscribe via
		// `@OnEvent('contact.created', { async: true })` without
		// re-importing `EventEmitterModule`. The reviews and projects
		// modules are unaffected.
		EventEmitterModule.forRoot(),
		ProjectsModule,
		AuthModule,
		ReviewsModule,
		ContactModule,
	],
	controllers: [],
	providers: [],
})
export class AppModule {}
