import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser } from '../accounts/auth/decorators.js';
import { CreateReportDto } from './dto/create-report.dto.js';
import { ReportResponseDto } from './dto/report.response.dto.js';
import { ModerationService } from './moderation.service.js';
import type { ReportView } from './moderation.types.js';

@ApiTags('moderation')
@ApiCookieAuth()
@Controller('reports')
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post()
  @ApiOperation({
    summary: 'GEN-09 Report a post, comment, review, or itinerary',
  })
  @ApiCreatedResponse({ type: ReportResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnauthorizedResponse({ description: 'Authentication required' })
  @ApiNotFoundResponse({ description: 'Reported content item not found' })
  @ApiConflictResponse({
    description: 'User has already reported this content item',
  })
  createReport(
    @Body() dto: CreateReportDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReportView> {
    return this.moderationService.createReport(dto, user.id);
  }
}
