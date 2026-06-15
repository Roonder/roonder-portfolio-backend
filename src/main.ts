import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { EnvConfig } from "./config/env.config";

export async function bootstrap(): Promise<INestApplication> {
	const app = await NestFactory.create(AppModule);
	app.setGlobalPrefix("api/v1");
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
	// PORT is required by ENV_CONFIG (Joi.number().required()), so it
	// is present at runtime even though TypeScript's typing allows undefined.
	const port = configService.get("PORT", { infer: true }) as number;
	await app.listen(port);
	return app;
}

if (require.main === module) {
	void bootstrap();
}
