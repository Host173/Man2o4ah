import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TransportMode } from '../schemas/itinerary.schema.js';

/** ITN-16: a transport cost linked to a day of the same itinerary. */
export class CreateTransportCostDto {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f604' })
  @IsMongoId()
  dayId!: string;

  @ApiProperty({
    enum: Object.values(TransportMode),
    example: TransportMode.TRAIN,
  })
  @IsEnum(TransportMode)
  mode!: TransportMode;

  @ApiProperty({ example: 'cairo' })
  @IsString()
  @IsNotEmpty()
  fromCityId!: string;

  @ApiProperty({ example: 'dubai' })
  @IsString()
  @IsNotEmpty()
  toCityId!: string;

  @ApiProperty({ example: 30000, minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  @IsString()
  @IsNotEmpty()
  currency!: string;
}
