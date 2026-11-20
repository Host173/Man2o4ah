import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE,
  PASSWORD_RULE_MESSAGE,
} from '../auth/password-rule.js';

/**
 * A logged-in account changing its password (ACC-08), including the forced
 * change after an admin's temporary password (ACC-07a, ACC-13).
 */
export class ChangePasswordDto {
  /**
   * Only required to be a non-empty string, like at login: the rule isn't
   * applied, so a temporary password, or one stored before the 72-character
   * cap, is still accepted here.
   */
  @ApiProperty({ example: 'travel2026' })
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty({
    example: 'journey2027',
    description:
      '8 to 72 characters, including at least one letter and one digit.',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  newPassword!: string;
}
