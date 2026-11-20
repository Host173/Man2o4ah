import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { AddFlightCabinDto } from './dto/add-flight-cabin.dto.js';
import { CreateFlightDto } from './dto/create-flight.dto.js';
import {
  FlightResponseDto,
  PaginatedFlightsResponseDto,
} from './dto/flight.response.dto.js';
import { FlightsService } from './flights.service.js';

@ApiTags('flights')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Authentication or a live session required',
})
@ApiForbiddenResponse({ description: 'Airline moderator role required' })
@Controller()
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Post('flights')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({ summary: 'FLT-03 Create a flight using airport-local times' })
  @ApiCreatedResponse({ type: FlightResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid flight or local time',
  })
  @ApiConflictResponse({
    description: 'Flight number already exists on this local date',
  })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  async create(
    @Body() input: CreateFlightDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FlightResponseDto> {
    return FlightResponseDto.fromView(
      await this.flights.createFlight(input, this.assignedAirlineId(user)),
    );
  }

  @Post('flights/:id/cabins')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({ summary: 'FLT-04 Add a cabin to an assigned flight' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: FlightResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid flight ID or cabin fields' })
  @ApiConflictResponse({
    description: 'Cabin class already exists or flight is not scheduled',
  })
  @ApiNotFoundResponse({
    description: 'Flight not found or not assigned to this moderator',
  })
  async addCabin(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() input: AddFlightCabinDto,
    @CurrentUser() user: AuthUser,
  ): Promise<FlightResponseDto> {
    return FlightResponseDto.fromView(
      await this.flights.addCabin(id.toHexString(), input, user.providerId),
    );
  }

  @Get('airlines/:id/flights')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({ summary: 'FLT-03 List flights for the assigned airline' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PaginatedFlightsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline ID or pagination' })
  @ApiNotFoundResponse({
    description: 'Airline not found or not assigned to this moderator',
  })
  async listAirlineFlights(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedFlightsResponseDto> {
    const airlineId = id.toHexString();
    const result = await this.flights.listAirlineFlights(
      airlineId,
      user.providerId,
      query,
    );
    return {
      ...result,
      items: result.items.map((flight) => FlightResponseDto.fromView(flight)),
    };
  }

  private assignedAirlineId(user: AuthUser): string {
    if (!user.providerId) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'Airline not found',
      });
    }
    return user.providerId;
  }
}
