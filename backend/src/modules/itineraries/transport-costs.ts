import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { CreateTransportCostDto } from './dto/create-transport-cost.dto.js';
import { UpdateTransportCostDto } from './dto/update-transport-cost.dto.js';

/** Shared service/fake validation; reference IDs keep the dataset's exact spelling. */
export async function validateTransportCost(
  dto: CreateTransportCostDto | UpdateTransportCostDto,
  referenceData: Pick<ReferenceDataService, 'getCities' | 'getCurrency'>,
  creating: boolean,
): Promise<void> {
  const input = creating
    ? plainToInstance(CreateTransportCostDto, dto)
    : plainToInstance(UpdateTransportCostDto, dto);
  const errors = validateSync(input);
  const details = errors.flatMap((error) =>
    Object.values(error.constraints ?? {}).map((message) => ({
      field: error.property,
      message,
    })),
  );
  if (details.length > 0) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Validation failed',
      details,
    });
  }

  const ids = [dto.fromCityId, dto.toCityId].filter(
    (id): id is string => id !== undefined,
  );
  if (ids.length > 0) {
    const cities = await referenceData.getCities(ids);
    for (const field of ['fromCityId', 'toCityId'] as const) {
      const id = dto[field];
      if (id !== undefined && !cities.has(id)) {
        throw new BadRequestException({
          code: ErrorCode.ValidationFailed,
          message: 'Validation failed',
          details: [{ field, message: `Unknown city: ${id}` }],
        });
      }
    }
  }
  if (
    dto.currency !== undefined &&
    !(await referenceData.getCurrency(dto.currency))
  ) {
    throw new BadRequestException({
      code: ErrorCode.UnsupportedCurrency,
      message: 'Unsupported currency',
      details: [{ field: 'currency', message: 'Select a supported currency' }],
    });
  }
}
