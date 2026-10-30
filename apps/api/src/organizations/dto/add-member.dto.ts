import { IsEmail, IsEnum, MaxLength } from 'class-validator';
import { Trim } from '../../common/validation/trim.decorator.js';

export enum OrganizationMemberRole {
    ADMIN = 'ADMIN',
    MEMBER = 'MEMBER',
}

export class AddMemberDto {
    @Trim()
    @IsEmail()
    @MaxLength(254)
    email!: string;

    @IsEnum(OrganizationMemberRole)
    role!: OrganizationMemberRole;
}
