import mongoose from 'mongoose';
import type { Connection } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Pass as the timeout of beforeAll/afterAll: the first run downloads the
 * MongoDB binary, which can take minutes.
 */
export const HOOK_TIMEOUT = 300_000;

export interface MemoryMongo {
  /** Connection URI of the in-memory replica set (no database name). */
  uri: string;
  stop: () => Promise<void>;
}

/**
 * Starts a one-node in-memory replica set on WiredTiger (required for
 * transactions). Tests never read MONGODB_URI and never touch Atlas.
 */
export async function startMemoryMongo(): Promise<MemoryMongo> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  return {
    uri: replSet.getUri(),
    stop: async () => {
      await replSet.stop();
    },
  };
}

export interface TestDatabase {
  connection: Connection;
  /** Closes the connection and stops the in-memory server. */
  stop: () => Promise<void>;
}

/** Starts the memory replica set and opens a Mongoose connection to it. */
export async function startTestDatabase(
  dbName = 'test',
): Promise<TestDatabase> {
  const mongo = await startMemoryMongo();
  const connection = await mongoose
    .createConnection(mongo.uri, { dbName })
    .asPromise();
  return {
    connection,
    stop: async () => {
      await connection.close();
      await mongo.stop();
    },
  };
}
