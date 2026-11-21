import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CancelledBy } from '../../../common/database/cancellation.schema.js';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type { RefundView } from '../../payments/payments.types.js';
import type {
  HeldRoom,
  HotelReservationCancellationView,
  HotelReservationDetailView,
  HotelReservationPolicyView,
  HotelReservationSummaryView,
} from '../hotel-bookings.types.js';
import { HotelRefundResponseDto } from './hotel-cancellation.response.dto.js';
import { HotelReservationStatus } from '../schemas/hotel-reservation.schema.js';

export class HotelReservationRoomResponseDto implements HeldRoom {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a301' })
  roomId!: string;

  @ApiProperty({ example: '101' })
  roomName!: string;

  @ApiProperty({ example: 'Double' })
  roomType!: string;

  @ApiProperty({ example: 10000, description: 'Minor units, at hold time' })
  pricePerNightMinor!: number;

  @ApiProperty({ example: 2 })
  adults!: number;

  @ApiProperty({ type: [Number], example: [7] })
  childAges!: number[];

  @ApiProperty({ example: 30000, description: 'nights × pricePerNightMinor' })
  subtotalMinor!: number;
}

export class HotelReservationCancellationTierResponseDto {
  @ApiProperty({ example: 3 })
  daysBefore!: number;

  @ApiProperty({ example: 50 })
  refundPercent!: number;
}

export class HotelReservationPolicyResponseDto implements HotelReservationPolicyView {
  @ApiProperty({ type: [HotelReservationCancellationTierResponseDto] })
  cancellationTiers!: HotelReservationCancellationTierResponseDto[];

  @ApiProperty({ example: '14:00' })
  checkInTime!: string;

  @ApiProperty({ example: '12:00' })
  checkOutTime!: string;
}

export class HotelReservationCancellationResponseDto implements HotelReservationCancellationView {
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-12-01T10:00:00.000Z',
  })
  cancelledAt!: Date;

  @ApiProperty({ enum: Object.values(CancelledBy), example: CancelledBy.USER })
  cancelledBy!: CancelledBy;

  @ApiProperty({ example: 50 })
  refundPercent!: number;

  @ApiProperty({ example: 15000, description: 'Minor units' })
  refundAmountMinor!: number;
}

/** One item in the owner's paginated reservation list (HTL-20). */
export class HotelReservationSummaryResponseDto implements HotelReservationSummaryView {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  _id!: string;

  @ApiPropertyOptional({
    example: 'HRAB12CD',
    description: 'Set only once confirmed (HTL-17)',
  })
  reference?: string;

  @ApiProperty({
    enum: Object.values(HotelReservationStatus),
    example: HotelReservationStatus.CONFIRMED,
  })
  status!: HotelReservationStatus;

  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a300' })
  hotelId!: string;

  @ApiProperty({ example: 'Nile View' })
  hotelName!: string;

  @ApiProperty({ example: '2026-12-10', description: 'YYYY-MM-DD' })
  checkInDate!: string;

  @ApiProperty({ example: '2026-12-13', description: 'YYYY-MM-DD' })
  checkOutDate!: string;

  @ApiProperty({ example: 3 })
  nights!: number;

  @ApiProperty({ type: [HotelReservationRoomResponseDto] })
  rooms!: HotelReservationRoomResponseDto[];

  @ApiProperty({ example: 30000, description: 'Minor units' })
  totalMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;
}

/** Paginated list of the owner's hotel reservations (HTL-20). */
export class PaginatedHotelReservationsResponseDto implements Paginated<HotelReservationSummaryResponseDto> {
  @ApiProperty({ type: [HotelReservationSummaryResponseDto] })
  items!: HotelReservationSummaryResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: 1 })
  totalPages!: number;
}

/** Full customer-facing details for a single hotel reservation (HTL-20). */
export class HotelReservationDetailResponseDto
  extends HotelReservationSummaryResponseDto
  implements HotelReservationDetailView
{
  @ApiProperty({ type: HotelReservationPolicyResponseDto })
  policy!: HotelReservationPolicyResponseDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-20T10:10:00.000Z',
  })
  holdExpiresAt!: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-20T10:03:00.000Z',
  })
  confirmedAt?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-11-20T10:10:00.000Z',
  })
  expiredAt?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-12-14T00:00:00.000Z',
  })
  completedAt?: Date;

  @ApiPropertyOptional({ type: HotelReservationCancellationResponseDto })
  cancellation?: HotelReservationCancellationResponseDto;

  @ApiProperty({
    type: HotelRefundResponseDto,
    nullable: true,
    description:
      'PAY-03 refund and its status (pending, refunded, failed); null when no refund was issued',
  })
  refund!: RefundView | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-20T10:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-20T10:03:00.000Z',
  })
  updatedAt!: Date;
}
