import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { IsObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { HotelAvailabilityQueryDto } from './dto/hotel-availability-query.dto.js';
import {
  ModeratorAvailabilityPageDto,
  ModeratorReservationsPageDto,
} from './dto/hotel-moderator.response.dto.js';
import { HotelModeratorService } from './hotel-moderator.service.js';

@ApiTags('hotel-bookings')
@ApiCookieAuth()
@Roles(Role.HOTEL_MODERATOR)
@ApiUnauthorizedResponse({ description: 'NOT_AUTHENTICATED' })
@ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
@ApiNotFoundResponse({
  description: 'NOT_FOUND: missing hotel or not assigned to this moderator',
})
@ApiBadRequestResponse({ description: 'VALIDATION_FAILED, with field details' })
@Controller('hotels')
export class HotelModeratorController {
  constructor(
    @Inject(HotelModeratorService)
    private readonly moderator: HotelModeratorService,
  ) {}

  @Get(':id/reservations')
  @ApiOperation({ summary: 'HTL-22 View reservations for the assigned hotel' })
  @ApiOkResponse({ type: ModeratorReservationsPageDto })
  listReservations(
    @Param('id', IsObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.moderator.listReservations(id, query, user.providerId);
  }

  @Get(':id/availability')
  @ApiOperation({
    summary: 'HTL-08 View each room status over an inclusive date range',
    description:
      'Pagination counts rooms. Pending holds are booked with a reservation ID but no reference until confirmation. Inactive rooms and dates outside bookable ranges are blocked with a reason.',
  })
  @ApiOkResponse({ type: ModeratorAvailabilityPageDto })
  availability(
    @Param('id', IsObjectIdPipe) id: string,
    @Query() query: HotelAvailabilityQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.moderator.availability(id, query, user.providerId);
  }
}
