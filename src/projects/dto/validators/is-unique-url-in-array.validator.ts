import {
	registerDecorator,
	type ValidationOptions,
	ValidatorConstraint,
	type ValidatorConstraintInterface,
} from "class-validator";

/**
 * Class-validator constraint backing `@IsUniqueUrlInArray()`.
 *
 * Per ADR-2: a `ProjectUrlDto[]` payload MUST NOT contain two entries
 * that share the same `url` value, compared case-insensitively on the
 * trimmed lowercased URL. The decorator is paired with `@IsArray` on
 * the host field; the constraint itself stays silent on non-array
 * values so the type error is reported by `@IsArray` alone (single
 * error per payload).
 *
 * Empty `url` strings are ignored here — those are rejected by
 * `@IsUrl` on the nested `ProjectUrlDto`. The constraint only
 * de-duplicates what would otherwise slip through `@IsArray` +
 * `@ValidateNested`.
 */
@ValidatorConstraint({ name: "isUniqueUrlInArray", async: false })
class IsUniqueUrlInArrayConstraint implements ValidatorConstraintInterface {
	validate(value: unknown): boolean {
		if (!Array.isArray(value)) return true; // @IsArray handles the type check
		const seen = new Set<string>();
		for (const entry of value) {
			const raw = (entry as { url?: unknown } | null | undefined)?.url;
			if (typeof raw !== "string") continue;
			const url = raw.trim().toLowerCase();
			if (url.length === 0) continue; // empty url is rejected by @IsUrl on the nested DTO
			if (seen.has(url)) return false;
			seen.add(url);
		}
		return true;
	}

	defaultMessage(): string {
		return "urls[] must not contain duplicate url values (case-insensitive)";
	}
}

/**
 * Decorator factory. Apply on a `ProjectUrlDto[]` field alongside
 * `@IsArray`, `@ValidateNested({ each: true })`, `@Type(() =>
 * ProjectUrlDto)`, and `@ArrayMaxSize`. The order matters: `@IsArray`
 * reports non-arrays; `@ValidateNested` validates each entry;
 * `@IsUniqueUrlInArray` rejects intra-array duplicates.
 */
export function IsUniqueUrlInArray(
	validationOptions?: ValidationOptions,
): PropertyDecorator {
	return (object: object, propertyName: string | symbol): void => {
		registerDecorator({
			name: "isUniqueUrlInArray",
			target: object.constructor,
			propertyName: propertyName as string,
			options: validationOptions,
			validator: IsUniqueUrlInArrayConstraint,
		});
	};
}
