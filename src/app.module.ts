import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
// Modules
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ContactModule } from "./contact/contact.module";
import { ENV_CONFIG } from "./config/env.config";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			validationSchema: ENV_CONFIG,
			cache: true,
			envFilePath: [".env"],
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
