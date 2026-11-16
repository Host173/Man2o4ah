import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_RULE, PASSWORD_RULE_MESSAGE } from '../auth/password-rule.js';

/** Trims strings and leaves anything else for the validators to reject. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimAndLowercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * A guest's registration (ACC-01). The role, status and consent time are set
 * by the server, so the global ValidationPipe rejects them if a client sends
 * them (GEN-13).
 */
export class RegisterDto {
  @ApiProperty({ example: 'Aisha Al Rawahi', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /** Stored trimmed and lowercased, so emails differing only in case are one account. */
  @ApiProperty({ example: 'aisha@example.com' })
  @Transform(trimAndLowercase)
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'travel2026',
    description:
      'At least 8 characters, including at least one letter and one digit.',
    minLength: 8,
  })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  password!: string;

  @ApiProperty({
    enum: [true],
    description: 'The terms-and-privacy consent checkbox; must be true.',
  })
  @Equals(true, { message: 'acceptTerms must be true' })
  acceptTerms!: boolean;
}
