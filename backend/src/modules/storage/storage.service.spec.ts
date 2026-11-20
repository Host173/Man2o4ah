import { mkdtempSync, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp } from '../../../test/support/test-app.js';
import type { TestApp } from '../../../test/support/test-app.js';
import { MAX_IMAGE_BYTES } from './image-rules.js';
import type { UploadedImage } from './image-rules.js';
import { StorageModule } from './storage.module.js';
import { StorageService } from './storage.service.js';

const fault = vi.hoisted(() => ({
  partialWrite: false,
  cleanup: false,
  key: '',
  writeError: Object.assign(new Error('Partial write failed'), {
    code: 'ENOSPC',
  }),
  cleanupError: Object.assign(new Error('Cleanup failed'), {
    code: 'EACCES',
  }),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomUUID: () => fault.key || actual.randomUUID(),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (fault.partialWrite) {
        fault.partialWrite = false;
        await actual.writeFile(args[0], Buffer.from('partial'), args[2]);
        throw fault.writeError;
      }
      return actual.writeFile(...args);
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (fault.cleanup) throw fault.cleanupError;
      return actual.unlink(...args);
    },
  };
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  Buffer.from(PNG_SIGNATURE).copy(bytes);
  return bytes;
}

function jpeg(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  Buffer.from([0xff, 0xd8, 0xff]).copy(bytes);
  return bytes;
}

