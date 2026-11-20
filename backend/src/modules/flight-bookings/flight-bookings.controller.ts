import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
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
import { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightQuoteResponseDto } from './dto/flight-quote.response.dto.js';
import type { FlightHold, FlightQuote } from './flight-bookings.types.js';
import { FlightETicket } from './flight-e-ticket.js';
import { FlightHoldService } from './flight-hold.service.js';
import { FlightQuoteService } from './flight-quote.service.js';

@ApiTags('flight-bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly quotes: FlightQuoteService,
    private readonly holds: FlightHoldService,
    private readonly eTickets: FlightETicket,
  ) {}

  /** A quote saves nothing, so it answers 200, not 201. */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'FLT-19 Price a flight booking and show its summary (FLT-21)',
    description:
      'Validates the passengers and baggage against the selected flights and returns the summary. Nothing is saved; POST /flight-bookings/hold reserves the seats.',
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
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({
    description: 'NOT_FOUND: no such booking, or another user’s',
  })
  @ApiConflictResponse({
    description: 'CONFLICT: the booking is not confirmed',
  })
  async eTicket(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const ticket = await this.eTickets.render(id, user.id);
    return new StreamableFile(ticket.pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${ticket.filename}"`,
    });
  }
}
