import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import type { Paginated } from '../../common/pagination/paginated.js';
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
import {
  HotelReservationDetailResponseDto,
  PaginatedHotelReservationsResponseDto,
} from './dto/hotel-reservation.response.dto.js';
import { ListHotelReservationsQueryDto } from './dto/list-hotel-reservations-query.dto.js';
import type {
  CancelledHotelReservation,
  HotelHold,
  HotelRefundPreview,
  HotelReservationDetailView,
  HotelReservationSummaryView,
} from './hotel-bookings.types.js';
import { HotelCancellationService } from './hotel-cancellation.service.js';
import { HotelCancellationBodyPipe } from './hotel-cancellation-body.pipe.js';
import { HotelHoldService } from './hotel-hold.service.js';
import { HotelReservationsService } from './hotel-reservations.service.js';

@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(
    private readonly holds: HotelHoldService,
    private readonly reservations: HotelReservationsService,
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

  /** HTL-20: owner-scoped paginated reservations grouped as upcoming, past or cancelled. */
  @Get()
  @ApiOperation({
    summary:
      'HTL-20 List my hotel reservations grouped as upcoming, past or cancelled',
    description:
      'Returns the authenticated owner’s hotel reservations filtered by group (defaulting to upcoming), paginated with page and limit (default 10, max 50). Uses saved room/price/policy snapshots and current hotel display metadata.',
  })
  @ApiOkResponse({ type: PaginatedHotelReservationsResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED, with field details',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  listMine(
    @Query() query: ListHotelReservationsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<HotelReservationSummaryView>> {
    return this.reservations.listMine(user.id, query);
  }

  /** HTL-20: full details of one reservation owned by the authenticated user. */
  @Get(':id')
  @ApiOperation({
    summary: 'HTL-20 View full details of one of my hotel reservations',
    description:
      'Returns complete customer-facing details for a single reservation owned by the authenticated user, including room/price/policy snapshots and lifecycle timestamps. Unknown or another user’s reservations return 404.',
  })
  @ApiParam({
    name: 'id',
    type: String,
    description: 'Reservation ObjectId',
    example: '6553a1f0c2b4e8a9d0f1a2b3',
  })
  @ApiOkResponse({ type: HotelReservationDetailResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND' })
  getMineById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelReservationDetailView> {
    return this.reservations.getMineById(id.toHexString(), user.id);
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
