import { BadRequestException } from '@nestjs/common';
import { assertImageAllowed, MAX_IMAGE_BYTES } from './image-rules.js';
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
