import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Paginated } from '../../common/pagination/paginated.js';
import { Role } from '../accounts/auth/auth.types.js';
import { Roles } from '../accounts/auth/decorators.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditLogQueryDto } from '../audit/audit.types.js';
import { AdminService } from './admin.service.js';
import type { AdminBookingView } from './admin.types.js';
import { PaginatedAdminBookingsResponseDto } from './dto/admin-booking.response.dto.js';
import {
  AuditLogResponseDto,
  PaginatedAuditLogsResponseDto,
} from './dto/audit-log.response.dto.js';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto.js';

@ApiTags('admin')
@ApiCookieAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly audit: AuditService,
  ) {}

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

  @Get('audit-logs')
  @ApiOperation({
    summary: 'GEN-07 List admin actions (newest first, by action and date)',
  })
  @ApiOkResponse({ type: PaginatedAuditLogsResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid action, date or pagination, or from after to',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  async listAuditLogs(
    @Query() query: AuditLogQueryDto,
  ): Promise<Paginated<AuditLogResponseDto>> {
    const page = await this.audit.list(query);
    return {
      ...page,
      items: page.items.map((item) => AuditLogResponseDto.fromView(item)),
    };
  }
}
