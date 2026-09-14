import { Module } from "@nestjs/common";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";

/**
 * Uploads domain module — mirrors the `ProjectsModule` / `ContactModule`
 * shape (thin module, no entities of its own). `UploadsService` is
 * exported so `ProjectsModule` can inject it to resolve a project's
 * `coverImage` key into a freshly-signed GET URL on every read.
 */
@Module({
	controllers: [UploadsController],
	providers: [UploadsService],
	exports: [UploadsService],
})
export class UploadsModule {}
