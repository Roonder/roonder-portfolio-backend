import { Module } from "@nestjs/common";
// Modules
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { ContactModule } from "./contact/contact.module";

@Module({
	imports: [ProjectsModule, AuthModule, ReviewsModule, ContactModule],
	controllers: [],
	providers: [],
})
export class AppModule {}
