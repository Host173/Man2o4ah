import { Body, Controller, Inject, Param, Patch, Post } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { CreateHotelDto } from './dto/create-hotel.dto.js';
import { HotelProfileResponseDto } from './dto/hotel-profile.response.dto.js';
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
