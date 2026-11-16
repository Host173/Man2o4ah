import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

const trimAndLowercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Login credentials (ACC-04). The password is only required to be a non-empty
 * string: the ACC-01 rule isn't applied here, so temporary passwords set by an
 * admin still work and a failed rule can't hint at anything.
 */
export class LoginDto {
  /** Lowercased like at registration, so the case the user types doesn't matter. */
  @ApiProperty({ example: 'aisha@example.com' })
  @Transform(trimAndLowercase)
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'travel2026' })
  @IsString()
  @MinLength(1)
  password!: string;
}
