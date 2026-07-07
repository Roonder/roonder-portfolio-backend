/**
 * Injection token for the `Resend` SDK client.
 *
 * The token is registered as a provider in `ContactModule` via
 * `useFactory` that calls `new Resend(config.get("RESEND_API_KEY"))`
 * (see `src/contact/contact.module.ts`). The `EmailService` depends
 * on the token (NOT on `ConfigService`) so unit tests can pass a
 * fake `Resend` instance via the same token without booting the
 * config layer.
 *
 * Using a `Symbol` (rather than a class or string token) ensures
 * the DI graph is type-safe at the import boundary: a misspelled
 * token in any of the contact-domain files is a compile-time
 * error, not a runtime DI failure.
 */
export const RESEND_CLIENT = Symbol("RESEND_CLIENT");
