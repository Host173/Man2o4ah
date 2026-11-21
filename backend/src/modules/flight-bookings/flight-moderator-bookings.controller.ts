import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
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
import { FlightModeratorBookingsPageResponseDto } from './dto/flight-moderator-bookings.response.dto.js';
import { FlightModeratorBookingsService } from './flight-moderator-bookings.service.js';

@ApiTags('flight-bookings')
@ApiCookieAuth()
@Roles(Role.AIRLINE_MODERATOR)
@ApiUnauthorizedResponse({ description: 'NOT_AUTHENTICATED' })
@ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE' })
@ApiNotFoundResponse({
  description: 'NOT_FOUND: missing flight or not assigned to this moderator',
})
@Controller('flights')
export class FlightModeratorBookingsController {
  constructor(
    private readonly moderatorBookings: FlightModeratorBookingsService,
  ) {}

  @Get(':id/bookings')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-29 View bookings and remaining seats for a flight',
  })
  @ApiOkResponse({ type: FlightModeratorBookingsPageResponseDto })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED: malformed flight ID, or pagination is invalid',
  })
  list(
    @Param('id', IsObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FlightModeratorBookingsPageResponseDto> {
    return this.moderatorBookings.listForFlight(id, query, user.providerId);
  }

  @Get(':id/passengers/export')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-29 Export a flight passenger list as CSV',
  })
  @ApiOkResponse({
    description: 'CSV passenger list',
    content: {
      'text/csv': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: malformed flight ID',
  })
  async exportPassengers(
    @Param('id', IsObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const csv = await this.moderatorBookings.exportPassengers(
      id,
      user.providerId,
    );
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: 'attachment; filename="flight-passengers.csv"',
    });
  }
}
