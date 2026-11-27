import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { IsObjectIdPipe } from '@nestjs/mongoose';
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
import { FlightHoldResponseDto } from './dto/flight-hold.response.dto.js';
import {
  MyFlightBookingResponseDto,
  PaginatedMyFlightBookingsResponseDto,
} from './dto/my-flight-booking.response.dto.js';
import { MyFlightBookingsQueryDto } from './dto/my-flight-bookings-query.dto.js';
import { CancelFlightBookingDto } from './dto/flight-cancellation.dto.js';
import {
  CancelledFlightBookingResponseDto,
  FlightRefundPreviewResponseDto,
} from './dto/flight-cancellation.response.dto.js';
import {
  FlightChangePreviewResponseDto,
  FlightChangeQueryDto,
} from './dto/flight-change.dto.js';
import { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightQuoteResponseDto } from './dto/flight-quote.response.dto.js';
import type { Paginated } from '../../common/pagination/paginated.js';
import type {
  CancelledFlightBooking,
  FlightChangePreview,
  FlightHold,
  FlightQuote,
  FlightRefundPreview,
  MyFlightBooking,
  MyFlightBookingSummary,
} from './flight-bookings.types.js';
import { FlightCancellationBodyPipe } from './flight-cancellation-body.pipe.js';
import { FlightCancellationService } from './flight-cancellation.service.js';
import { FlightChangeService } from './flight-change.service.js';
import { FlightETicket } from './flight-e-ticket.js';
import { FlightHoldService } from './flight-hold.service.js';
import { FlightQuoteService } from './flight-quote.service.js';
import { MyFlightBookingsService } from './my-flight-bookings.service.js';

