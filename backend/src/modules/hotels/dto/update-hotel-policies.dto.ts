import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDefined,
  IsInt,
  IsObject,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { HH_MM } from '../../../common/database/validators.js';
import type { HotelView } from '../hotels.types.js';

class HotelCancellationTierDto {
  @ApiProperty({ type: 'integer', minimum: 0, example: 7 })
  @IsInt()
  @Min(0)
  daysBefore!: number;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 100, example: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  refundPercent!: number;
}

class HotelCancellationPolicyDto {
  @ApiProperty({
    type: [HotelCancellationTierDto],
    description:
      'Unique daysBefore thresholds. Refunds use the highest threshold not exceeding days remaining before check-in; no matching tier means 0%. An empty array is allowed.',
  })
  @IsArray()
  @ArrayUnique(
    (tier: HotelCancellationTierDto | null | undefined) => tier?.daysBefore,
    { message: 'tiers must not contain duplicate daysBefore values' },
  )
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => HotelCancellationTierDto)
  tiers!: HotelCancellationTierDto[];
}

export class UpdateHotelPoliciesDto implements Pick<
  HotelView,
  'checkInTime' | 'checkOutTime' | 'cancellationPolicy'
> {
  @ApiProperty({
    example: '14:00',
    pattern: HH_MM.source,
    minLength: 5,
    maxLength: 5,
  })
  @IsString()
  @Length(5, 5)
  @Matches(HH_MM)
  checkInTime!: string;

  @ApiProperty({
    example: '12:00',
    pattern: HH_MM.source,
    minLength: 5,
    maxLength: 5,
  })
  @IsString()
  @Length(5, 5)
  @Matches(HH_MM)
  checkOutTime!: string;

  @ApiProperty({ type: HotelCancellationPolicyDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => HotelCancellationPolicyDto)
  cancellationPolicy!: HotelCancellationPolicyDto;
}
