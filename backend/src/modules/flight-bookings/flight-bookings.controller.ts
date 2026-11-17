import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { FlightQuoteRequestDto } from './dto/flight-quote.dto.js';
import { FlightQuoteResponseDto } from './dto/flight-quote.response.dto.js';
import type { FlightQuote } from './flight-bookings.types.js';
import { FlightQuoteService } from './flight-quote.service.js';

@ApiTags('flight-bookings')
@ApiCookieAuth()
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly quotes: FlightQuoteService) {}

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
}
