import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  Matches,
  Validate,
  ValidatorConstraint,
} from 'class-validator';
import type { ValidatorConstraintInterface } from 'class-validator';
import { BookingType } from '../../../common/database/booking-type.js';
import { YYYY_MM_DD } from '../../../common/database/validators.js';
import { toDateOnly } from '../../../common/dates/date-only.js';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto.js';
import {
  ADMIN_BOOKING_STATUSES,
  type AdminBookingStatus,
} from '../admin.types.js';

@ValidatorConstraint({ name: 'isValidDateOnlyString', async: false })
class IsValidDateOnlyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      toDateOnly(value);
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return '$property must be a valid calendar date in YYYY-MM-DD format';
  }
}

/** Query parameters for the read-only admin booking list (`ACC-17`, `CTR-04`). */
export class ListAdminBookingsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: Object.values(BookingType),
    description: 'Filter by booking type (flight or hotel)',
    example: BookingType.FLIGHT,
  })
  @IsOptional()
  @IsIn(Object.values(BookingType))
  type?: BookingType;

  @ApiPropertyOptional({
    enum: ADMIN_BOOKING_STATUSES,
    description: 'Filter by booking status',
    example: 'confirmed',
  })
  @IsOptional()
  @IsIn(ADMIN_BOOKING_STATUSES)
  status?: AdminBookingStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description:
      'Inclusive start date (YYYY-MM-DD, UTC) filtering booking createdAt',
    example: '2026-11-01',
  })
  @IsOptional()
  @Matches(YYYY_MM_DD, {
    message: 'from must be a valid date in YYYY-MM-DD format',
  })
  @Validate(IsValidDateOnlyConstraint)
  from?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date',
    description:
      'Inclusive end date (YYYY-MM-DD, UTC) filtering booking createdAt',
    example: '2026-11-30',
  })
  @IsOptional()
  @Matches(YYYY_MM_DD, {
    message: 'to must be a valid date in YYYY-MM-DD format',
  })
  @Validate(IsValidDateOnlyConstraint)
  to?: string;
}
