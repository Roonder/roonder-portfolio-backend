import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
} from "typeorm";

/**
 * Backs the refresh-token rotation flow documented in the
 * `auth-domain` capability spec. The plaintext refresh token is
 * `crypto.randomBytes(32).toString('base64url')`; the row stores
 * `sha256(plaintext)` so the DB never holds the original.
 *
 * The `familyId` groups every rotation in a single login session
 * lineage; reuse detection (per `auth-domain` §Refresh Token Reuse
 * Detection) flips `revoked_at` on every row that shares a family
 * when an already-revoked row is replayed.
 */
@Entity("refresh_tokens")
@Index("idx_refresh_tokens_family_id", ["familyId"])
@Index("idx_refresh_tokens_user_id", ["userId"])
export class RefreshTokenEntity {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({ name: "user_id", type: "uuid" })
	userId!: string;

	@Column({ name: "family_id", type: "uuid" })
	familyId!: string;

	@Column({ name: "hashed_token", type: "varchar", unique: true })
	hashedToken!: string;

	@Column({ name: "expires_at", type: "timestamp" })
	expiresAt!: Date;

	@Column({ name: "revoked_at", type: "timestamp", nullable: true })
	revokedAt!: Date | null;

	@Column({ name: "replaced_by", type: "uuid", nullable: true })
	replacedBy!: string | null;

	@CreateDateColumn({ name: "created_at" })
	createdAt!: Date;
}
