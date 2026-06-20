import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ProjectsModule", () => {
	describe("TypeOrmModule.forFeature wiring (static contract)", () => {
		// We read the source file and assert the import + feature
		// registration match the spec scenario
		// "DataSource and ProjectsModule register both entities"
		// in `openspec/changes/projects-crud/specs/projects-domain/spec.md`.
		const source = readFileSync(
			resolve(__dirname, "projects.module.ts"),
			"utf8",
		);

		it("imports TypeOrmModule from @nestjs/typeorm", () => {
			expect(source).toMatch(/from\s+["']@nestjs\/typeorm["']/);
		});

		it("calls TypeOrmModule.forFeature with both entities", () => {
			// The exact pattern: `TypeOrmModule.forFeature([ProjectEntity, ProjectUrlEntity])`.
			// We allow optional whitespace but require both class names in the array.
			const regex =
				/TypeOrmModule\.forFeature\(\s*\[\s*ProjectEntity\s*,\s*ProjectUrlEntity\s*\]\s*\)/;
			expect(source).toMatch(regex);
		});

		it("provides ProjectsService", () => {
			expect(source).toMatch(/providers\s*:\s*\[\s*ProjectsService\s*\]/);
		});

		it("declares ProjectsController at the class level", () => {
			expect(source).toMatch(
				/controllers\s*:\s*\[\s*ProjectsController\s*\]/,
			);
		});
	});
});
