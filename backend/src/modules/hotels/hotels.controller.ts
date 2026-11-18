import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  UploadedFile,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { ImageUpload } from '../storage/image-upload.decorator.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { CreateHotelDto } from './dto/create-hotel.dto.js';
import { HotelProfileResponseDto } from './dto/hotel-profile.response.dto.js';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto.js';
import { UpdateHotelDto } from './dto/update-hotel.dto.js';
import { HotelsService } from './hotels.service.js';

@ApiTags('hotels')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description: 'Authentication or a live session required',
})
@ApiForbiddenResponse({
  description: 'Wrong role or a password change is required',
})
@Controller('hotels')
export class HotelsController {
  constructor(@Inject(HotelsService) private readonly hotels: HotelsService) {}

  @Put(':id/policies')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary:
      'HTL-09 / HTL-10 Replace check-in/out times and cancellation tiers',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: HotelProfileResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid ID, HH:mm times, or cancellation tiers (unique non-negative integer daysBefore and integer refundPercent from 0 to 100)',
  })
  @ApiNotFoundResponse({
    description: 'Hotel not found or not assigned to this moderator',
  })
  async updatePolicies(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() input: UpdateHotelPoliciesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelProfileResponseDto> {
    return HotelProfileResponseDto.fromView(
      await this.hotels.updatePolicies(
        id.toHexString(),
        input,
        user.providerId,
      ),
    );
  }

  @Post(':id/photos')
  @Roles(Role.HOTEL_MODERATOR)
  @ImageUpload()
  @ApiOperation({ summary: 'HTL-01 Upload a hotel photo (GEN-08)' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: HotelProfileResponseDto })
  @ApiBadRequestResponse({
    description:
      'Missing image, invalid ID, image is not a non-empty JPG/PNG, or LIMIT_EXCEEDED: the hotel already has five photos',
  })
  @ApiPayloadTooLargeResponse({ description: 'The image exceeds 5 MB' })
  @ApiNotFoundResponse({
    description: 'Hotel not found or not assigned to this moderator',
  })
  async addPhoto(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @UploadedFile() file: UploadedImage | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelProfileResponseDto> {
    return HotelProfileResponseDto.fromView(
      await this.hotels.addPhoto(id.toHexString(), file, user.providerId),
    );
  }

  @Delete(':id/photos/:photoId')
  @Roles(Role.HOTEL_MODERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'HTL-01 Remove a hotel photo (GEN-08)' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'photoId', type: String })
  @ApiNoContentResponse({
    description: 'The file and hotel photo reference were removed',
  })
  @ApiBadRequestResponse({ description: 'Invalid hotel or photo ID' })
  @ApiNotFoundResponse({
    description:
      'Hotel or photo not found, or hotel is not assigned to this moderator',
  })
  removePhoto(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('photoId', ParseObjectIdPipe) photoId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.hotels.removePhoto(
      id.toHexString(),
      photoId.toHexString(),
      user.providerId,
    );
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'HTL-01 Create a hotel profile (admin only)' })
  @ApiCreatedResponse({ type: HotelProfileResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid profile or unknown reference-data city',
  })
  async create(
    @Body() input: CreateHotelDto,
  ): Promise<HotelProfileResponseDto> {
    return HotelProfileResponseDto.fromView(await this.hotels.create(input));
  }

  @Patch(':id')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: 'HTL-01 Edit the assigned hotel profile (hotel moderator only)',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: HotelProfileResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid hotel ID, profile, or reference-data city',
  })
  @ApiNotFoundResponse({
    description: 'Hotel not found or not assigned to this moderator',
  })
  async update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() input: UpdateHotelDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelProfileResponseDto> {
    return HotelProfileResponseDto.fromView(
      await this.hotels.update(id.toHexString(), input, user.providerId),
    );
  }
}
