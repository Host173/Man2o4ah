import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiConflictResponse,
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
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { ImageUpload } from '../storage/image-upload.decorator.js';
import type { UploadedImage } from '../storage/image-rules.js';
import { CreateHotelDto } from './dto/create-hotel.dto.js';
import { CreateRoomDto } from './dto/create-room.dto.js';
import { HotelProfileResponseDto } from './dto/hotel-profile.response.dto.js';
import { UpdateHotelDto } from './dto/update-hotel.dto.js';
import {
  PaginatedRoomsResponseDto,
  RoomResponseDto,
} from './dto/room.response.dto.js';
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

  @Post(':id/rooms')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'HTL-03 Add a room to the assigned hotel' })
  @ApiParam({ name: 'id', type: String })
  @ApiCreatedResponse({ type: RoomResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid hotel ID or room fields' })
  @ApiNotFoundResponse({
    description: 'Hotel not found or not assigned to this moderator',
  })
  @ApiConflictResponse({
    description: 'CONFLICT: the room name already exists within this hotel',
  })
  async createRoom(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() input: CreateRoomDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoomResponseDto> {
    return RoomResponseDto.fromView(
      await this.hotels.createRoom(id.toHexString(), input, user.providerId),
    );
  }

  @Get(':id/rooms')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'HTL-03 List rooms of the assigned hotel' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: PaginatedRoomsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid hotel ID or pagination' })
  @ApiNotFoundResponse({
    description: 'Hotel not found or not assigned to this moderator',
  })
  async listRooms(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedRoomsResponseDto> {
    const result = await this.hotels.listRooms(
      id.toHexString(),
      query,
      user.providerId,
    );
    return {
      ...result,
      items: result.items.map((room) => RoomResponseDto.fromView(room)),
    };
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