function image(
  bytes: Buffer,
  mimetype: string,
  name = 'photo.png',
): UploadedImage {
  return {
    buffer: bytes,
    originalname: name,
    mimetype,
    size: bytes.length,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to be rejected');
}

describe('StorageService on a real folder (GEN-08)', () => {
  let t: TestApp;
  let storage: StorageService;

  beforeAll(async () => {
    t = await createTestApp({ imports: [StorageModule] });
    storage = t.moduleRef.get(StorageService);
  }, HOOK_TIMEOUT);

  afterAll(() => t.close(), HOOK_TIMEOUT);

  beforeEach(async () => {
    fault.partialWrite = false;
    fault.cleanup = false;
    fault.key = '';
    for (const entry of await readdir(t.uploadDir)) {
      await rm(join(t.uploadDir, entry), { recursive: true, force: true });
    }
  });

  async function served(key: string) {
    return t
      .http()
      .get(`/uploads/${key}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
  }

  it('saves a PNG and serves it under /uploads/<key>', async () => {
    const bytes = png(64);
    const saved = await storage.save(image(bytes, 'image/png'));
    expect(saved.key).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(saved._id).toBeInstanceOf(Types.ObjectId);
    expect(await readFile(join(t.uploadDir, saved.key))).toEqual(bytes);
    const res = await served(saved.key);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.body).toEqual(bytes);
  });

  it('saves a JPEG with the .jpg extension', async () => {
    const saved = await storage.save(
      image(jpeg(64), 'image/jpeg', 'photo.jpg'),
    );
    expect(saved.key).toMatch(/\.jpg$/);
  });

  it('gives the same bytes two different keys and two files', async () => {
    const bytes = png(32);
    const a = await storage.save(image(bytes, 'image/png'));
    const b = await storage.save(image(bytes, 'image/png'));
    expect(a.key).not.toBe(b.key);
    expect(await readdir(t.uploadDir)).toHaveLength(2);
  });

  it.each(['save', 'copy'] as const)(
    'cleans up a partially written %s without changing existing files',
    async (operation) => {
      const bytes = png(32);
      const original = await storage.save(image(bytes, 'image/png'));
      fault.partialWrite = true;
      const pending =
        operation === 'save'
          ? storage.save(image(bytes, 'image/png'))
          : storage.copy(original.key);
      await expect(pending).rejects.toBe(fault.writeError);
      expect(await readdir(t.uploadDir)).toEqual([original.key]);
      expect(await readFile(join(t.uploadDir, original.key))).toEqual(bytes);
    },
  );

  it('does not remove an existing file when a generated key collides', async () => {
    fault.key = '11111111-1111-4111-8111-111111111111';
    const bytes = png(32);
    const original = await storage.save(image(bytes, 'image/png'));
    await expect(
      storage.save(image(png(64), 'image/png')),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readdir(t.uploadDir)).toEqual([original.key]);
    expect(await readFile(join(t.uploadDir, original.key))).toEqual(bytes);
  });

  it('surfaces both write and cleanup errors if a partial file cannot be removed', async () => {
    fault.partialWrite = true;
    fault.cleanup = true;
    await expect(
      storage.save(image(png(32), 'image/png')),
    ).rejects.toMatchObject({
      errors: [fault.writeError, fault.cleanupError],
    });
  });

  it('accepts exactly 5 MB and rejects 5 MB + 1 and an empty file', async () => {
    const ok = await storage.save(image(png(MAX_IMAGE_BYTES), 'image/png'));
    const tooBig = await rejection(
      storage.save(image(png(MAX_IMAGE_BYTES + 1), 'image/png')),
    );
    const empty = await rejection(
      storage.save(image(Buffer.alloc(0), 'image/png')),
    );
    for (const error of [tooBig, empty]) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        details: { field: string }[];
      };
      expect(response.details[0]?.field).toBe('file');
    }
    expect(await readdir(t.uploadDir)).toEqual([ok.key]);
  });

  it('rejects a wrong type or wrong content and writes nothing', async () => {
    const attempts = [
      image(png(16), 'image/gif', 'a.gif'),
      image(jpeg(16), 'image/png'),
      image(Buffer.from('MZ this is not an image'), 'image/png'),
    ];
    for (const file of attempts) {
      expect(await rejection(storage.save(file))).toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(await readdir(t.uploadDir)).toEqual([]);
  });

  it('rejects a missing file with "an image file is required"', async () => {
    const error = await rejection(
      storage.save(undefined as unknown as UploadedImage),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as {
      details: { field: string; message: string }[];
    };
    expect(response.details[0]).toEqual({
      field: 'file',
      message: 'an image file is required',
    });
  });

  it('deletes the file; deleting again or a never-saved key resolves', async () => {
    const saved = await storage.save(image(png(16), 'image/png'));
    await storage.delete(saved.key);
    expect(existsSync(join(t.uploadDir, saved.key))).toBe(false);
    expect((await served(saved.key)).status).toBe(404);
    await expect(storage.delete(saved.key)).resolves.toBeUndefined();
    await expect(storage.delete('never-saved.png')).resolves.toBeUndefined();
  });

  it('never deletes outside the upload folder', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    try {
      const sentinel = join(outside, 'sentinel.png');
      await writeFile(sentinel, png(16));
      await mkdir(join(t.uploadDir, 'a'));
      await writeFile(join(t.uploadDir, 'a', 'b.png'), png(16));
      const keys = [
        `../${basename(outside)}/sentinel.png`,
        `../../${basename(outside)}/sentinel.png`,
        'a/b.png',
        '',
        'x.gif',
      ];
      for (const key of keys) {
        await expect(storage.delete(key)).resolves.toBeUndefined();
      }
      expect(existsSync(sentinel)).toBe(true);
      expect(existsSync(join(t.uploadDir, 'a', 'b.png'))).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('copies a file under a new key; the copy outlives the original', async () => {
    const bytes = jpeg(48);
    const original = await storage.save(image(bytes, 'image/jpeg', 'a.jpg'));
    const copy = await storage.copy(original.key);
    expect(copy.key).not.toBe(original.key);
    expect(copy.key).toMatch(/\.jpg$/);
    expect(await readFile(join(t.uploadDir, copy.key))).toEqual(bytes);
    await storage.delete(original.key);
    expect(existsSync(join(t.uploadDir, copy.key))).toBe(true);
    expect((await served(copy.key)).status).toBe(200);
  });

  it('fails to copy a never-saved key or an invalid key with 404 NOT_FOUND', async () => {
    for (const key of ['never-saved.png', '../x.png']) {
      const error = await rejection(storage.copy(key));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(
        (error as NotFoundException).getResponse() as { code: string },
      ).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('saves 20 files in parallel under 20 distinct keys', async () => {
    const saved = await Promise.all(
      Array.from({ length: 20 }, () =>
        storage.save(image(png(16), 'image/png')),
      ),
    );
    expect(new Set(saved.map((s) => s.key)).size).toBe(20);
    expect(await readdir(t.uploadDir)).toHaveLength(20);
  });

  it('urlOf builds /uploads/<key>', () => {
    expect(storage.urlOf('a.png')).toBe('/uploads/a.png');
  });
});
