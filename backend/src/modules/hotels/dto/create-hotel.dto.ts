import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Profile fields only (HTL-01). Country is derived from cityId by the service. */
export class CreateHotelDto {
  @ApiProperty({ minLength: 1, maxLength: 150 })
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @ApiProperty({ minLength: 1, maxLength: 300 })
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  address!: string;

  @ApiProperty({ description: 'Exact city ID from the reference dataset' })
  @IsString()
  @MinLength(1)
  cityId!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, type: 'integer' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(5)
  starRating?: number;

  @ApiPropertyOptional({
    type: [String],
    description: 'Unique amenities, each 1-50 characters',
  })
  @Transform(({ value }) => (Array.isArray(value) ? value.map(trim) : value))
  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(50, { each: true })
  amenities?: string[];
}
