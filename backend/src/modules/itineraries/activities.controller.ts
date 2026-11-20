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
import { ActivityResponseDto } from './dto/itinerary.response.dto.js';
import { UpdateActivityDto } from './dto/update-activity.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import type { ActivityView } from './itineraries.types.js';

@ApiTags('itineraries')
@ApiCookieAuth()
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'ITN-10 Edit an activity in my itinerary' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: ActivityResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid activity ID or payload' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({
    description: 'Activity not found or owned by another user',
  })
  update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateActivityDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ActivityView> {
    return this.itineraries.updateActivity(id.toHexString(), dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ITN-10 Delete an activity from my itinerary' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Activity deleted' })
  @ApiBadRequestResponse({ description: 'Invalid activity ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({
    description: 'Activity not found or owned by another user',
  })
  delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.itineraries.deleteActivity(id.toHexString(), user.id);
  }
}
