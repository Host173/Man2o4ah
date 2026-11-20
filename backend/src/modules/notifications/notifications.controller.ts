import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
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
import {
  NotificationResponseDto,
  PaginatedNotificationsResponseDto,
  ReadAllResponseDto,
  UnreadCountResponseDto,
} from './dto/notification.response.dto.js';
import { NotificationsService } from './notifications.service.js';
import type { NotificationView } from './notifications.types.js';

@ApiTags('notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'GEN-01 List my notifications, newest first' })
  @ApiOkResponse({ type: PaginatedNotificationsResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  list(
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<NotificationView>> {
    return this.notificationsService.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'GEN-01 Count my unread notifications' })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async unreadCount(
    @CurrentUser() user: AuthUser,
  ): Promise<UnreadCountResponseDto> {
    return { count: await this.notificationsService.unreadCount(user.id) };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'GEN-01 Mark all my notifications as read' })
  @ApiOkResponse({ type: ReadAllResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  async readAll(@CurrentUser() user: AuthUser): Promise<ReadAllResponseDto> {
    return { updated: await this.notificationsService.markAllRead(user.id) };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'GEN-01 Mark one of my notifications as read' })
  @ApiParam({ name: 'id', type: String, example: '6736f0b2c5a1b2c3d4e5f601' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiBadRequestResponse({ description: 'Malformed notification id' })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  markRead(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<NotificationView> {
    return this.notificationsService.markRead(user.id, id.toHexString());
  }
}
