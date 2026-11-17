import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { LoginDto } from '../dto/login.dto.js';
import { AuthUserResponseDto, MeDto } from '../dto/me.response.dto.js';
import { RegisterDto } from '../dto/register.dto.js';
import {
  clearAuthCookies,
  setAccessCookie,
  setAuthCookies,
} from './auth-cookies.js';
import { REFRESH_TOKEN_COOKIE } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { CurrentUser, Public } from './decorators.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ACC-01 Register a guest account' })
  @ApiCreatedResponse({
    type: AuthUserResponseDto,
    description: 'Account created. The user is not logged in.',
  })
  @ApiBadRequestResponse({
    description:
      'VALIDATION_FAILED: invalid email or name, password breaks the rule, or consent not given',
  })
  @ApiConflictResponse({ description: 'EMAIL_TAKEN: email already registered' })
  async register(@Body() dto: RegisterDto): Promise<AuthUserResponseDto> {
    return { user: await this.auth.register(dto) };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ACC-04 Log in',
    description:
      'Sets the httpOnly access_token and refresh_token cookies (ACC-19); tokens are never in the body. Swagger UI keeps the cookie for later calls.',
  })
  @ApiOkResponse({ type: AuthUserResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: email or password missing or malformed',
  })
  @ApiUnauthorizedResponse({
    description: 'INVALID_CREDENTIALS: invalid email or password',
  })
  @ApiForbiddenResponse({ description: 'ACCOUNT_SUSPENDED: account suspended' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserResponseDto> {
    const { user, accessToken, refreshToken } = await this.auth.login(dto);
    setAuthCookies(res, { accessToken, refreshToken });
    return { user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ACC-06 Refresh the access token',
    description:
      'Uses the httpOnly refresh_token cookie and sets a new access_token cookie (ACC-19). The refresh token is not rotated. A dead session clears both cookies.',
  })
  @ApiNoContentResponse({ description: 'New access_token cookie set.' })
  @ApiUnauthorizedResponse({
    description:
      'SESSION_EXPIRED: no, unknown, revoked or idle-expired refresh token; both cookies are cleared (log in again)',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[REFRESH_TOKEN_COOKIE];
    try {
      const accessToken = await this.auth.refresh(
        typeof token === 'string' ? token : undefined,
      );
      setAccessCookie(res, accessToken);
    } catch (error) {
      // The headers stay on the error response, so the browser drops dead cookies.
      clearAuthCookies(res);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'ACC-06 Log out',
    description:
      "Deletes this device's session (revokes its refresh token) and clears both cookies.",
  })
  @ApiNoContentResponse({ description: 'Logged out; both cookies cleared.' })
  @ApiUnauthorizedResponse({
    description:
      'NOT_AUTHENTICATED (no cookie), TOKEN_EXPIRED (refresh, then retry) or SESSION_EXPIRED (already logged out)',
  })
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.sid);
    clearAuthCookies(res);
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'ACC-19 Current user' })
  @ApiOkResponse({ type: MeDto })
  @ApiUnauthorizedResponse({
    description:
      'NOT_AUTHENTICATED (no cookie), TOKEN_EXPIRED (refresh, then retry) or SESSION_EXPIRED (log in again)',
  })
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.id);
  }
}
