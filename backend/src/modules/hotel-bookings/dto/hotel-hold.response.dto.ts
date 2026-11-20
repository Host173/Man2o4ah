import { ApiProperty } from '@nestjs/swagger';
import type { HeldRoom, HotelHold } from '../hotel-bookings.types.js';

/*
 * Swagger descriptions of the hold response. Each class `implements` its
 * service type, so the documentation can't drift from what is returned.
 */

class HeldRoomResponseDto implements HeldRoom {
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

class CancellationTierResponseDto {
  @ApiProperty({ example: 3 })
  daysBefore!: number;

  @ApiProperty({ example: 50 })
  refundPercent!: number;
}

class HotelPolicyResponseDto {
  @ApiProperty({ type: [CancellationTierResponseDto] })
  cancellationTiers!: CancellationTierResponseDto[];

  @ApiProperty({ example: '14:00' })
  checkInTime!: string;

  @ApiProperty({ example: '12:00' })
  checkOutTime!: string;
}

/** A room hold (HTL-16, HTL-18): the saved pending reservation. */
export class HotelHoldResponseDto implements HotelHold {
  @ApiProperty({ example: '6553a1f0c2b4e8a9d0f1a2b3' })
  reservationId!: string;

  @ApiProperty({ enum: ['pending_payment'], example: 'pending_payment' })
  status!: 'pending_payment';

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

  @ApiProperty({ type: [HeldRoomResponseDto] })
  rooms!: HeldRoomResponseDto[];

  @ApiProperty({ example: 30000, description: 'Minor units' })
  totalMinor!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ type: HotelPolicyResponseDto })
  policy!: HotelPolicyResponseDto;

  @ApiProperty({
    description: 'UTC instant; the hold ends 10 minutes after it was created',
  })
  holdExpiresAt!: Date;
}
