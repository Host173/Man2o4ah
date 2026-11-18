import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';

export function normalizeInventoryId(id: string): string {
  if (!Types.ObjectId.isValid(id)) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Inventory IDs must be valid ObjectIds',
    });
  }
  return new Types.ObjectId(id).toHexString();
}
