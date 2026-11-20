import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Paginated } from '../../../common/pagination/paginated.js';
import type {
  NotificationEntityView,
  NotificationView,
} from '../notifications.types.js';
import { NotificationType } from '../schemas/notification.schema.js';

/** Swagger response model for what a notification opens (GEN-01). */
export class NotificationEntityDto implements NotificationEntityView {
  @ApiProperty({ example: 'flight_booking' })
  type!: string;

  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f602' })
  id!: string;
}

/** Swagger response model for one notification (GEN-01). */
export class NotificationResponseDto implements NotificationView {
  @ApiProperty({ example: '6736f0b2c5a1b2c3d4e5f601' })
  _id!: string;

  @ApiProperty({
    enum: Object.values(NotificationType),
    example: NotificationType.BOOKING_CONFIRMED,
  })
  type!: NotificationType;

  @ApiProperty({ example: 'Flight booking confirmed' })
  title!: string;

  @ApiProperty({ example: 'Your flight booking FB-1234 is confirmed.' })
  message!: string;

  @ApiPropertyOptional({ type: NotificationEntityDto })
  entity?: NotificationEntityDto;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'null while the notification is unread',
  })
  readAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-15T12:00:00.000Z',
  })
  createdAt!: string;
}

/** Swagger response model for the paginated notification list (GEN-01). */
export class PaginatedNotificationsResponseDto implements Paginated<NotificationResponseDto> {
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 10 })
  limit!: number;

  @ApiProperty({ example: 12 })
  total!: number;

  @ApiProperty({ example: 2 })
  totalPages!: number;
}

/** Swagger response model for the unread count (GEN-01). */
export class UnreadCountResponseDto {
  @ApiProperty({ example: 3 })
  count!: number;
}

/** Swagger response model for mark-all-as-read (GEN-01). */
export class ReadAllResponseDto {
  @ApiProperty({
    example: 3,
    description: 'How many notifications were marked as read',
  })
  updated!: number;
}
