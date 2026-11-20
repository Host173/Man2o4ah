import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { HotelHoldRequestDto } from './dto/hotel-hold.dto.js';
import { HotelHoldResponseDto } from './dto/hotel-hold.response.dto.js';
import {
  CancelHotelReservationDto,
  HotelReservationIdDto,
} from './dto/hotel-cancellation.dto.js';
import {
  CancelledHotelReservationResponseDto,
  HotelRefundPreviewResponseDto,
} from './dto/hotel-cancellation.response.dto.js';
import type {
  CancelledHotelReservation,
  HotelHold,
  HotelRefundPreview,
} from './hotel-bookings.types.js';
import { HotelCancellationService } from './hotel-cancellation.service.js';
import { HotelCancellationBodyPipe } from './hotel-cancellation-body.pipe.js';
import { HotelHoldService } from './hotel-hold.service.js';

@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(
    private readonly holds: HotelHoldService,
    private readonly cancellations: HotelCancellationService,
  ) {}

  /** The owner is the logged-in user; a client can't book for someone else. */
  @Post()
  // Users only (endpoints.md): admins and moderators never hold bookings.
  @Roles(Role.USER)
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
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiConflictResponse({ description: 'ROOMS_UNAVAILABLE' })
  hold(
    @Body() body: HotelHoldRequestDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelHold> {
    return this.holds.hold(body, user.id);
  }

  @Get(':id/refund-preview')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'HTL-21 Preview the refund on the full reservation total',
    description:
      'Uses the policy snapshot and full days until midnight UTC on check-in. Only the owner of a confirmed reservation before check-in may preview.',
  })
  @ApiOkResponse({ type: HotelRefundPreviewResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: invalid reservation ID',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: absent or not owned' })
  @ApiConflictResponse({
    description:
      'INVALID_STATUS_TRANSITION: not confirmed or check-in has begun',
  })
  refundPreview(
    @Param() params: HotelReservationIdDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelRefundPreview> {
    return this.cancellations.refundPreview(params.id, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'HTL-21 Cancel a confirmed reservation as a whole before check-in',
    description:
      'After viewing the refund preview, confirm with an empty body. The refund is recalculated; all nights are released with cancellation in one transaction. Positive refunds go to PAY-03 after commit. Partial cancellation is unsupported.',
  })
  @ApiOkResponse({ type: CancelledHotelReservationResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: invalid ID or nonempty body',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: absent or not owned' })
  @ApiConflictResponse({
    description:
      'INVALID_STATUS_TRANSITION: not confirmed or check-in has begun',
  })
  cancel(
    @Param() params: HotelReservationIdDto,
    @Body(HotelCancellationBodyPipe) _body: CancelHotelReservationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CancelledHotelReservation> {
    return this.cancellations.cancel(params.id, user.id);
  }
}
