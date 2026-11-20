import { PartialType } from '@nestjs/swagger';
import { CreateBudgetEntryDto } from './create-budget-entry.dto.js';

/** ITN-14: omitted fields stay unchanged; null is not a valid value. */
export class UpdateBudgetEntryDto extends PartialType(CreateBudgetEntryDto, {
  skipNullProperties: false,
}) {}
