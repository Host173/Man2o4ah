import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';

/** HTL-08: inclusive calendar dates; pagination counts rooms, not nights. */
export class HotelAvailabilityQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: '2027-03-10',
    description: 'First night, inclusive (YYYY-MM-DD)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({
    example: '2027-03-12',
    description: 'Last night, inclusive (YYYY-MM-DD); may equal from',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}
