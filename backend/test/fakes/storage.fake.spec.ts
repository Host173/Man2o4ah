import { FakeStorageService } from './storage.fake.js';

const png = (bytes = 'png-bytes') => {
  const buffer = Buffer.from(bytes);
  return {
    buffer,
    originalname: 'a.png',
    mimetype: 'image/png',
    size: buffer.length,
  };
};

describe('FakeStorageService', () => {
  it('saves under a random key with the right extension', async () => {
    const storage = new FakeStorageService();
    const stored = await storage.save(png());
    expect(stored.key).toMatch(/^[0-9a-f]{24}\.png$/);
    expect(storage.has(stored.key)).toBe(true);
    expect(storage.keys()).toEqual([stored.key]);
    expect(storage.urlOf(stored.key)).toBe(`/uploads/${stored.key}`);
    const jpeg = await storage.save({ ...png(), mimetype: 'image/jpeg' });
    expect(jpeg.key).toMatch(/\.jpg$/);
  });

  it('deletes a file, and a missing file is not an error', async () => {
    const storage = new FakeStorageService();
    const { key } = await storage.save(png());
    await storage.delete(key);
    expect(storage.has(key)).toBe(false);
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });

  it('copies a file under a new key with the same bytes', async () => {
    const storage = new FakeStorageService();
    const original = await storage.save(png('same bytes'));
    const copy = await storage.copy(original.key);
    expect(copy.key).not.toBe(original.key);
    expect(copy._id.toString()).not.toBe(original._id.toString());
    expect(storage.bytesOf(copy.key)?.toString()).toBe('same bytes');
  });

  it('answers 404 NOT_FOUND when copying an unknown key', async () => {
    await expect(
      new FakeStorageService().copy('nope.png'),
    ).rejects.toMatchObject({ status: 404, response: { code: 'NOT_FOUND' } });
  });

  it('rejects a GIF like the real rules do', async () => {
    const storage = new FakeStorageService();
    await expect(
      storage.save({ ...png(), mimetype: 'image/gif' }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'VALIDATION_FAILED' },
    });
    expect(storage.keys()).toEqual([]);
  });

  it.each([Buffer.from('not an image'), Buffer.from([0xff, 0xd8, 0xff, 0xd9])])(
    'rejects invalid PNG content like real storage does (%j)',
    async (buffer) => {
      const storage = new FakeStorageService();
      await expect(
        storage.save({ ...png(), buffer, size: buffer.length }),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: 'VALIDATION_FAILED',
          details: [{ field: 'file', message: expect.any(String) }],
        },
      });
      expect(storage.keys()).toEqual([]);
    },
  );
});
