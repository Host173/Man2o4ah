import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
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
import type { AccountListItem } from '../accounts/accounts.types.js';
import { Role, type AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser, Roles } from '../accounts/auth/decorators.js';
import { ListReportsQueryDto } from '../moderation/dto/list-reports-query.dto.js';
import {
  PaginatedReportsResponseDto,
  ReportResponseDto,
} from '../moderation/dto/report.response.dto.js';
import { ResolveReportDto } from '../moderation/dto/resolve-report.dto.js';
import type { ReportView } from '../moderation/moderation.types.js';
import { ReportTargetType } from '../moderation/schemas/report.schema.js';
import { AdminService } from './admin.service.js';
import type { AdminBookingView } from './admin.types.js';
import {
  AdminAccountResponseDto,
  PaginatedAdminAccountsResponseDto,
} from './dto/admin-account.response.dto.js';
import { PaginatedAdminBookingsResponseDto } from './dto/admin-booking.response.dto.js';
import { CreateModeratorDto } from './dto/create-moderator.dto.js';
import { ListAdminAccountsQueryDto } from './dto/list-admin-accounts-query.dto.js';
import { ListAdminBookingsQueryDto } from './dto/list-admin-bookings-query.dto.js';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto.js';

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

  @Get('reports')
  @ApiOperation({
    summary:
      'GEN-10 List moderation reports filterable by status (defaults to open)',
  })
  @ApiOkResponse({ type: PaginatedReportsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid filter or pagination query' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listReports(
    @Query() query: ListReportsQueryDto,
  ): Promise<Paginated<ReportView>> {
    return this.adminService.listReports(query);
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary:
      'GEN-10 Resolve an open report by dismissing, hiding, or deleting the content',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid report ID or action' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({
    description: 'Report or target content not found',
  })
  @ApiConflictResponse({ description: 'Report has already been resolved' })
  resolveReport(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ResolveReportDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<ReportView> {
    return this.adminService.resolveReport(id.toHexString(), dto, admin.id);
  }

  @Patch('content/:type/:id/hide')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'GEN-10 Directly hide a reportable content item by type and ID',
  })
  @ApiParam({ name: 'type', enum: Object.values(ReportTargetType) })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Content hidden' })
  @ApiBadRequestResponse({ description: 'Invalid content type or ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Content item not found' })
  async hideContent(
    @Param('type') type: ReportTargetType,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() admin: AuthUser,
  ): Promise<void> {
    await this.adminService.hideContent(type, id.toHexString(), admin.id);
  }

  @Delete('content/:type/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'GEN-10 Directly delete a reportable content item by type and ID',
  })
  @ApiParam({ name: 'type', enum: Object.values(ReportTargetType) })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Content deleted' })
  @ApiBadRequestResponse({ description: 'Invalid content type or ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Content item not found' })
  async deleteContent(
    @Param('type') type: ReportTargetType,
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() admin: AuthUser,
  ): Promise<void> {
    await this.adminService.deleteContent(type, id.toHexString(), admin.id);
  }

  @Get('accounts')
  @ApiOperation({
    summary:
      'ACC-14 List, search, and filter all user, moderator, and admin accounts',
  })
  @ApiOkResponse({ type: PaginatedAdminAccountsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid filter or pagination query' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  listAccounts(
    @Query() query: ListAdminAccountsQueryDto,
  ): Promise<Paginated<AccountListItem>> {
    return this.adminService.listAccounts(query);
  }

  @Post('moderators')
  @ApiOperation({
    summary:
      'ACC-13 Create an airline or hotel moderator linked to an existing provider',
  })
  @ApiCreatedResponse({ type: AdminAccountResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Referenced airline or hotel not found' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  createModerator(
    @Body() dto: CreateModeratorDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<AccountListItem> {
    return this.adminService.createModerator(dto, admin.id);
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'ACC-07a Reset a user or moderator password to a temporary password',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Password reset and sessions revoked' })
  @ApiBadRequestResponse({
    description: 'Invalid account ID or temporary password',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  async resetUserPassword(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: ResetUserPasswordDto,
    @CurrentUser() admin: AuthUser,
  ): Promise<void> {
    await this.adminService.resetUserPassword(id.toHexString(), dto, admin.id);
  }

  @Patch('accounts/:id/suspend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'ACC-15 / ACC-16 Suspend an active account and revoke its sessions',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Account suspended' })
  @ApiBadRequestResponse({ description: 'Invalid account ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({
    description: 'Account cannot transition from its current status',
  })
  async suspendAccount(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() admin: AuthUser,
  ): Promise<void> {
    await this.adminService.suspendAccount(id.toHexString(), admin.id);
  }

  @Patch('accounts/:id/reactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ACC-15 / ACC-16 Reactivate a suspended account',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Account reactivated' })
  @ApiBadRequestResponse({ description: 'Invalid account ID' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiForbiddenResponse({ description: 'Admin role required' })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({
    description: 'Account cannot transition from its current status',
  })
  async reactivateAccount(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() admin: AuthUser,
  ): Promise<void> {
    await this.adminService.reactivateAccount(id.toHexString(), admin.id);
  }
}
