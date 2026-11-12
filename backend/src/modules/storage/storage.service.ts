import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Types } from 'mongoose';
import type { UploadedImage } from './image-rules.js';

/** The ImageRef subdocument to store on a document (GEN-08). */
export interface StoredImage {
  _id: Types.ObjectId;
  key: string;
}

@Injectable()
export class StorageService {
  /** Validates (assertImageAllowed) and saves the file under a random key (GEN-08). Implemented in GEN-08. */
  save(file: UploadedImage): Promise<StoredImage> {
    void file;
    throw new NotImplementedException('save: implemented in GEN-08');
  }

  /** Deletes the file; a missing file is not an error (GEN-08). Implemented in GEN-08. */
  delete(key: string): Promise<void> {
    void key;
    throw new NotImplementedException('delete: implemented in GEN-08');
  }

  /** Copies the file under a new key, for itinerary clones (ITN-21, GEN-08). Implemented in GEN-08. */
  copy(key: string): Promise<StoredImage> {
    void key;
    throw new NotImplementedException('copy: implemented in GEN-08');
  }

  /** The public URL: `/uploads/<key>`. Never stored (GEN-08). */
  urlOf(key: string): string {
    return `/uploads/${key}`;
  }
}
