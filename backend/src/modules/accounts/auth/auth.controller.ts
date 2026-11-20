import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseInterceptors,
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
  readRefreshCookie,
  setAccessCookie,
  setAuthCookies,
} from './auth-cookies.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { CurrentUser, Public } from './decorators.js';
import { RefreshAuthCookiesInterceptor } from './refresh-auth-cookies.interceptor.js';

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
    summary: 'ACC-04, ACC-05 Log in',
    description:
      'Sets the httpOnly access_token and refresh_token cookies (ACC-19); tokens are never in the body. Swagger UI keeps the cookie for later calls. Five wrong passwords in a row lock the account for 15 minutes (ACC-05); a successful login resets the count.',
  })
  @ApiOkResponse({ type: AuthUserResponseDto })
  @ApiBadRequestResponse({
    description: 'VALIDATION_FAILED: email or password missing or malformed',
  })
  @ApiUnauthorizedResponse({
    description:
      'INVALID_CREDENTIALS: invalid email or password. ACCOUNT_LOCKED: 5 failed attempts in a row; the message says how many minutes are left',
  })
  @ApiForbiddenResponse({ description: 'ACCOUNT_SUSPENDED: account suspended' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUserResponseDto> {
    const { user, accessToken, refreshToken } = await this.auth.login(dto);
    setAuthCookies(res, { accessToken, refreshToken }, user.role);
    return { user };
  }

  @Public()
  @Post('refresh')
  @UseInterceptors(RefreshAuthCookiesInterceptor)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ACC-06 Refresh the access token',
    description:
      'Uses the httpOnly refresh_token cookie and sets a new access_token cookie (ACC-19). The refresh token is not rotated. A dead session clears both cookies.',
  })
  @ApiNoContentResponse({ description: 'New access_token cookie set.' })
  @ApiUnauthorizedResponse({
    description:
      'SESSION_EXPIRED: no, unknown, revoked, idle-expired or absolute-expired refresh token; both cookies are cleared (log in again)',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const accessToken = await this.auth.refresh(readRefreshCookie(req));
    setAccessCookie(res, accessToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ACC-06 Log out',
    description:
      "Idempotently deletes this device's session using its access cookie or, if that cannot authenticate, its refresh cookie. Clears both cookies even when credentials are missing or expired.",
  })
  @ApiNoContentResponse({ description: 'Logged out; both cookies cleared.' })
  async logout(
    @CurrentUser() user: AuthUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user?.sid, readRefreshCookie(req));
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
