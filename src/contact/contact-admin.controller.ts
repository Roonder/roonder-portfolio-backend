/**
 * STUB — REPLACED in T10.1 with the real admin controller.
 *
 * The `ContactModule` (T9.1) registers both
 * `ContactController` and `ContactAdminController` in its
 * `controllers` array. To keep T9.1's module composition
 * compilable without landing T10.1's full spec in the same
 * commit, this stub satisfies the type signature
 * (`@Controller("admin/contacts")` so the module can mount it
 * at the right path; class-level metadata so the global
 * `JwtAuthGuard` test in T10.1 can verify it).
 *
 * T10.1 will REPLACE this file with the real 2-method
 * controller (`findAllForAdmin` + `updateStatus`) and its
 * colocation spec. The 2 commits are independent: the module's
 * static-contract spec (T9.1) only asserts the import + class
 * reference in the source, not the method surface.
 */
import { Controller, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("contact")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("admin/contacts")
export class ContactAdminController {}
