import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function normalizeCode(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/** Admin-created airline profile fields (FLT-01). */
export class CreateAirlineDto {
  @ApiProperty({ minLength: 1, maxLength: 100, example: 'Cairo Air' })
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;

  @ApiProperty({ minLength: 2, maxLength: 3, example: 'CA' })
  @Transform(({ value }) => normalizeCode(value))
  @IsString()
  @Matches(/^[A-Z0-9]{2,3}$/)
  code!: string;
}
