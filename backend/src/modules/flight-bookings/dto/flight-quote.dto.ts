import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PassengerType, TripType } from '../schemas/flight-booking.schema.js';

/** Trims strings and leaves anything else for the validators to reject. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** One flight and cabin of the trip. Outbound first; a round trip has two. */
export class FlightSegmentRequestDto {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a234' })
  @IsMongoId()
  flightId!: string;

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a235' })
  @IsMongoId()
  cabinId!: string;
}

/** One traveller. Age-vs-type and baggage limits are checked by the service. */
export class PassengerRequestDto {
  @ApiProperty({
    enum: Object.values(PassengerType),
    example: PassengerType.ADULT,
  })
  @IsIn(Object.values(PassengerType))
  type!: PassengerType;

  @ApiProperty({ example: 'Aya Amr', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fullName!: string;

  @ApiProperty({ example: '1990-01-01', description: 'YYYY-MM-DD' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must be a date as YYYY-MM-DD',
  })
  dateOfBirth!: string;

  @ApiProperty({
    example: 'A12345678',
    description: 'Passport or ID number',
    minLength: 3,
    maxLength: 30,
  })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  documentNumber!: string;

  @ApiProperty({ example: 1, minimum: 0 })
  @IsInt()
  @Min(0)
  extraBagCount!: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Weight per extra bag in kg; required when extraBagCount > 0',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  extraBagWeightKg?: number;
}

/** The body of the quote (FLT-19, FLT-21); FLT-22's hold will reuse it. */
export class FlightQuoteRequestDto {
  @ApiProperty({ enum: Object.values(TripType), example: TripType.ONE_WAY })
  @IsIn(Object.values(TripType))
  tripType!: TripType;

  @ApiProperty({ type: [FlightSegmentRequestDto], minItems: 1, maxItems: 2 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => FlightSegmentRequestDto)
  segments!: FlightSegmentRequestDto[];

  @ApiProperty({ type: [PassengerRequestDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PassengerRequestDto)
  passengers!: PassengerRequestDto[];
}
