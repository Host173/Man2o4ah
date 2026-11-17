import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { HotelView } from '../hotels.types.js';

class HotelPhotoResponseDto {
  @ApiProperty()
  _id!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty({ example: '/uploads/hotel.jpg' })
  url!: string;
}

class HotelCancellationTierResponseDto {
  @ApiProperty({ minimum: 0 })
  daysBefore!: number;

  @ApiProperty({ minimum: 0, maximum: 100 })
  refundPercent!: number;
}

class HotelCancellationPolicyResponseDto {
  @ApiProperty({ type: [HotelCancellationTierResponseDto] })
  tiers!: HotelCancellationTierResponseDto[];
}

class HotelRatingSummaryResponseDto {
  @ApiProperty({ type: Number, nullable: true })
  average!: number | null;

  @ApiProperty({ minimum: 0 })
  count!: number;
}

export class HotelProfileResponseDto implements Omit<
  HotelView,
  'id' | 'photos'
> {
  @ApiProperty()
  _id!: string;

  @ApiProperty({ minLength: 1, maxLength: 150 })
  name!: string;

  @ApiProperty({ minLength: 1, maxLength: 300 })
  address!: string;

  @ApiProperty({ example: 'cairo' })
  cityId!: string;

  @ApiProperty({ example: 'EG', description: 'Derived from the selected city' })
  countryCode!: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  description?: string;

  @ApiProperty({ type: [HotelPhotoResponseDto], maxItems: 5 })
  photos!: HotelPhotoResponseDto[];

  @ApiPropertyOptional({ minimum: 1, maximum: 5, type: 'integer' })
  starRating?: number;

  @ApiProperty({ type: [String] })
  amenities!: string[];

  @ApiProperty({ example: '14:00' })
  checkInTime!: string;

  @ApiProperty({ example: '12:00' })
  checkOutTime!: string;

  @ApiProperty({ type: HotelCancellationPolicyResponseDto })
  cancellationPolicy!: HotelCancellationPolicyResponseDto;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ type: HotelRatingSummaryResponseDto })
  ratingSummary!: HotelRatingSummaryResponseDto;

  static fromView(hotel: HotelView): HotelProfileResponseDto {
    const { id, photos, ...profile } = hotel;
    return {
      _id: id,
      ...profile,
      photos: photos.map(({ id: photoId, ...photo }) => ({
        _id: photoId,
        ...photo,
        url: `/uploads/${photo.key}`,
      })),
    };
  }
}
