import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, Max, Min } from 'class-validator';
import type { UpdateCabinInput } from '../flights.types.js';

export class UpdateFlightCabinDto implements UpdateCabinInput {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(Number.MAX_SAFE_INTEGER)
  priceMinor?: number;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  totalSeats?: number;
}
