import { PartialType } from '@nestjs/swagger';
import { AddActivityDto } from './add-activity.dto.js';

/** ITN-10: omitted fields stay unchanged; null is rejected. */
export class UpdateActivityDto extends PartialType(AddActivityDto, {
  skipNullProperties: false,
}) {}
