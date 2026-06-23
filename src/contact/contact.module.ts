import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Resend } from "resend";
import { ContactEntity } from "./entities/contact.entity";
import { SentEmailEntity } from "./entities/sent-email.entity";
import { ContactController } from "./contact.controller";
import { ContactAdminController } from "./contact-admin.controller";
import { ContactService } from "./contact.service";
import { EmailService } from "./email/email.service";
import { ContactEmailListener } from "./listeners/contact-email.listener";
import { RESEND_CLIENT } from "./email/resend-client.token";
import { EnvConfig } from "../config/env.config";

/**
 * Contact domain module.
 *
 * Wires:
 *
 *   - 2 entities via `TypeOrmModule.forFeature(...)`:
 *     `ContactEntity` + `SentEmailEntity`. The 2
 *     `@InjectRepository(...)` tokens in `ContactService` and
 *     `ContactEmailListener` resolve to the typeorm-managed
 *     repository instances at runtime.
 *
 *   - 2 controllers:
 *     `ContactController` (the 1-route public POST,
 *     `@ThrottledContactWrite()` per-route) and
 *     `ContactAdminController` (the 2-route JWT-guarded admin
 *     surface, class-level `@UseGuards(JwtAuthGuard)`).
 *
 *   - 3 providers:
 *     `ContactService`, `EmailService`, `ContactEmailListener`.
 *     The listener is the async `@OnEvent("contact.created")`
 *     subscriber — the global `EventEmitter2` bus
 *     (`EventEmitterModule.forRoot()` in `AppModule`) is shared
 *     across the app; this module only needs to register the
 *     listener class.
 *
 *   - 1 injection-token factory:
 *     `RESEND_CLIENT` provides a `new Resend(apiKey)` instance
 *     at boot. The `EmailService` depends on the token (not on
 *     `ConfigService`) so unit tests can pass a fake `Resend`
 *     without booting the config layer.
 *
 * `EventEmitterModule` is NOT re-imported here (it is
 * `forRoot()`-registered globally in `AppModule`). The listener
 * is wired as a plain provider; the global bus is sufficient.
 *
 * The shared `AppDataSource` (from `src/data-source.ts`) is
 * bootstrapped in `AppModule` via `TypeOrmModule.forRootAsync` —
 * this module only adds the per-feature repositories.
 *
 * `ContactService` is NOT exported (no CLI consumer yet; the
 * design §17 "Out of scope" list excludes a contact seed).
 * The admin controller injects the service via the controllers
 * array.
 */
@Module({
	imports: [TypeOrmModule.forFeature([ContactEntity, SentEmailEntity])],
	controllers: [ContactController, ContactAdminController],
	providers: [
		ContactService,
		EmailService,
		ContactEmailListener,
		{
			provide: RESEND_CLIENT,
			inject: [ConfigService],
			useFactory: (config: ConfigService<EnvConfig>) =>
				new Resend(config.get("RESEND_API_KEY", { infer: true })),
		},
	],
})
export class ContactModule {}
