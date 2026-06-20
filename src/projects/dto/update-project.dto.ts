import { PartialType } from "@nestjs/swagger";
import { CreateProjectDto } from "./create-project.dto";

/**
 * Body of `PATCH /api/v1/projects/:id` (admin). Every field of
 * `CreateProjectDto` becomes optional via `@nestjs/swagger`'s
 * `PartialType`.
 *
 * The `urls` field keeps the DIFF semantics from the proposal
 * (ADR-1):
 *
 *   - `urls: undefined` (field absent) → service applies NO change
 *     to `project_urls`. The DTO's `@IsOptional` makes the array
 *     validators (`@IsArray`, `@ValidateNested`, `@IsUniqueUrlInArray`)
 *     skip when the value is missing.
 *   - `urls: []` (empty array) → service deletes every row for
 *     the project. `@IsArray` accepts the empty array; the rest of
 *     the array-level decorators accept it too.
 *   - `urls: [...]` (non-empty) → service runs the DIFF.
 *
 * The "field absent vs. empty array" distinction is therefore a
 * payload-shape concern; the DTO accepts both, and the service
 * uses `Object.prototype.hasOwnProperty.call(dto, "urls")` (or
 * `'urls' in dto`) to choose the path.
 */
export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
