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
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import type { Paginated } from '../../common/pagination/paginated.js';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser } from '../accounts/auth/decorators.js';
import { CreateItineraryDto } from './dto/create-itinerary.dto.js';
import { AddActivityDto } from './dto/add-activity.dto.js';
import { CreateDayDto } from './dto/create-day.dto.js';
import { ReorderDaysDto } from './dto/reorder-days.dto.js';
import {
  ItineraryDayResponseDto,
  ItineraryDetailResponseDto,
  PaginatedItinerariesResponseDto,
} from './dto/itinerary.response.dto.js';
import { UpdateDayDto } from './dto/update-day.dto.js';
import { UpdateItineraryDto } from './dto/update-itinerary.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import { ItineraryPdf } from './itinerary-pdf.js';
import type {
  ItineraryDayView,
  ItineraryDetailView,
  ItinerarySummary,
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

  @Get(':id')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-03 Open one of my itineraries' })
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
  @ApiOperation({ summary: 'ITN-01 Edit my itinerary' })
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

  @Post(':id/days/:dayId/activities')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-10 Add an activity to my itinerary day' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'dayId', type: String })
  @ApiCreatedResponse({ type: ItineraryDayResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid IDs or activity fields' })
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
}
