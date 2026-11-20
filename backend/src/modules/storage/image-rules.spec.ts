import { BadRequestException } from '@nestjs/common';
import {
  assertImageAllowed,
  assertImageContent,
  detectImageType,
  MAX_IMAGE_BYTES,
} from './image-rules.js';
import type { UploadedImage } from './image-rules.js';

function image(overrides: Partial<UploadedImage> = {}): UploadedImage {
  const size = overrides.size ?? 1024;
  return {
    buffer: Buffer.alloc(0),
    originalname: 'photo.png',
    mimetype: 'image/png',
    size,
    ...overrides,
  };
}

function rejection(file: UploadedImage): BadRequestException {
  try {
    assertImageAllowed(file);
  } catch (error) {
    if (error instanceof BadRequestException) return error;
    throw error;
  }
  throw new Error('expected the image to be rejected');
}

describe('assertImageAllowed', () => {
  it('accepts a PNG of exactly 5 MB', () => {
    expect(() =>
      assertImageAllowed(image({ size: MAX_IMAGE_BYTES })),
    ).not.toThrow();
  });

  it('rejects a PNG one byte over 5 MB on the field "file"', () => {
    const error = rejection(image({ size: MAX_IMAGE_BYTES + 1 }));
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'file', message: 'an image can be at most 5 MB' }],
    });
  });

  it('accepts a JPEG', () => {
    expect(() =>
      assertImageAllowed(image({ mimetype: 'image/jpeg' })),
    ).not.toThrow();
  });

  it('rejects a GIF', () => {
    const error = rejection(image({ mimetype: 'image/gif' }));
    expect(error.getResponse()).toMatchObject({
      details: [
        { field: 'file', message: 'only JPG or PNG images are allowed' },
      ],
    });
  });

  it('rejects an empty file', () => {
    const error = rejection(image({ size: 0 }));
    expect(error.getResponse()).toMatchObject({
      details: [{ field: 'file', message: 'the file is empty' }],
    });
  });
});

const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.alloc(16),
]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_BYTES = Buffer.concat([Buffer.from(PNG_SIGNATURE), Buffer.alloc(16)]);

describe('detectImageType', () => {
  it('recognises a JPEG signature', () => {
    expect(detectImageType(JPEG_BYTES)).toBe('image/jpeg');
  });

  it('recognises a PNG signature', () => {
    expect(detectImageType(PNG_BYTES)).toBe('image/png');
  });

  it('rejects a GIF', () => {
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeUndefined();
  });

  it('rejects an empty buffer', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeUndefined();
  });

  it('rejects a JPEG signature cut short (2 bytes)', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeUndefined();
  });

  it('rejects a PNG signature missing its last byte', () => {
    expect(
      detectImageType(Buffer.from(PNG_SIGNATURE.slice(0, 7))),
    ).toBeUndefined();
  });
});

describe('assertImageContent', () => {
  function contentRejection(file: UploadedImage): BadRequestException {
    try {
      assertImageContent(file);
    } catch (error) {
      if (error instanceof BadRequestException) return error;
      throw error;
    }
    throw new Error('expected the image to be rejected');
  }

  it('accepts PNG bytes declared as image/png', () => {
    expect(() =>
      assertImageContent(image({ buffer: PNG_BYTES, mimetype: 'image/png' })),
    ).not.toThrow();
  });

  it('accepts JPEG bytes declared as image/jpeg', () => {
    expect(() =>
      assertImageContent(image({ buffer: JPEG_BYTES, mimetype: 'image/jpeg' })),
    ).not.toThrow();
  });

  it('rejects JPEG bytes declared as image/png', () => {
    const response = contentRejection(
      image({ buffer: JPEG_BYTES, mimetype: 'image/png' }),
    ).getResponse() as {
      code: string;
      details: { field: string; message: string }[];
    };
    expect(response.code).toBe('VALIDATION_FAILED');
    expect(response.details[0]?.field).toBe('file');
    expect(response.details[0]?.message).toContain('does not match');
  });

  it('rejects text bytes declared as image/png', () => {
    const response = contentRejection(
      image({ buffer: Buffer.from('MZ not an image'), mimetype: 'image/png' }),
    ).getResponse() as {
      code: string;
      details: { field: string; message: string }[];
    };
    expect(response.code).toBe('VALIDATION_FAILED');
    expect(response.details[0]?.field).toBe('file');
    expect(response.details[0]?.message).toContain('not a JPG or PNG');
  });
});
