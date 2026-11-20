import { PartialType } from '@nestjs/swagger';
import { CreateTransportCostDto } from './create-transport-cost.dto.js';

/** ITN-16: omitted fields stay unchanged; null is not a valid value. */
export class UpdateTransportCostDto extends PartialType(
  CreateTransportCostDto,
  {
    skipNullProperties: false,
  },
) {}
