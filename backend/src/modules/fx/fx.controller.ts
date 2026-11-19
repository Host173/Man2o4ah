import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../accounts/auth/decorators.js';
import { ExchangeRatesResponseDto } from './dto/exchange-rates.response.dto.js';
import { FxRatesService } from './fx-rates.service.js';
import type { ExchangeRatesView } from './fx.types.js';

/** Public read of the cached exchange rates (ITN-18). */
@ApiTags('exchange-rates')
@Controller('exchange-rates')
export class FxController {
  constructor(private readonly rates: FxRatesService) {}

  @Public()
  @Get('latest')
  @ApiOperation({
    summary: 'ITN-18 Latest cached exchange rates (per 1 USD) and their date',
  })
  @ApiOkResponse({ type: ExchangeRatesResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'RATES_UNAVAILABLE: no rates fetched yet',
  })
  latest(): Promise<ExchangeRatesView> {
    return this.rates.latest();
  }
}
