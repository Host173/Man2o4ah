import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Paginated } from '../../common/pagination/paginated.js';
import { Role, type AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { ProviderType } from '../accounts/schemas/user.schema.js';
import { AdminService } from './admin.service.js';
import type { AdminBookingView } from './admin.types.js';
import { PaginatedAdminBookingsResponseDto } from './dto/admin-booking.response.dto.js';
import { AdminProviderParamsDto } from './dto/admin-provider-params.dto.js';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto.js';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('bookings')
  @ApiOperation({
    summary:
      'ACC-17 List all flight and hotel bookings (read-only, filterable)',
  })
  @ApiOkResponse({ type: PaginatedAdminBookingsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid filter or pagination query' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listBookings(
    @Query() query: ListAdminBookingsQueryDto,
  ): Promise<Paginated<AdminBookingView>> {
    return this.adminService.listBookings(query);
  }

  @Patch('providers/:type/:id/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'ACC-15 Deactivate an airline or hotel provider and notify its moderators',
  })
  @ApiParam({
    name: 'type',
    enum: Object.values(ProviderType),
    description: 'Provider type (`airline` or `hotel`)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Provider ObjectId' })
  @ApiNoContentResponse({
    description: 'Provider deactivated and notifications/audit events emitted',
  })
  @ApiBadRequestResponse({
    description: 'Invalid provider type or malformed ID',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  async deactivateProvider(
    @Param() params: AdminProviderParamsDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<void> {
    await this.adminService.deactivateProvider(
      params.type,
      params.id,
      admin.id,
    );
  }

  @Patch('providers/:type/:id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'ACC-15 Reactivate an airline or hotel provider and notify its moderators',
  })
  @ApiParam({
    name: 'type',
    enum: Object.values(ProviderType),
    description: 'Provider type (`airline` or `hotel`)',
  })
  @ApiParam({ name: 'id', type: String, description: 'Provider ObjectId' })
  @ApiNoContentResponse({
    description: 'Provider reactivated and notifications/audit events emitted',
  })
  @ApiBadRequestResponse({
    description: 'Invalid provider type or malformed ID',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  async reactivateProvider(
    @Param() params: AdminProviderParamsDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<void> {
    await this.adminService.reactivateProvider(
      params.type,
      params.id,
      admin.id,
    );
  }
}
