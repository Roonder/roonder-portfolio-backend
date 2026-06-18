import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
// Modules
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ContactModule } from "./contact/contact.module";
import { ENV_CONFIG } from "./config/env.config";
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
		ProjectsModule,
		AuthModule,
		ReviewsModule,
		ContactModule,
	],
	controllers: [],
	providers: [],
})
export class AppModule {}