@ApiTags('flight-bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly quotes: FlightQuoteService,
    private readonly holds: FlightHoldService,
    private readonly eTickets: FlightETicket,
    private readonly mine: MyFlightBookingsService,
    private readonly cancellations: FlightCancellationService,
    private readonly changes: FlightChangeService,
  ) {}

  /** A quote saves nothing, so it answers 200, not 201. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'FLT-19 Price a flight booking and show its summary (FLT-21)',
    description:
      'Validates the passengers and baggage against the selected flights and returns the summary. Nothing is saved; POST /flight-bookings/hold reserves the seats. All prices are in the single platform currency, USD (PAY-04).',
  })
  @ApiOkResponse({ type: FlightQuoteResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED, with field details',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiConflictResponse({ description: 'SEATS_UNAVAILABLE' })
  quote(@Body() body: FlightQuoteRequestDto): Promise<FlightQuote> {
    return this.quotes.quote(body);
  }

  /** The owner is the logged-in user; a client can't book for someone else. */
  @Post('hold')
  // Users only (endpoints.md): admins and moderators never hold bookings.
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'FLT-22 Hold the seats for 10 minutes as a pending booking',
    description:
      'Same body and checks as POST /flight-bookings. Holds the seats of every segment and saves a pending_payment booking in one transaction. Unpaid holds expire after 10 minutes and their seats are released.',
  })
  @ApiCreatedResponse({ type: FlightHoldResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED, with field details',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiConflictResponse({ description: 'SEATS_UNAVAILABLE' })
  hold(
    @Body() body: FlightQuoteRequestDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FlightHold> {
    return this.holds.hold(body, user.id);
  }

  /** The logged-in user's own bookings, one group per request (FLT-25). */
  @Get()
  @ApiOperation({
    summary: 'FLT-25 List my flight bookings: upcoming, past or cancelled',
    description:
      'upcoming: confirmed, first flight not departed yet (soonest first). past: completed, or confirmed whose first flight has departed (most recent first). cancelled: cancelled (most recent first). Pending and expired bookings are in no group.',
  })
  @ApiOkResponse({ type: PaginatedMyFlightBookingsResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: group, page or limit is invalid',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  listMine(
    @Query() query: MyFlightBookingsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<MyFlightBookingSummary>> {
    return this.mine.listMine(user.id, query.group, query);
  }

  /** Only the owner's own booking, in any status; anyone else's answers 404 (ACC-11). */
  @Get(':id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-25 Show the full details of my flight booking',
    description:
      'Only the owner can see a booking, in any status; anyone else gets 404 (ACC-11). The status shows the booking lifecycle: pending_payment, confirmed, cancelled, expired or completed (GEN-11).',
  })
  @ApiOkResponse({ type: MyFlightBookingResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: malformed booking ID',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: no such booking, or another user’s',
  })
  getMine(
    @Param('id', IsObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<MyFlightBooking> {
    return this.mine.getMine(id, user.id);
  }

  /** Only the owner's own confirmed booking; anyone else's answers 404 (ACC-11). */
  @Get(':id/e-ticket')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-23 Download the e-ticket (PDF) of my confirmed booking',
    description:
      'Reference, passengers and every flight with its local departure and arrival times (GEN-06).',
  })
  @ApiOkResponse({
    description: 'The e-ticket as a downloadable PDF',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: malformed booking ID',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: no such booking, or another user’s',
  })
  @ApiConflictResponse({
    description: 'CONFLICT: the booking is not confirmed',
  })
  async eTicket(
    @Param('id', IsObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const ticket = await this.eTickets.render(id, user.id);
    return new StreamableFile(ticket.pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${ticket.filename}"`,
    });
  }

  /** The owner's confirmed booking before the outbound flight departs; anyone else's answers 404 (ACC-11). */
  @Get(':id/refund-preview')
  @Roles(Role.USER)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-26 Preview the refund for cancelling my flight booking',
    description:
      'Uses the booking’s snapshot of the airline’s cancellation tiers and the full days until the outbound departure. Nothing is changed.',
  })
  @ApiOkResponse({ type: FlightRefundPreviewResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: malformed booking ID',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: no such booking, or another user’s',
  })
  @ApiConflictResponse({
    description:
      'INVALID_STATUS_TRANSITION: not confirmed, or the first flight has departed',
  })
  refundPreview(
    @Param('id', IsObjectIdPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<FlightRefundPreview> {
    return this.cancellations.refundPreview(id, user.id);
  }

  /** The owner's confirmed booking; anyone else's answers 404 (ACC-11). */
  @Get(':id/change-preview')
  @Roles(Role.USER)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'FLT-27 Preview changing one flight of my booking',
    description:
      'Prices the booking with the new flight (same route, same cabin class) against what was paid. A positive difference is paid by card, a negative one refunded in full. Nothing is changed.',
  })
  @ApiOkResponse({ type: FlightChangePreviewResponseDto })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED: malformed ID or query, no such direction, or a new flight that is unknown, the same, on another route, without the cabin class, not bookable, or out of order with the other flight',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: no such booking, or another user’s',
  })
  @ApiConflictResponse({
    description:
      'INVALID_STATUS_TRANSITION: not confirmed, a change already waits for payment, or that flight has departed. SEATS_UNAVAILABLE: not enough seats on the new flight',
  })
  changePreview(
    @Param('id', IsObjectIdPipe) id: string,
    @Query() query: FlightChangeQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FlightChangePreview> {
    return this.changes.preview(id, user.id, query);
  }

  /** Cancels the whole booking; the body is an empty object that confirms it. */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'FLT-26 Cancel my confirmed flight booking before departure',
    description:
      'After viewing the refund preview, confirm with an empty body. The refund is recalculated at this moment. The status change and the seats returning to inventory happen in one transaction; a positive refund is then requested (PAY-03) and the user is notified.',
  })
  @ApiOkResponse({ type: CancelledFlightBookingResponseDto })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED: malformed booking ID, or the body is not an empty object',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: no such booking, or another user’s',
  })
  @ApiConflictResponse({
    description:
      'INVALID_STATUS_TRANSITION: not confirmed, or the first flight has departed',
  })
  cancel(
    @Param('id', IsObjectIdPipe) id: string,
    @Body(FlightCancellationBodyPipe) _body: CancelFlightBookingDto,
    @CurrentUser() user: AuthUser,
  ): Promise<CancelledFlightBooking> {
    return this.cancellations.cancel(id, user.id);
  }
}
