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
  Put,
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
import { DeactivateRoomDto } from './dto/deactivate-room.dto.js';
import {
  RoomBlockOperationDto,
  RoomBlockResponseDto,
} from './dto/room-block-operation.dto.js';
import { HotelProfileResponseDto } from './dto/hotel-profile.response.dto.js';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto.js';
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

  @Patch(':id/rooms/:roomId/availability')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: 'HTL-06 Block inclusive room dates or remove a whole block',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'roomId', type: String })
  @ApiOkResponse({ type: RoomBlockResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid IDs, dates, or operation fields',
  })
  @ApiNotFoundResponse({
    description:
      'Hotel, room, or block not found within this moderator assignment',
  })
  @ApiConflictResponse({
    description: 'OVERLAPS_RESERVATION_OR_BLOCK: no part of the block is saved',
  })
  manageRoomBlock(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('roomId', ParseObjectIdPipe) roomId: Types.ObjectId,
    @Body() input: RoomBlockOperationDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoomBlockResponseDto> {
    return this.hotels.manageRoomBlock(
      id.toHexString(),
      roomId.toHexString(),
      input,
      user.providerId,
    );
  }

  @Patch(':id/rooms/:roomId')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({ summary: 'HTL-06 Deactivate an assigned room' })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'roomId', type: String })
  @ApiOkResponse({ type: RoomResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid IDs or isActive is not false',
  })
  @ApiNotFoundResponse({
    description: 'Hotel or room not found within this moderator assignment',
  })
  @ApiConflictResponse({
    description: 'ROOM_HAS_RESERVATIONS: reserved nights exist today or later',
  })
  async deactivateRoom(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('roomId', ParseObjectIdPipe) roomId: Types.ObjectId,
    @Body() _input: DeactivateRoomDto,
    @CurrentUser() user: AuthUser,
  ): Promise<RoomResponseDto> {
    return RoomResponseDto.fromView(
      await this.hotels.deactivateRoom(
        id.toHexString(),
        roomId.toHexString(),
        user.providerId,
      ),
    );
  }

  @Delete(':id/rooms/:roomId')
  @Roles(Role.HOTEL_MODERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'HTL-06 Delete a never-reserved room and its blocks',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiParam({ name: 'roomId', type: String })
  @ApiNoContentResponse({ description: 'The room and its blocks were deleted' })
  @ApiBadRequestResponse({ description: 'Invalid hotel or room ID' })
  @ApiNotFoundResponse({
    description: 'Hotel or room not found within this moderator assignment',
  })
  @ApiConflictResponse({
    description:
      'ROOM_HAS_RESERVATIONS or ROOM_WAS_RESERVED: the room is retained',
  })
  deleteRoom(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Param('roomId', ParseObjectIdPipe) roomId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.hotels.deleteRoom(
      id.toHexString(),
      roomId.toHexString(),
      user.providerId,
    );
  }

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
