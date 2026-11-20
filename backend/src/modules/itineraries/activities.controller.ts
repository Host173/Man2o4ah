import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
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
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser } from '../accounts/auth/decorators.js';
import { ImageUpload } from '../storage/image-upload.decorator.js';
import type { UploadedImage } from '../storage/image-rules.js';
import {
  ActivityResponseDto,
  ItineraryDayResponseDto,
} from './dto/itinerary.response.dto.js';
import { UpdateActivityDto } from './dto/update-activity.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import type { ActivityView, ItineraryDayView } from './itineraries.types.js';

/**
 * Activities are addressed by their own ID, so the ITN-10 edit/delete routes
 * and the ITN-12 image routes live at `/api/activities/:id...` (endpoints.md)
 * even though the module that owns them is `itineraries`.
 */
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

  @Post(':id/images')
  @ImageUpload()
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-12 Attach an image to an activity (GEN-08)' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: ItineraryDayResponseDto })
  @ApiBadRequestResponse({
    description:
      'Missing/invalid image, invalid activity ID, or LIMIT_EXCEEDED: activity already has 5 images',
  })
  @ApiPayloadTooLargeResponse({ description: 'Image exceeds 5 MB' })
  @ApiNotFoundResponse({
    description: 'Activity not found or owned by another user',
  })
  addImage(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<ItineraryDayView> {
    return this.itineraries.addActivityImage(id.toHexString(), file, user.id);
  }

  @Delete(':id/images/:imageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiOperation({ summary: 'ITN-12 Remove an image from an activity (GEN-08)' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'imageId', type: String })
  @ApiNoContentResponse({ description: 'Image removed from activity' })
  @ApiBadRequestResponse({ description: 'Invalid activity or image ID' })
  @ApiNotFoundResponse({
    description: 'Activity or image not found, or owned by another user',
  })
  async removeImage(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('imageId', ParseObjectIdPipe) imageId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.itineraries.removeActivityImage(
      id.toHexString(),
      imageId.toHexString(),
      user.id,
    );
  }
}
