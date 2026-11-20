import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PHONE } from '../schemas/user.schema.js';

/** Trims strings and leaves anything else for the validators to reject. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * ACC-09: the fields a logged-in account may edit on its own profile. Every
 * field is optional; the ones sent must all pass, or nothing is saved. Email,
 * role and status can't be sent: the global ValidationPipe rejects them.
 * Whether `preferredCurrency` is supported is checked by the service against
 * reference data.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({
    example: 'Aisha Al Rawahi',
    minLength: 1,
    maxLength: 100,
  })
  // Sent → must be a valid name; `null` is not "leave unchanged".
  @ValidateIf((o: UpdateProfileDto) => o.name !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '+968 9123 4567',
    description:
      "Optional '+', then 6-20 digits, spaces, brackets, dots or dashes. `null` removes the phone.",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(PHONE, { message: 'phone must be a valid phone number' })
  phone?: string | null;

  @ApiPropertyOptional({
    example: 'EGP',
    description: 'A supported currency code (GET /api/currencies).',
  })
  @ValidateIf((o: UpdateProfileDto) => o.preferredCurrency !== undefined)
  @IsString()
  preferredCurrency?: string;
}
