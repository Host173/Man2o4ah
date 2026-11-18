import { BadRequestException } from '@nestjs/common';
import { toDateOnly } from '../../common/dates/date-only.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import type { RoomBlockOperationDto } from './dto/room-block-operation.dto.js';
import { normalizeInventoryId } from './inventory-ids.js';
import { assertDateRange } from './room-date-ranges.js';

type RoomBlockOperation =
  | { op: 'BLOCK'; fromDate: Date; toDate: Date }
  | { op: 'UNBLOCK'; blockId: string };

/** HTL-06: validate mutually exclusive operation fields before any write. */
export function parseRoomBlockOperation(
  input: RoomBlockOperationDto,
): RoomBlockOperation {
  if (
    input.op === 'BLOCK' &&
    typeof input.fromDate === 'string' &&
    typeof input.toDate === 'string' &&
    input.blockId === undefined
  ) {
    const fromDate = parseDate(input.fromDate, 'fromDate');
    const toDate = parseDate(input.toDate, 'toDate');
    assertDateRange(fromDate, toDate);
    return { op: 'BLOCK', fromDate, toDate };
  }
  if (
    input.op === 'UNBLOCK' &&
    typeof input.blockId === 'string' &&
    input.fromDate === undefined &&
    input.toDate === undefined
  ) {
    return { op: 'UNBLOCK', blockId: normalizeInventoryId(input.blockId) };
  }
  throw new BadRequestException({
    code: ErrorCode.ValidationFailed,
    message:
      'BLOCK requires only fromDate and toDate; UNBLOCK requires only blockId',
    details: [
      { field: 'op', message: 'must have the fields for its operation' },
    ],
  });
}

function parseDate(value: string, field: string): Date {
  try {
    return toDateOnly(value);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Invalid calendar date',
      details: [{ field, message: 'must be a valid YYYY-MM-DD date' }],
    });
  }
}
