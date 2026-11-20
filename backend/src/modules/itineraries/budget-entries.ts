import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { CreateBudgetEntryDto } from './dto/create-budget-entry.dto.js';
import { UpdateBudgetEntryDto } from './dto/update-budget-entry.dto.js';

function invalid(details: { field: string; message: string }[]): never {
  throw new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message: 'Validation failed',
    details,
  });
}

/**
 * ITN-14: shared service/fake validation, so direct service calls and the
 * contract fake reject the same input as the HTTP pipe. Unknown currency
 * codes use UNSUPPORTED_CURRENCY; field validation uses VALIDATION_FAILED.
 * Reference IDs keep the dataset's exact spelling.
 */
export async function validateBudgetEntry(
  dto: CreateBudgetEntryDto | UpdateBudgetEntryDto,
  referenceData: Pick<ReferenceDataService, 'getCurrency'>,
  creating: boolean,
): Promise<void> {
  const input = creating
    ? plainToInstance(CreateBudgetEntryDto, dto)
    : plainToInstance(UpdateBudgetEntryDto, dto);
  const details = validateSync(input).flatMap((error) =>
    Object.values(error.constraints ?? {}).map((message) => ({
      field: error.property,
      message,
    })),
  );
  if (details.length > 0) invalid(details);

  if (
    dto.currency !== undefined &&
    !(await referenceData.getCurrency(dto.currency))
  ) {
    throw new BadRequestException({
      code: ErrorCode.UnsupportedCurrency,
      message: `${dto.currency} is not a supported currency`,
      details: [
        {
          field: 'currency',
          message: `${dto.currency} is not a supported currency`,
        },
      ],
    });
  }
}
