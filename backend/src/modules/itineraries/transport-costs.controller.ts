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
import { TransportCostResponseDto } from './dto/itinerary.response.dto.js';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto.js';
import { ItinerariesService } from './itineraries.service.js';
import type { TransportCostView } from './itineraries.types.js';

@ApiTags('itineraries')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ description: 'Authentication required' })
@Controller('transport-costs')
export class TransportCostsController {
  constructor(private readonly itineraries: ItinerariesService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'ITN-16 Edit my transport cost' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: TransportCostResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid transport cost or references',
  })
  @ApiNotFoundResponse({ description: 'Owned transport cost or day not found' })
  update(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: UpdateTransportCostDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TransportCostView> {
    return this.itineraries.updateTransportCost(id.toHexString(), dto, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ITN-16 Delete my transport cost' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse({ description: 'Transport cost deleted' })
  @ApiBadRequestResponse({ description: 'Invalid transport cost ID' })
  @ApiNotFoundResponse({ description: 'Owned transport cost not found' })
  delete(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.itineraries.deleteTransportCost(id.toHexString(), user.id);
  }
}
