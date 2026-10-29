import { IsEmail, IsEnum, MaxLength } from 'class-validator';

export enum OrganizationMemberRole {
    ADMIN = 'ADMIN',
    MEMBER = 'MEMBER',
}

export class AddMemberDto {
    @IsEmail()
    @MaxLength(254)
    email!: string;

    @IsEnum(OrganizationMemberRole)
    role!: OrganizationMemberRole;
}
