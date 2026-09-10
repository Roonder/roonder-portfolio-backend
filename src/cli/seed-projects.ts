import type { Repository } from "typeorm";
import { AppDataSource } from "../data-source";
import { ProjectEntity } from "../projects/entities/project.entity";
import { ProjectUrlEntity } from "../projects/entities/project-url.entity";

/**
 * Pure seam for the projects seed script. Mirrors the
 * `seed-superuser.ts` shape: a pure function that takes its
 * repositories as parameters (so the unit suite can pass Jest
 * fakes) and an I/O wrapper that owns the `AppDataSource`
 * lifecycle.
 *
 * Insert 3 published projects + 1 unpublished project, each with
 * 1–3 sample `project_urls` rows. The slugs are kebab-case and
 * match the `^[a-z0-9]+(?:-[a-z0-9]+)*$` regex that
 * `CreateProjectDto.slug` enforces. The titles + descriptions are
 * short, self-explanatory; the project URLs are public-looking
 * HTTPS endpoints so the DIFF / cascade coverage in the e2e
 * suite has something to exercise.
 *
 * @param projectRepo    TypeORM repository for `ProjectEntity`.
 * @param projectUrlRepo TypeORM repository for `ProjectUrlEntity`.
 * @returns The list of inserted project rows + the list of inserted
 *          `project_urls` rows. Returned even in `SEED_DRY_RUN=1`
 *          so the caller can log the intended shape; in dry-run
 *          mode the repositories are NEVER touched.
 */
export interface SeedProjectsDeps {
	projectRepo: Repository<ProjectEntity>;
	projectUrlRepo: Repository<ProjectUrlEntity>;
}

export interface SeedSummary {
	projects: Array<{
		slug: string;
		title: string;
		isPublished: boolean;
	}>;
	projectUrls: Array<{
		projectSlug: string;
		title: string;
		url: string;
	}>;
}

interface ProjectSeed {
	slug: string;
	title: string;
	description: string;
	tags: string[];
	isPublished: boolean;
	urls: Array<{ title: string; url: string }>;
}

const SEED: ReadonlyArray<ProjectSeed> = [
	{
		slug: "alpha-portfolio",
		title: "Alpha Portfolio",
		description:
			"A personal portfolio site built with React and NestJS — the reference implementation for the projects domain.",
		tags: ["react", "nestjs", "typescript"],
		isPublished: true,
		urls: [{ title: "Live", url: "https://alpha.example.com" }],
	},
	{
		slug: "beta-storefront",
		title: "Beta Storefront",
		description:
			"Headless storefront demo: product catalog, cart, checkout, all driven by a single REST API.",
		tags: ["nextjs", "stripe", "typescript"],
		isPublished: true,
		urls: [
			{ title: "Live", url: "https://beta.example.com" },
			{ title: "Repo", url: "https://github.com/example/beta" },
		],
	},
	{
		slug: "gamma-cli",
		title: "Gamma CLI",
		description:
			"A small developer tool that wraps the projects API for scripting: list, create, update, delete from the terminal.",
		tags: ["node", "cli", "typescript"],
		isPublished: true,
		urls: [
			{ title: "Repo", url: "https://github.com/example/gamma" },
			{ title: "npm", url: "https://www.npmjs.com/package/gamma-cli" },
			{ title: "Docs", url: "https://gamma.example.com/docs" },
		],
	},
	{
		slug: "draft-sandbox",
		title: "Draft Sandbox",
		description:
			"Unpublished: a sandbox for design experiments and one-off write-paths. Visible only to the admin via the e2e harness.",
		tags: ["sandbox"],
		isPublished: false,
		urls: [{ title: "Preview", url: "https://draft.example.com" }],
	},
];

export async function seedProjects(
	deps: SeedProjectsDeps,
): Promise<SeedSummary> {
	const isDryRun = process.env.SEED_DRY_RUN === "1";
	const projectsSummary: SeedSummary["projects"] = [];
	const urlsSummary: SeedSummary["projectUrls"] = [];

	if (isDryRun) {
		// Return the intended shape WITHOUT touching the repos.
		for (const seed of SEED) {
			projectsSummary.push({
				slug: seed.slug,
				title: seed.title,
				isPublished: seed.isPublished,
			});
			for (const u of seed.urls) {
				urlsSummary.push({
					projectSlug: seed.slug,
					title: u.title,
					url: u.url,
				});
			}
		}
		return { projects: projectsSummary, projectUrls: urlsSummary };
	}

	for (const seed of SEED) {
		const row = deps.projectRepo.create({
			slug: seed.slug,
			title: seed.title,
			description: seed.description,
			content: null,
			coverImage: null,
			tags: seed.tags,
			isPublished: seed.isPublished,
		});
		const saved = await deps.projectRepo.save(row);
		projectsSummary.push({
			slug: saved.slug,
			title: saved.title,
			isPublished: saved.isPublished,
		});
		if (seed.urls.length > 0) {
			await deps.projectUrlRepo.insert(
				seed.urls.map((u) => ({
					projectId: saved.id,
					title: u.title,
					url: u.url,
				})),
			);
			for (const u of seed.urls) {
				urlsSummary.push({
					projectSlug: saved.slug,
					title: u.title,
					url: u.url,
				});
			}
		}
	}

	return { projects: projectsSummary, projectUrls: urlsSummary };
}

/**
 * I/O wrapper. Reads `SEED_DRY_RUN` from the process environment,
 * initializes the shared `AppDataSource` (so the entity list /
 * connection config match the runtime Nest app — see
 * `src/data-source.ts`), invokes the pure `seedProjects`, logs the
 * inserted slugs, and tears the connection down. Exits non-zero
 * with the error message on failure — no DB connection is left
 * open in that path.
 */
async function main(): Promise<void> {
	const isDryRun = process.env.SEED_DRY_RUN === "1";
	try {
		await AppDataSource.initialize();
		const projectRepo = AppDataSource.getRepository(ProjectEntity);
		const projectUrlRepo = AppDataSource.getRepository(ProjectUrlEntity);
		const summary = await seedProjects({ projectRepo, projectUrlRepo });
		await AppDataSource.destroy();
		const mode = isDryRun ? "[DRY RUN] " : "";
		const slugs = summary.projects.map((p) => p.slug).join(", ");
		console.log(
			`\u2713 ${mode}Seeded ${summary.projects.length} projects and ${summary.projectUrls.length} project_urls rows.`,
		);
		console.log(`  Slugs: ${slugs}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(message);
		process.exit(1);
	}
}

if (require.main === module) {
	void main();
}
