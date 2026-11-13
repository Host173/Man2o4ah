import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { jwtAccessSecret } from './jwt-secret.js';

describe('jwtAccessSecret', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the configured secret without warning', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    expect(
      jwtAccessSecret(new ConfigService({ JWT_ACCESS_SECRET: 's3cret-value' })),
    ).toBe('s3cret-value');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['empty', { JWT_ACCESS_SECRET: '' }],
    ['blank', { JWT_ACCESS_SECRET: '   ' }],
  ])(
    'returns undefined when %s and warns, naming the variable',
    (_name, values) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      expect(jwtAccessSecret(new ConfigService(values))).toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('JWT_ACCESS_SECRET is not set'),
      );
    },
  );
});
