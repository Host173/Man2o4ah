import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ErrorCode } from '../../src/common/errors/error-codes.js';
import {
  ALLOWED_IMAGE_TYPES,
  assertImageAllowed,
} from '../../src/modules/storage/image-rules.js';
import type { UploadedImage } from '../../src/modules/storage/image-rules.js';
import type {
  StorageService,
  StoredImage,
} from '../../src/modules/storage/storage.service.js';
import type { PublicApi } from './public-api.js';

/**
 * A working `StorageService` that keeps the files in memory and applies the real image rules.
 * It does not check the file's real content (magic bytes), so tests may use any bytes.
 */
export class FakeStorageService implements PublicApi<StorageService> {
  private readonly files = new Map<string, Buffer>();

  // save and copy are async so a rejected image or an unknown key rejects the promise.
  async save(file: UploadedImage): Promise<StoredImage> {
    assertImageAllowed(file);
    const extension =
      ALLOWED_IMAGE_TYPES[file.mimetype as keyof typeof ALLOWED_IMAGE_TYPES];
    return this.store(file.buffer, extension);
  }

  delete(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }

  async copy(key: string): Promise<StoredImage> {
    const bytes = this.files.get(key);
    if (!bytes) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: 'File not found',
      });
    }
    return this.store(bytes, key.split('.').pop() ?? 'jpg');
  }

  urlOf(key: string): string {
    return `/uploads/${key}`;
  }

  /** Whether a file is stored under `key`. */
  has(key: string): boolean {
    return this.files.has(key);
  }

  /** Every stored key. */
  keys(): string[] {
    return [...this.files.keys()];
  }

  /** The stored bytes of `key`, if any. */
  bytesOf(key: string): Buffer | undefined {
    return this.files.get(key);
  }

  private store(bytes: Buffer, extension: string): StoredImage {
    const key = `${new Types.ObjectId().toHexString()}.${extension}`;
    this.files.set(key, Buffer.from(bytes));
    return { _id: new Types.ObjectId(), key };
  }
}
