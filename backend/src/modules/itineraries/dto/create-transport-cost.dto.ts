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
import { MAX_AMOUNT_MINOR } from '../../../common/money/money.js';

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

  @ApiProperty({ example: 30000, minimum: 0, maximum: MAX_AMOUNT_MINOR })
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_MINOR)
  amountMinor!: number;

  @ApiProperty({ example: 'EGP' })
  @IsString()
  @IsNotEmpty()
  currency!: string;
}
