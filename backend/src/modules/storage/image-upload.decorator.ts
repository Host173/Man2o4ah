import { applyDecorators, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { MAX_IMAGE_BYTES } from './image-rules.js';

/**
 * Accepts one image per request, in the multipart field `field` (GEN-08).
 * The controller reads it with `@UploadedFile() file` and passes it to the
 * feature service, which calls `storage.save(file)`. Feature modules never
 * configure Multer themselves.
 */
export function ImageUpload(field = 'file') {
  return applyDecorators(
    UseInterceptors(
      FileInterceptor(field, {
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: [field],
        properties: { [field]: { type: 'string', format: 'binary' } },
      },
    }),
  );
}
