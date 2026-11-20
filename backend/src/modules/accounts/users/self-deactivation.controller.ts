import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DeactivateAccountDto } from '../dto/deactivate-account.dto.js';
import { clearAuthCookies } from '../auth/auth-cookies.js';
import { Role } from '../auth/auth.types.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { SelfDeactivationService } from './self-deactivation.service.js';

/** ACC-12: a registered user deactivates their own account. */
@ApiTags('users')
@Controller('users')
export class SelfDeactivationController {
  constructor(private readonly deactivation: SelfDeactivationService) {}

  @Delete('me')
  @Roles(Role.USER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'ACC-12 Deactivate my account',
    description:
      'Needs the body { "confirm": true }. Sets the account to deactivated, deletes all of its sessions, clears both authentication cookies and emits user.deactivated (posts and public itineraries are hidden). The account can no longer log in.',
  })
  @ApiNoContentResponse({
    description: 'Account deactivated; logged out everywhere.',
  })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: confirm is missing or not true',
  })
  @ApiUnauthorizedResponse({
    description:
      'NOT_AUTHENTICATED (no cookie), TOKEN_EXPIRED (refresh, then retry) or SESSION_EXPIRED (log in again)',
  })
  @ApiForbiddenResponse({
    description:
      'FORBIDDEN_ROLE: only registered users (role user) can deactivate themselves. PASSWORD_CHANGE_REQUIRED: change the password first',
  })
  @ApiConflictResponse({
    description:
      'ACTIVE_BOOKINGS_EXIST: the user has upcoming confirmed bookings. INVALID_STATUS_TRANSITION: the account is no longer active',
  })
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Body() dto: DeactivateAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    void dto; // validated by the global ValidationPipe: confirm === true
    await this.deactivation.deactivate(user.id);
    clearAuthCookies(res);
  }
}
