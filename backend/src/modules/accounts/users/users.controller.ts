import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { clearAuthCookies } from '../auth/auth-cookies.js';
import { Role } from '../auth/auth.types.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { DeactivateAccountDto } from '../dto/deactivate-account.dto.js';
import { ProfileDto } from '../dto/me.response.dto.js';
import { UpdateProfileDto } from '../dto/update-profile.dto.js';
import { ProfileService } from './profile.service.js';
import { SelfDeactivationService } from './self-deactivation.service.js';

/**
 * ACC-09: any logged-in account's own profile. ACC-12: a registered user
 * deactivates their own account.
 */
@ApiTags('users')
@ApiCookieAuth()
@ApiUnauthorizedResponse({
  description:
    'NOT_AUTHENTICATED (no cookie), TOKEN_EXPIRED (refresh, then retry) or SESSION_EXPIRED (log in again)',
})
@ApiForbiddenResponse({
  description: 'PASSWORD_CHANGE_REQUIRED: change the password first',
})
@Controller('users')
export class UsersController {
  constructor(
    private readonly profile: ProfileService,
    private readonly deactivation: SelfDeactivationService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'ACC-09 View my profile' })
  @ApiOkResponse({ type: ProfileDto })
  get(@CurrentUser() user: AuthUser): Promise<ProfileDto> {
    return this.profile.get(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'ACC-09 Edit my name, phone and preferred currency',
    description:
      'Send only the fields to change. All must pass validation, or nothing is saved.',
  })
  @ApiOkResponse({ type: ProfileDto })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED: invalid name or phone, or a field that cannot be edited; UNSUPPORTED_CURRENCY: preferredCurrency is not a supported currency',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    return this.profile.update(user.id, dto);
  }

  @Delete('me')
  @Roles(Role.USER)
  @HttpCode(HttpStatus.NO_CONTENT)
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
