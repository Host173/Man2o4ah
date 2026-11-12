import { NotImplementedException } from '@nestjs/common';
import { StorageService } from './storage.service.js';

describe('StorageService (stub)', () => {
  const service = new StorageService();

  it('save is not implemented yet (GEN-08)', () => {
    expect(() =>
      service.save({
        buffer: Buffer.from('x'),
        originalname: 'a.png',
        mimetype: 'image/png',
        size: 1,
      }),
    ).toThrow(NotImplementedException);
  });

  it('delete is not implemented yet (GEN-08)', () => {
    expect(() => service.delete('a.png')).toThrow(NotImplementedException);
  });

  it('copy is not implemented yet (GEN-08)', () => {
    expect(() => service.copy('a.png')).toThrow(NotImplementedException);
  });

  it('urlOf builds /uploads/<key>', () => {
    expect(service.urlOf('a.png')).toBe('/uploads/a.png');
  });
});
