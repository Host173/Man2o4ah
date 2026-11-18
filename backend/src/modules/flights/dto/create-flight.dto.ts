import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MinLength } from 'class-validator';
import type { CreateFlightInput } from '../flights.types.js';

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export class CreateFlightDto implements CreateFlightInput {
  @ApiProperty({ example: 'MS 123', minLength: 1 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(1)
  @Matches(/\S/, { message: 'flightNumber must not be blank' })
  flightNumber!: string;

  @ApiProperty({ example: 'CAI', minLength: 3, maxLength: 3 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  departureAirportId!: string;

  @ApiProperty({ example: 'DXB', minLength: 3, maxLength: 3 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  arrivalAirportId!: string;

  @ApiProperty({
    description:
      'Local departure time at the departure airport, without an offset',
    example: '2027-03-14T03:30',
  })
  @IsString()
  @Matches(LOCAL_DATE_TIME)
  departureLocal!: string;

  @ApiProperty({
    description: 'Local arrival time at the arrival airport, without an offset',
    example: '2027-03-14T10:00',
  })
  @IsString()
  @Matches(LOCAL_DATE_TIME)
  arrivalLocal!: string;
}
