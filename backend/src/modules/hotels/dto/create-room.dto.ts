import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ minLength: 1, description: 'Unique within the hotel' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ minLength: 1, maxLength: 50, example: 'Deluxe King' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  type!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  beds!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  maxOccupancy!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    example: 10000,
    description: 'Price per night in USD minor units (cents)',
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  pricePerNightMinor!: number;
}
