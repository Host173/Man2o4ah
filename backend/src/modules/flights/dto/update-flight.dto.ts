import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import type { UpdateFlightInput } from '../flights.types.js';

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export class UpdateFlightDto implements UpdateFlightInput {
  @ApiPropertyOptional({ example: 'CAI', minLength: 3, maxLength: 3 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  departureAirportId?: string;

  @ApiPropertyOptional({ example: 'DXB', minLength: 3, maxLength: 3 })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  arrivalAirportId?: string;

  @ApiPropertyOptional({ example: '2027-03-14T03:30' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_DATE_TIME)
  departureLocal?: string;

  @ApiPropertyOptional({ example: '2027-03-14T10:00' })
  @IsOptional()
  @IsString()
  @Matches(LOCAL_DATE_TIME)
  arrivalLocal?: string;
}
