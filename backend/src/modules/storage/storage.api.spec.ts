import { readdir } from 'node:fs/promises';
import { Controller, Post, UploadedFile } from '@nestjs/common';
import { Public } from '../accounts/auth/decorators.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { ImageUpload } from './image-upload.decorator.js';
import { MAX_IMAGE_BYTES } from './image-rules.js';
import type { UploadedImage } from './image-rules.js';
import { StorageModule } from './storage.module.js';
import { StorageService } from './storage.service.js';
import type { StoredImage } from './storage.service.js';

/** A test-only endpoint that uses the real decorator, as feature modules do. */
@Controller('test-uploads')
class UploadTestController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Post()
  @ImageUpload()
  upload(@UploadedFile() file: UploadedImage): Promise<StoredImage> {
    return this.storage.save(file);
  }
}

function png(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  return bytes;
}

describe('Image upload rejections over HTTP (GEN-08)', () => {
  let t: TestApp;
  const accepted: string[] = [];

  beforeAll(async () => {
    t = await createTestApp({
      imports: [StorageModule],
      controllers: [UploadTestController],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    expect((await readdir(t.uploadDir)).sort()).toEqual([...accepted].sort());
    await t.close();
  }, HOOK_TIMEOUT);

  const post = () => t.http().post('/api/test-uploads');

  it('accepts a valid PNG and serves it', async () => {
    const res = await post()
      .attach('file', png(64), { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(res.body._id).toMatch(/^[0-9a-f]{24}$/);
    accepted.push(res.body.key);
    await t.http().get(`/uploads/${res.body.key}`).expect(200);
  });

  it('accepts exactly 5 MB', async () => {
    const res = await post()
      .attach('file', png(MAX_IMAGE_BYTES), {
        filename: 'big.png',
        contentType: 'image/png',
      })
      .expect(201);
    accepted.push(res.body.key);
  });

  it('answers 413 REQUEST_FAILED above 5 MB (Multer limit)', async () => {
    const res = await post()
      .attach('file', png(MAX_IMAGE_BYTES + 1), {
        filename: 'huge.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(res.body.code).toBe('REQUEST_FAILED');
  });

  it('rejects a GIF with 400 VALIDATION_FAILED', async () => {
    const res = await post()
      .attach('file', Buffer.from('GIF89a......'), {
        filename: 'a.gif',
        contentType: 'image/gif',
      })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects text sent as photo.png with 400 VALIDATION_FAILED', async () => {
    const res = await post()
      .attach('file', Buffer.from('MZ not an image'), {
        filename: 'photo.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a request with no file', async () => {
    const res = await post().field('x', 'y').expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rejects two files in one request', async () => {
    const res = await post()
      .attach('file', png(16), { filename: 'a.png', contentType: 'image/png' })
      .attach('file', png(16), { filename: 'b.png', contentType: 'image/png' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});
