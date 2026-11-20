import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import {
  PASSWORD_RULE,
  PASSWORD_RULE_MESSAGE,
} from '../../accounts/auth/password-rule.js';

/** Request body for `POST /api/admin/users/:id/reset-password` (`ACC-07a`). */
export class ResetUserPasswordDto {
  @ApiProperty({
    example: 'Temp1234',
    minLength: 8,
    description:
      'Temporary password (at least 8 characters with at least one letter and one digit); forces password change at next login and revokes sessions',
  })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  temporaryPassword!: string;
}
