import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import type { Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { PublicSearchQueryDto } from './dto/public-search-query.dto.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Public } from '../accounts/auth/decorators.js';
import { BudgetSummaryResponseDto } from './dto/budget-summary.response.dto.js';
import { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import { CreateDayDto } from './dto/create-day.dto.js';
import { ItineraryFlightsQueryDto } from './dto/itinerary-flights-query.dto.js';
import { ItineraryHotelsQueryDto } from './dto/itinerary-hotels-query.dto.js';
import { CreateBudgetEntryDto } from './dto/create-budget-entry.dto.js';
import { AddActivityDto } from './dto/add-activity.dto.js';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto.js';
import { ReorderDaysDto } from './dto/reorder-days.dto.js';
import {
  BudgetEntryResponseDto,
  ItineraryDayResponseDto,
  ItineraryDetailResponseDto,
  PaginatedItinerariesResponseDto,
  TransportCostResponseDto,
} from './dto/itinerary.response.dto.js';
import {
  PaginatedPublicItinerarySearchResponseDto,
  PublicItineraryDetailResponseDto,
  type PublicItinerarySearchItemResponseDto,
} from './dto/public-itinerary.response.dto.js';
import { UpdateDayDto } from './dto/update-day.dto.js';
import { UpdateItineraryDto } from './dto/update-itinerary.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import {
  HotelSearchResponseDto,
  PaginatedHotelSearchResponseDto,
} from '../hotels/dto/hotel-search.response.dto.js';
import {
  PaginatedFlightSearchResponseDto,
  RoundTripFlightSearchResponseDto,
} from '../flights/dto/flight-search.response.dto.js';
import { ItineraryPdf } from './itinerary-pdf.js';
import type {
  BudgetEntryView,
  BudgetSummaryView,
  ItineraryDayView,
  ItineraryDetailView,
  ItinerarySummary,
  PublicItineraryDetailView,
  TransportCostView,
} from './itineraries.types.js';

@ApiTags('itineraries')
@ApiCookieAuth()
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itinerariesService: ItinerariesService,
    private readonly itineraryPdf: ItineraryPdf,
  ) {}

  @Post()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-01 Create an itinerary' })
  @ApiCreatedResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  create(
    @Body() dto: CreateItineraryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDetailView> {
    return this.itinerariesService.create(dto, user.id);
  }

  @Get()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary: 'ITN-03 List my itineraries, most recently updated first',
  })
  @ApiOkResponse({ type: PaginatedItinerariesResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid pagination query' })
  listMine(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<ItinerarySummary>> {
    return this.itinerariesService.listMine(user.id, query);
  }

  /**
   * Static path: declare before `/:id` (endpoints.md). ITN-21 extends this with
   * keyword and filters; ITN-20 already publishes the visible public list.
   */
  @Public()
  @Get('public/search')
  @ApiOperation({
    summary: 'ITN-20, ITN-21 Search public itineraries (read-only)',
  })
  @ApiOkResponse({ type: PaginatedPublicItinerarySearchResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid pagination query' })
  async searchPublic(
    @Query() query: PublicSearchQueryDto,
  ): Promise<Paginated<PublicItinerarySearchItemResponseDto>> {
    const result = await this.itinerariesService.searchPublic(query);
    return {
      ...result,
      items: result.items.map(({ id, startDate, ...summary }) => ({
        ...summary,
        _id: id,
        startDate: startDate.toISOString().slice(0, 10),
      })),
    };
  }

  /**
   * Static prefix: declared after `public/search` (so "search" isn't parsed as
   * an ID) and before `:id` (endpoints.md).
   */
  @Public()
  @Get('public/:id')
  @ApiOperation({ summary: 'ITN-21 View a public itinerary read-only' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PublicItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID' })
  @ApiNotFoundResponse({
    description:
      'Itinerary not found, private, hidden or by a deactivated author',
  })
  getPublic(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
  ): Promise<PublicItineraryDetailView> {
    return this.itinerariesService.getPublicById(id.toHexString());
  }

  @Get(':id/budget-summary')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary: 'ITN-14/18 Budget summary in my preferred currency',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: BudgetSummaryResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID or currency' })
  @ApiNotFoundResponse({
    description: 'Itinerary not found or owned by another user',
  })
  getBudgetSummary(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<BudgetSummaryView> {
    return this.itinerariesService.getBudgetSummary(id.toHexString(), user.id);
  }

  @Post(':id/days/:dayId/budgets')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-14 Add a budget entry to a day' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'dayId', type: String })
  @ApiCreatedResponse({ type: BudgetEntryResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid day, category, amount or currency',
  })
  @ApiNotFoundResponse({
    description: 'Itinerary or day not found, or owned by another user',
  })
  addBudgetEntry(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('dayId', ParseObjectIdPipe) dayId: Types.ObjectId,
    @Body() dto: CreateBudgetEntryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<BudgetEntryView> {
    return this.itinerariesService.addBudgetEntry(
      id.toHexString(),
      dayId.toHexString(),
      dto,
      user.id,
    );
  }

  @Get(':id')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary: 'ITN-03 Open one of my itineraries',
    description:
      'Private: only the owner can open it; another user gets 404 (ACC-11). Consecutive days in the same city are grouped with their day count and budget subtotal (ITN-09).',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID' })
  @ApiNotFoundResponse({
    description: 'Itinerary not found or owned by another user',
  })
  getById(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDetailView> {
    return this.itinerariesService.getById(id.toHexString(), user.id);
  }

  @Post(':id/clone')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary: 'ITN-21 Clone a public itinerary into a private copy',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID' })
  @ApiNotFoundResponse({
    description: 'Itinerary not found or not publicly visible',
  })
  clone(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDetailView> {
    return this.itinerariesService.clone(id.toHexString(), user.id);
  }

  @Get(':id/flights')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary:
      'ITN-26 One-way or round-trip flights from an origin to the first day city',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiExtraModels(
    PaginatedFlightSearchResponseDto,
    RoundTripFlightSearchResponseDto,
  )
  @ApiOkResponse({
    description:
      'One-way: a page of flights. Round trip: { outbound, inbound } pages',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(PaginatedFlightSearchResponseDto) },
        { $ref: getSchemaPath(RoundTripFlightSearchResponseDto) },
      ],
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID or query' })
  @ApiNotFoundResponse({ description: 'Itinerary not found' })
  async getFlightsForItinerary(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: ItineraryFlightsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<
    PaginatedFlightSearchResponseDto | RoundTripFlightSearchResponseDto
  > {
    const result = await this.itinerariesService.getFlightsForItinerary(
      id.toHexString(),
      query,
      user.id,
    );
    return 'outbound' in result
      ? RoundTripFlightSearchResponseDto.fromView(result)
      : PaginatedFlightSearchResponseDto.fromView(result);
  }

  @Get(':id/hotels')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary: 'ITN-25 Hotels available for a city group of my itinerary',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PaginatedHotelSearchResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID or query' })
  @ApiNotFoundResponse({
    description: 'Itinerary or city group not found',
  })
  async getHotelsForCityGroup(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: ItineraryHotelsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedHotelSearchResponseDto> {
    const result = await this.itinerariesService.getHotelsForCityGroup(
      id.toHexString(),
      query,
      user.id,
    );
    return {
      ...result,
      items: result.items.map((hotel) =>
        HotelSearchResponseDto.fromResult(hotel),
      ),
    };
  }

  @Get(':id/pdf')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'ITN-28 Export or print my itinerary as PDF' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({
    description: 'Downloadable, printable itinerary PDF',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID' })
  @ApiNotFoundResponse({
    description: 'Itinerary not found or owned by another user',
  })
  async exportPdf(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    return new StreamableFile(
      await this.itineraryPdf.export(id.toHexString(), user.id),
      {
        type: 'application/pdf',
        disposition: `attachment; filename="itinerary-${id.toHexString()}.pdf"`,
      },
    );
  }

  @Patch(':id')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary: 'ITN-01, ITN-20 Edit my itinerary or set its visibility',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID or body' })
  @ApiNotFoundResponse({
    description: 'Itinerary not found or owned by another user',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateItineraryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDetailView> {
    return this.itinerariesService.update(id.toHexString(), dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-01 Delete my itinerary' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Itinerary deleted' })
  @ApiConflictResponse({
    description:
      'CONCURRENT_CHANGE: days changed during image cleanup; retry deletion',
  })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID' })
  @ApiNotFoundResponse({
    description: 'Itinerary not found or owned by another user',
  })
  async remove(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.itinerariesService.delete(id.toHexString(), user.id);
  }

  @Delete(':id/days/:dayId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({
    summary:
      'ITN-07 Delete a day and cascade its activities, budgets and costs',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'dayId', type: String })
  @ApiNoContentResponse({ description: 'Day deleted' })
  @ApiConflictResponse({
    description:
      'CONCURRENT_CHANGE: day changed during image cleanup; retry deletion',
  })
  @ApiBadRequestResponse({ description: 'Invalid itinerary or day ID' })
  @ApiNotFoundResponse({
    description: 'Itinerary or day not found, or owned by another user',
  })
  async deleteDay(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('dayId', ParseObjectIdPipe) dayId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.itinerariesService.deleteDay(
      id.toHexString(),
      dayId.toHexString(),
      user.id,
    );
  }

  @Post(':id/transport-costs')
  @ApiOperation({ summary: 'ITN-16 Add a transport cost to my itinerary' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: TransportCostResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid transport cost or references',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'Owned itinerary or day not found' })
  addTransportCost(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: CreateTransportCostDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TransportCostView> {
    return this.itinerariesService.addTransportCost(
      id.toHexString(),
      dto,
      user.id,
    );
  }

  @Post(':id/days')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-05 Add a day to my itinerary' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: ItineraryDayResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid itinerary ID, city or notes',
  })
  @ApiNotFoundResponse({
    description: 'Itinerary not found or owned by another user',
  })
  addDay(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: CreateDayDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDayView> {
    return this.itinerariesService.addDay(id.toHexString(), dto, user.id);
  }

  /**
   * Declared before `:dayId`, so Express never tries to parse "reorder" as an
   * ObjectId. Returns the full view because the numbers, dates and groups all
   * change with the order (ITN-08).
   */
  @Patch(':id/days/reorder')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-08 Move a day to a new position' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: ItineraryDetailResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid itinerary ID or day order' })
  @ApiNotFoundResponse({
    description: 'Itinerary not found or owned by another user',
  })
  reorderDays(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ReorderDaysDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDetailView> {
    return this.itinerariesService.reorderDays(id.toHexString(), dto, user.id);
  }

  @Patch(':id/days/:dayId')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: "ITN-05 Edit a day's city and notes" })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'dayId', type: String })
  @ApiOkResponse({ type: ItineraryDayResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid itinerary or day ID, city or notes',
  })
  @ApiNotFoundResponse({
    description: 'Itinerary or day not found, or owned by another user',
  })
  updateDay(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('dayId', ParseObjectIdPipe) dayId: Types.ObjectId,
    @Body() dto: UpdateDayDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDayView> {
    return this.itinerariesService.updateDay(
      id.toHexString(),
      dayId.toHexString(),
      dto,
      user.id,
    );
  }

  @Post(':id/days/:dayId/activities')
  @ApiOperation({ summary: 'ITN-10 Add an activity to my itinerary day' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'dayId', type: String })
  @ApiCreatedResponse({ type: ItineraryDayResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid itinerary/day ID or activity payload',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({
    description: 'Itinerary or day not found, or owned by another user',
  })
  addActivity(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('dayId', ParseObjectIdPipe) dayId: Types.ObjectId,
    @Body() dto: AddActivityDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDayView> {
    return this.itinerariesService.addActivity(
      id.toHexString(),
      dayId.toHexString(),
      dto,
      user.id,
    );
  }
}
