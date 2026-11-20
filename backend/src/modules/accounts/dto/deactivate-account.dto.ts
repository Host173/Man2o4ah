import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

/**
 * The explicit confirmation for self-deactivation (ACC-12, GEN-03): the
 * request must say `confirm: true`, so a bare `DELETE /api/users/me` sent by
 * mistake can't deactivate the account.
 */
export class DeactivateAccountDto {
  @ApiProperty({
    enum: [true],
    description:
      'Must be true: the user confirmed they want to deactivate their account.',
  })
  @Equals(true, { message: 'confirm must be true' })
  confirm!: boolean;
}
