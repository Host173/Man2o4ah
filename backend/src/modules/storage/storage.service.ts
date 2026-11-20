import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { ErrorCode } from '../../common/errors/error-codes.js';
import {
  ALLOWED_IMAGE_TYPES,
  assertImageAllowed,
  assertImageContent,
} from './image-rules.js';
import type { UploadedImage } from './image-rules.js';

/** The ImageRef subdocument to store on a document (GEN-08). */
export interface StoredImage {
  _id: Types.ObjectId;
  key: string;
}

/** Keys this service creates: a random name plus `.jpg` or `.png`. Anything else (`../x.png`, `a/b.png`) is never a stored file. */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|png)$/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function fileNotFound(): NotFoundException {
  return new NotFoundException({
    code: ErrorCode.NotFound,
    message: 'File not found',
  });
}

/** Stores images as files in the upload folder, served under `/uploads/<key>` (GEN-08). */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly dir: string;

  constructor(config: ConfigService) {
    this.dir = resolve(config.get<string>('UPLOAD_DIR') ?? 'uploads');
  }

  /** Validates type, size and real content, then saves the file under a random key (GEN-08). */
  async save(file: UploadedImage): Promise<StoredImage> {
    assertImageAllowed(file);
    assertImageContent(file);
    const extension =
      ALLOWED_IMAGE_TYPES[file.mimetype as keyof typeof ALLOWED_IMAGE_TYPES];
    return this.write(file.buffer, extension);
  }

  /** Deletes the file; a missing file is not an error (GEN-08). */
  async delete(key: string): Promise<void> {
    if (!KEY_PATTERN.test(key)) {
      this.logger.warn(
        `Ignored delete of an invalid image key: ${key.slice(0, 100)}`,
      );
      return;
    }
    try {
      await unlink(join(this.dir, key));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  /** Copies the file under a new key, for itinerary clones (ITN-21, GEN-08). */
  async copy(key: string): Promise<StoredImage> {
    if (!KEY_PATTERN.test(key)) throw fileNotFound();
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.dir, key));
    } catch (error) {
      if (isNotFound(error)) throw fileNotFound();
      throw error;
    }
    return this.write(bytes, extname(key).slice(1));
  }

  /** The public URL: `/uploads/<key>`. Never stored (GEN-08). */
  urlOf(key: string): string {
    return `/uploads/${key}`;
  }

  private async write(bytes: Buffer, extension: string): Promise<StoredImage> {
    await mkdir(this.dir, { recursive: true });
    const key = `${randomUUID()}.${extension}`;
    const path = join(this.dir, key);
    const handle = await open(path, 'wx');
    try {
      // Disposal closes the owned file before cleanup, including on Windows.
      await using file = handle;
      await writeFile(file, bytes);
    } catch (error) {
      try {
        await unlink(path);
      } catch (cleanupError) {
        if (!isNotFound(cleanupError)) {
          throw new AggregateError(
            [error, cleanupError],
            'Image write and cleanup failed',
          );
        }
      }
      throw error;
    }
    return { _id: new Types.ObjectId(), key };
  }
}
