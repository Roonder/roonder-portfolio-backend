import {
	Column,
	CreateDateColumn,
	Entity,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from "typeorm";

@Entity("users")
export class UserEntity {
	@PrimaryGeneratedColumn("uuid")
	id!: string;

	@Column({ type: "varchar", unique: true })
	email!: string;

	// `select: false` ensures the bcrypt hash never leaks through default
	// repository selects. Login queries must explicitly opt-in via
	// `userRepo.findOne({ select: ['id', 'email', 'password'] })`.
	@Column({ type: "varchar", select: false })
	password!: string;

	@CreateDateColumn({ name: "created_at" })
	createdAt!: Date;

	@UpdateDateColumn({ name: "updated_at" })
	updatedAt!: Date;
}
