import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser } from '../accounts/auth/decorators.js';
import { ItineraryDayResponseDto } from './dto/itinerary.response.dto.js';
import { UpdateActivityDto } from './dto/update-activity.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import type { ItineraryDayView } from './itineraries.types.js';

/**
 * ITN-10: an activity is addressed by its own ID, so its edit/delete routes
 * live at `/api/activities/:id` (endpoints.md) even though the module that
 * owns them is `itineraries`.
 */
@ApiTags('itineraries')
@ApiCookieAuth()
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

  @Patch(':id')
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-10 Edit an activity of my itinerary day' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: ItineraryDayResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid ID or activity fields' })
  @ApiNotFoundResponse({
    description: 'Activity not found, or owned by another user',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateActivityDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDayView> {
    return this.itinerariesService.updateActivity(
      id.toHexString(),
      dto,
      user.id,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-10 Delete an activity of my itinerary day' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Activity deleted' })
  @ApiBadRequestResponse({ description: 'Invalid activity ID' })
  @ApiNotFoundResponse({
    description: 'Activity not found, or owned by another user',
  })
  async remove(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.itinerariesService.deleteActivity(id.toHexString(), user.id);
  }
}
