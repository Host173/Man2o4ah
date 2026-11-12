import { NotImplementedException } from '@nestjs/common';
import { FxService } from './fx.service.js';

describe('FxService (stub)', () => {
  const service = new FxService();

  it('getConverter is not implemented yet (ITN-18)', () => {
    expect(() => service.getConverter()).toThrow(NotImplementedException);
  });

  it('convert is not implemented yet (ITN-18)', () => {
    expect(() => service.convert(100, 'USD', 'EGP')).toThrow(
      NotImplementedException,
    );
  });
});
