import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import { Public } from '../accounts/auth/decorators.js';
import { Role } from '../accounts/auth/auth.types.js';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { CreateHotelReviewDto } from './dto/create-hotel-review.dto.js';
import {
  HotelReviewResponseDto,
  PaginatedHotelReviewsResponseDto,
} from './dto/hotel-review.response.dto.js';
import { ListHotelReviewsQueryDto } from './dto/list-hotel-reviews-query.dto.js';
import { UpdateHotelReviewDto } from './dto/update-hotel-review.dto.js';
import type {
  HotelReviewView,
  ListHotelReviewsQuery,
} from './hotel-bookings.types.js';
import { HotelReviewsService } from './hotel-reviews.service.js';

@ApiTags('hotel-reviews')
@Controller()
export class HotelReviewsController {
  constructor(private readonly reviews: HotelReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiOperation({
    summary:
      'HTL-23 Submit a rating and optional review for a completed reservation',
  })
  @ApiParam({ name: 'id', description: 'Completed reservation ObjectId' })
  @ApiCreatedResponse({ type: HotelReviewResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiConflictResponse({
    description: 'ALREADY_REVIEWED or INVALID_STATUS_TRANSITION',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: absent or not owned' })
  create(
    @Param('id', ParseObjectIdPipe) reservationId: Types.ObjectId,
    @Body() body: CreateHotelReviewDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelReviewView> {
    return this.reviews.create(reservationId.toHexString(), user.id, body);
  }

  @Patch('reviews/:id')
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-23 Edit my hotel review' })
  @ApiParam({ name: 'id', description: 'Review ObjectId' })
  @ApiOkResponse({ type: HotelReviewResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: absent or not owned' })
  update(
    @Param('id', ParseObjectIdPipe) reviewId: Types.ObjectId,
    @Body() body: UpdateHotelReviewDto,
    @CurrentUser() user: AuthUser,
  ): Promise<HotelReviewView> {
    return this.reviews.update(reviewId.toHexString(), user.id, body);
  }

  @Delete('reviews/:id')
  @HttpCode(204)
  @Roles(Role.USER)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'HTL-23 Delete my hotel review' })
  @ApiParam({ name: 'id', description: 'Review ObjectId' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE: users only' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: absent or not owned' })
  async delete(
    @Param('id', ParseObjectIdPipe) reviewId: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.reviews.delete(reviewId.toHexString(), user.id);
  }

  @Get('hotels/:id/reviews')
  @Public()
  @ApiOperation({
    summary: 'HTL-24 List a hotel’s public reviews, newest first',
  })
  @ApiParam({ name: 'id', description: 'Hotel ObjectId' })
  @ApiOkResponse({ type: PaginatedHotelReviewsResponseDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND: hotel does not exist' })
  listForHotel(
    @Param('id', ParseObjectIdPipe) hotelId: Types.ObjectId,
    @Query() query: ListHotelReviewsQueryDto,
  ): Promise<Paginated<HotelReviewView>> {
    const pagination: ListHotelReviewsQuery = {
      page: query.page,
      limit: query.limit,
    };
    return this.reviews.listForHotel(hotelId.toHexString(), pagination);
  }
}
