import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class HotelReviewResponseDto {
  @ApiProperty({
    description: 'Review ObjectId',
    example: '6553a1f0c2b4e8a9d0f1a2b3',
  })
  _id!: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  rating!: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  text?: string;

  @ApiProperty({ description: 'Whether moderation has hidden this review' })
  isHidden!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class HotelReviewListItemResponseDto extends HotelReviewResponseDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The author name; "Deleted user" when the account is deactivated (ACC-12)',
    example: 'Aisha Rawahi',
  })
  authorName!: string | null;
}

export class PaginatedHotelReviewsResponseDto {
  @ApiProperty({ type: [HotelReviewListItemResponseDto] })
  items!: HotelReviewListItemResponseDto[];

  @ApiProperty({ minimum: 1 })
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 50 })
  limit!: number;

  @ApiProperty({ minimum: 0 })
  total!: number;

  @ApiProperty({ minimum: 0 })
  totalPages!: number;
}
