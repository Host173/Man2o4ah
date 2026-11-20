import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AirlineLogoView,
  AirlineView,
  BaggagePolicyView,
} from '../flights.types.js';

export class AirlineLogoResponseDto implements AirlineLogoView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f601' })
  id!: string;

  @ApiProperty({ example: '/uploads/airline-logo.png' })
  url!: string;
}

export class AirlineBaggagePolicyResponseDto implements BaggagePolicyView {
  @ApiProperty({ type: Number, nullable: true, example: null })
  extraBagPriceMinor!: number | null;

  @ApiProperty({ example: 0 })
  maxExtraBagsPerPassenger!: number;
}

/** Airline profile returned by the flights module (FLT-01). */
export class AirlineResponseDto implements AirlineView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f602' })
  id!: string;

  @ApiProperty({ example: 'Cairo Air' })
  name!: string;

  @ApiProperty({ example: 'CA' })
  code!: string;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiPropertyOptional({ type: AirlineLogoResponseDto })
  logo?: AirlineLogoResponseDto;

  @ApiProperty({ type: AirlineBaggagePolicyResponseDto })
  baggagePolicy!: BaggagePolicyView;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  cancellationTiers!: AirlineView['cancellationTiers'];
}
