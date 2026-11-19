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

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** The image type a file's first bytes show, or undefined if it is neither JPG nor PNG (GEN-08). */
export function detectImageType(
  bytes: Buffer,
): keyof typeof ALLOWED_IMAGE_TYPES | undefined {
  if (
    bytes.length >= JPEG_SIGNATURE.length &&
    bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= PNG_SIGNATURE.length &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return 'image/png';
  }
  return undefined;
}

/** Throws 400 VALIDATION_FAILED (field `file`) unless the bytes are a JPG or PNG of the declared type (GEN-08). Called by StorageService.save only, never by the fake. */
export function assertImageContent(file: UploadedImage): void {
  const detected = detectImageType(file.buffer);
  let message: string | undefined;
  if (detected === undefined) {
    message = 'the file is not a JPG or PNG image';
  } else if (detected !== file.mimetype) {
    message = 'the file content does not match its type';
  }
  if (message !== undefined) {
    throw new BadRequestException({
      code: ErrorCode.ValidationFailed,
      message: 'Invalid image',
      details: [{ field: 'file', message }],
    });
  }
}
