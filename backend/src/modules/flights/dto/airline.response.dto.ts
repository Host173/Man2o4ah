import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  AirlineLogoView,
  AirlineView,
  BaggagePolicyView,
  CancellationTierView,
} from '../flights.types.js';

export class AirlineLogoResponseDto implements Omit<AirlineLogoView, 'id'> {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f601' })
  _id!: string;

  @ApiProperty({ example: '/uploads/airline-logo.png' })
  url!: string;
}

export class AirlineBaggagePolicyResponseDto implements BaggagePolicyView {
  @ApiProperty({ type: Number, nullable: true, example: null })
  extraBagPriceMinor!: number | null;

  @ApiProperty({ example: 0 })
  maxExtraBagsPerPassenger!: number;
}

export class CancellationTierResponseDto implements CancellationTierView {
  @ApiProperty({ type: 'integer', minimum: 0, example: 7 })
  daysBefore!: number;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 100, example: 80 })
  refundPercent!: number;
}

/** Airline profile returned by the flights module (FLT-01). */
export class AirlineResponseDto implements Omit<AirlineView, 'id' | 'logo'> {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f602' })
  _id!: string;

  static fromView(view: AirlineView): AirlineResponseDto {
    const { id, logo, ...airline } = view;

    return {
      ...airline,
      _id: id,
      ...(logo ? { logo: { _id: logo.id, url: logo.url } } : {}),
    };
  }

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

  @ApiProperty({ type: [CancellationTierResponseDto] })
  cancellationTiers!: CancellationTierResponseDto[];
}
