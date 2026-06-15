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
	const frontendUrl = configService.get("FRONTEND_URL", { infer: true });
	app.enableCors({ origin: frontendUrl, credentials: true });
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
