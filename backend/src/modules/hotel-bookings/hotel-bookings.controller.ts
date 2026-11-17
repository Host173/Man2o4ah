import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser } from '../accounts/auth/decorators.js';
import { HotelHoldRequestDto } from './dto/hotel-hold.dto.js';
import { HotelHoldResponseDto } from './dto/hotel-hold.response.dto.js';
import type { HotelHold } from './hotel-bookings.types.js';
import { HotelHoldService } from './hotel-hold.service.js';

@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly holds: HotelHoldService) {}

  /** The owner is the logged-in user; a client can't book for someone else. */
  @Post()
  @ApiOperation({
    summary:
      'HTL-16 Hold one or more rooms for 10 minutes as a pending reservation (HTL-18)',
    description:
      'Checks the dates, rooms and guests, prices the stay and, in one transaction, saves a pending_payment reservation and reserves every night of every room. All rooms are held or none. Unpaid holds expire after 10 minutes and their nights are released.',
  })
  @ApiCreatedResponse({ type: HotelHoldResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED, with field details',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiConflictResponse({ description: 'ROOMS_UNAVAILABLE' })
  hold(
    @Body() body: HotelHoldRequestDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelHold> {
    return this.holds.hold(body, user.id);
  }
}
