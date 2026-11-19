import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { Public } from '../accounts/auth/decorators.js';
import {
  ListAirportsQueryDto,
  ListAttractionsQueryDto,
  ListCitiesQueryDto,
  SearchReferenceQueryDto,
} from './dto/reference-data-query.dto.js';
import {
  PaginatedAirportsResponseDto,
  PaginatedAttractionsResponseDto,
  PaginatedCitiesResponseDto,
  PaginatedCountriesResponseDto,
  PaginatedCurrenciesResponseDto,
} from './dto/reference-data.response.dto.js';
import { ReferenceDataListsService } from './reference-data-lists.service.js';

/** Public, read-only reference data (GEN-12, FLT-02), paginated (GEN-05). */
@ApiTags('reference-data')
@ApiBadRequestResponse({ description: 'Invalid query parameters' })
@Public()
@Controller()
export class ReferenceDataController {
  constructor(private readonly lists: ReferenceDataListsService) {}

  @Get('countries')
  @ApiOperation({ summary: 'GEN-12 Countries, by name' })
  @ApiOkResponse({ type: PaginatedCountriesResponseDto })
  countries(@Query() query: SearchReferenceQueryDto) {
    return this.lists.listCountries(query);
  }

  @Get('cities')
  @ApiOperation({
    summary: 'GEN-12 Cities, by name, optionally of one country',
  })
  @ApiOkResponse({ type: PaginatedCitiesResponseDto })
  cities(@Query() query: ListCitiesQueryDto) {
    return this.lists.listCities(query);
  }

  @Get('airports')
  @ApiOperation({
    summary: 'FLT-02 Airports, by IATA code; q matches the code or the name',
  })
  @ApiOkResponse({ type: PaginatedAirportsResponseDto })
  airports(@Query() query: ListAirportsQueryDto) {
    return this.lists.listAirports(query);
  }

  @Get('currencies')
  @ApiOperation({ summary: 'GEN-12 Supported currencies, by code' })
  @ApiOkResponse({ type: PaginatedCurrenciesResponseDto })
  currencies(@Query() query: PaginationQueryDto) {
    return this.lists.listCurrencies(query);
  }

  @Get('attractions')
  @ApiOperation({
    summary: 'GEN-12 Attractions, by name, optionally of one city',
  })
  @ApiOkResponse({ type: PaginatedAttractionsResponseDto })
  attractions(@Query() query: ListAttractionsQueryDto) {
    return this.lists.listAttractions(query);
  }
}
