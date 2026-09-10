import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { HttpAdapterHost } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { EnvConfig } from "./config/env.config";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

/**
 * Apply the cross-cutting HTTP setup (global prefix, validation pipe,
 * CORS, Swagger, cookie-parser, global exception filter) to a Nest
 * application. Extracted from `bootstrap()` so tests can build a
 * parallel application with a different module list (e.g. one that
 * does NOT include the TypeOrmModule data source — see
 * `src/main.spec.ts`'s `bootstrapTestApp`).
 */
export function configureApp(app: INestApplication): void {
	app.setGlobalPrefix("api/v1");
	// `app.set('trust proxy', 1)` MUST run BEFORE the throttler
	// (`useGlobalPipes` → `ValidationPipe`) so `req.ip` is resolved
	// from the X-Forwarded-For header set by the single edge proxy
	// (Vercel / Cloudflare / Cloudflare tunnel — see design ADR-5).
	// The throttler reads `req.ip` to scope its per-IP rate limit;
	// without this every request looks like it comes from the proxy
	// itself and the entire public surface throttles as one IP.
	// The value `1` is the single-hop trust (one proxy in front).
	// The cast is required because INestApplication does not
	// re-export Express's `set` method (it lives on the
	// underlying http server); the runtime contract is identical.
	(app as unknown as { set: (k: string, v: number) => void }).set(
		"trust proxy",
		1,
	);
	// `cookieParser()` populates `req.cookies` so the auth controller
	// can read the `rt` refresh token from the HttpOnly cookie. Without
	// it `req.cookies` is `undefined` and refresh/logout always 401.
	app.use(cookieParser());
	app.useGlobalPipes(
		new ValidationPipe({
			whitelist: true,
			transform: true,
			forbidNonWhitelisted: true,
			transformOptions: { enableImplicitConversion: true },
		}),
	);
	const configService = app.get(ConfigService<EnvConfig>);
	// FRONTEND_URL is required by ENV_CONFIG (Joi.string().required()),
	// so it is present at runtime even though TypeScript's typing allows
	// undefined. Cast to string to match the cors callback signature.
	const frontendUrl = configService.get("FRONTEND_URL", {
		infer: true,
	}) as string;
	// `origin` is a function that echoes `frontendUrl` only when the
	// incoming request's Origin matches it. The `cors` package, when
	// `origin` is a plain string, attaches the header to every response
	// regardless of the request's Origin — which would fail the spec's
	// "different origin MUST NOT receive a matching header" requirement.
	app.enableCors({
		origin: (
			requestOrigin: string | undefined,
			callback: (err: Error | null, allow: boolean | string) => void,
		) => {
			// Allow non-browser requests (no Origin header) and same-origin.
			if (!requestOrigin || requestOrigin === frontendUrl) {
				callback(null, frontendUrl);
				return;
			}
			// Different origin: do NOT set Access-Control-Allow-Origin.
			// Returning false causes the cors middleware to skip the header.
			callback(null, false);
		},
		credentials: true,
	});
	const swaggerConfig = new DocumentBuilder()
		.setTitle("Roonder Portfolio API")
		.setVersion("1.0")
		.addBearerAuth()
		.build();
	const document = SwaggerModule.createDocument(app, swaggerConfig);
	SwaggerModule.setup("docs", app, document, { useGlobalPrefix: true });
	// Global exception filter — per spec global-exception-filter/spec.md
	// §Requirement: "Filter Is Registered Globally in main.ts". Wired
	// AFTER the CORS / Swagger / ValidationPipe setup so it is the
	// last word on the body. The filter takes HttpAdapterHost (for
	// `reply`) and ConfigService (for the prod/dev `NODE_ENV` branch).
	app.useGlobalFilters(
		new AllExceptionsFilter(
			app.get(HttpAdapterHost),
			app.get(ConfigService<EnvConfig>),
		),
	);
}

export async function bootstrap(): Promise<INestApplication> {
	const app = await NestFactory.create(AppModule);
	configureApp(app);
	// PORT is required by ENV_CONFIG (Joi.number().required()), so it
	// is present at runtime even though TypeScript's typing allows undefined.
	const port = app.get(ConfigService<EnvConfig>).get("PORT", {
		infer: true,
	}) as number;
	await app.listen(port);
	return app;
}

if (require.main === module) {
	void bootstrap();
}
