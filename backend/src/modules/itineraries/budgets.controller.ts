import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Types } from 'mongoose';
import type { AuthUser } from '../accounts/auth/auth.types.js';
import { CurrentUser } from '../accounts/auth/decorators.js';
import { BudgetEntryResponseDto } from './dto/itinerary.response.dto.js';
import { UpdateBudgetEntryDto } from './dto/update-budget-entry.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import type { BudgetEntryView } from './itineraries.types.js';

/** ITN-14: budget entries are addressed by their own ID, like activities. */
@ApiTags('itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'ITN-14 Edit my budget entry' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: BudgetEntryResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid category, amount, currency or note',
  })
  @ApiNotFoundResponse({ description: 'Owned budget entry not found' })
  update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateBudgetEntryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<BudgetEntryView> {
    return this.itineraries.updateBudgetEntry(id.toHexString(), dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ITN-14 Delete my budget entry' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Budget entry deleted' })
  @ApiBadRequestResponse({ description: 'Invalid budget entry ID' })
  @ApiNotFoundResponse({ description: 'Owned budget entry not found' })
  delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.itineraries.deleteBudgetEntry(id.toHexString(), user.id);
  }
}
