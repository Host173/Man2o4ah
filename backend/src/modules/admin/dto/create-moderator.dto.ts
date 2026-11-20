import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { ModeratorRole } from '../../accounts/accounts.types.js';
import {
  PASSWORD_RULE,
  PASSWORD_RULE_MESSAGE,
} from '../../accounts/auth/password-rule.js';
import { UserRole } from '../../accounts/schemas/user.schema.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimAndLowercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const MODERATOR_ROLES: readonly ModeratorRole[] = [
  UserRole.AIRLINE_MODERATOR,
  UserRole.HOTEL_MODERATOR,
] as const;

/** Request body for `POST /api/admin/moderators` (`ACC-13`). */
export class CreateModeratorDto {
  @ApiProperty({
    example: 'Nile Hotel Moderator',
    minLength: 1,
    maxLength: 100,
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'mod@nile.example' })
  @Transform(trimAndLowercase)
  @IsEmail()
  email!: string;

  @ApiProperty({
    enum: MODERATOR_ROLES,
    example: UserRole.HOTEL_MODERATOR,
    description: 'Moderator role (airline_moderator or hotel_moderator)',
  })
  @IsIn(MODERATOR_ROLES)
  role!: ModeratorRole;

  @ApiProperty({
    example: '6736f0b2c5a1b2c3d4e5f601',
    description: 'ID of the assigned airline or hotel matching role',
  })
  @Transform(trim)
  @IsMongoId()
  providerId!: string;

  @ApiProperty({
    example: 'Temp1234',
    minLength: 8,
    description:
      'Temporary password (at least 8 characters with at least one letter and one digit); must be changed on first login',
  })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  temporaryPassword!: string;
}
