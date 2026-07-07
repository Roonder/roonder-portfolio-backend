import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
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
		// limit. `ThrottlerGuard` IS registered as `APP_GUARD` (this
		// is the production wire-up; the per-route `@Throttle()`
		// metadata only takes effect when the guard is applied — see
		// `app.module.spec.ts` for the static guard rail). The
		// `@ThrottledWrite()` / `@ThrottledRead()` /
		// `@ThrottledContactWrite()` factories in
		// `src/{reviews,contact}/throttle.decorator.ts` produce the
		// per-route override metadata.
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
	providers: [
		// Global throttler guard (revisions the original ADR-2 / ADR-4
		// "per-route only" stance). The `@Throttle()` per-route
		// metadata set by `@ThrottledWrite` / `@ThrottledRead` /
		// `@ThrottledContactWrite` factories is only enforced when a
		// `ThrottlerGuard` is in the guard chain. Registering it as
		// `APP_GUARD` makes the rate limit fire in production. The
		// "default" tracker (from `ThrottlerModule.forRootAsync`
		// above) covers every route that has no `@Throttle()`
		// override; the override decorators raise the limit (or
		// scope it per-domain). The admin routes have no
		// `@Throttle()` override so they fall under the "default"
		// tracker, which is permissive (1_000_000 in tests) but
		// capped at the per-domain write limit in production.
		{ provide: APP_GUARD, useClass: ThrottlerGuard },
	],
})
export class AppModule {}
