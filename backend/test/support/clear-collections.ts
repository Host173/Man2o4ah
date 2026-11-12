import type { Connection } from 'mongoose';

/**
 * Deletes every document of every collection of the connection, in parallel.
 * Collections are not dropped, so their indexes stay.
 */
export async function clearCollections(connection: Connection): Promise<void> {
  const db = connection.db;
  if (!db) throw new Error('clearCollections: the connection is not open.');
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  await Promise.all(
    collections
      .filter(({ name }) => !name.startsWith('system.'))
      .map(({ name }) => db.collection(name).deleteMany({})),
  );
}
