import { BadRequestException } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes.js';

/** The largest image accepted: 5 MB (GEN-08). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The accepted image types and their file extensions: JPG and PNG only (GEN-08). */
export const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
} as const;

/** At most 5 images per post, activity or hotel; feature services enforce it (GEN-08). */
export const MAX_IMAGES_PER_ITEM = 5;

/** The fields of a Multer file that storage uses (GEN-08). */
export interface UploadedImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/** Throws 400 VALIDATION_FAILED (field `file`) unless the file is a non-empty JPG or PNG of at most 5 MB (GEN-08). */
export function assertImageAllowed(file: UploadedImage): void {
  const fail = (message: string): never => {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Invalid image',
      details: [{ field: 'file', message }],
    });
  };
  if (!Object.hasOwn(ALLOWED_IMAGE_TYPES, file.mimetype)) {
    fail('only JPG or PNG images are allowed');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    fail('an image can be at most 5 MB');
  }
  if (file.size === 0) {
    fail('the file is empty');
  }
}
