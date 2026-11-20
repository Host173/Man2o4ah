import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
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
import { ItineraryDayResponseDto } from './dto/itinerary.response.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import type { ItineraryDayView } from './itineraries.types.js';

/**
 * ITN-12: activity images are addressed by the activity's own ID, so these
 * routes live at `/api/activities/:id/images` (endpoints.md) even though the
 * module that owns them is `itineraries`.
 */
@ApiTags('itineraries')
@ApiCookieAuth()
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly itinerariesService: ItinerariesService) {}

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
    return this.itinerariesService.addActivityImage(
      id.toHexString(),
      file,
      user.id,
    );
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
    await this.itinerariesService.removeActivityImage(
      id.toHexString(),
      imageId.toHexString(),
      user.id,
    );
  }
}
