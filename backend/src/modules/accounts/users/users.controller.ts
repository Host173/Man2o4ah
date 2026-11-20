import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { ProfileDto } from '../dto/me.response.dto.js';
import { UpdateProfileDto } from '../dto/update-profile.dto.js';
import { ProfileService } from './profile.service.js';

/** ACC-09: any logged-in account's own profile. */
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
  constructor(private readonly profile: ProfileService) {}

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
}
