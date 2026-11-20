import { FakeFxService } from './fx.fake.js';

describe('FakeFxService', () => {
  it('converts 1000 USD minor to 50000 EGP minor', async () => {
    const result = await new FakeFxService().convert(1000, 'USD', 'EGP');
    expect(result).toEqual({ amountMinor: 50000, rateDate: '2026-11-01' });
  });

  it('converts 100 USD minor to 150 JPY (0 minor units)', async () => {
    const result = await new FakeFxService().convert(100, 'USD', 'JPY');
    expect(result.amountMinor).toBe(150);
  });

  it('rounds half up: 25 EGP minor is 0.5 USD minor, so 1', async () => {
    const fx = new FakeFxService();
    expect((await fx.convert(25, 'EGP', 'USD')).amountMinor).toBe(1);
    expect((await fx.convert(24, 'EGP', 'USD')).amountMinor).toBe(0);
    expect((await fx.convert(1, 'EGP', 'USD')).amountMinor).toBe(0);
  });

  it('answers 400 UNSUPPORTED_CURRENCY for an unknown code', async () => {
    const fx = new FakeFxService();
    await expect(fx.convert(100, 'USD', 'XXX')).rejects.toMatchObject({
      status: 400,
      response: { code: 'UNSUPPORTED_CURRENCY' },
    });
    await expect(fx.convert(100, 'XXX', 'USD')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('answers 503 RATES_UNAVAILABLE after setNoRates', async () => {
    const fx = new FakeFxService();
    fx.setNoRates();
    await expect(fx.getConverter()).rejects.toMatchObject({
      status: 503,
      response: { code: 'RATES_UNAVAILABLE' },
    });
    await expect(fx.convert(100, 'USD', 'EGP')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('getConverter carries the rate date and converts many amounts', async () => {
    const converter = await new FakeFxService().getConverter();
    expect(converter.rateDate).toBe('2026-11-01');
    expect(converter.convert(1000, 'USD', 'EGP')).toBe(50000);
    expect(converter.convert(200, 'USD', 'EUR')).toBe(180);
    expect(() => converter.convert(1, 'USD', 'XXX')).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it('accepts overrides', async () => {
    const fx = new FakeFxService({
      rates: { USD: 1, EGP: 10 },
      rateDate: '2026-12-01',
    });
    expect(await fx.convert(100, 'USD', 'EGP')).toEqual({
      amountMinor: 1000,
      rateDate: '2026-12-01',
    });
  });

  it('rounds an exact .5 half up with a non-integer rate, like the real converter', async () => {
    const fx = new FakeFxService({ rates: { USD: 1, XXX: 0.7 } });
    await expect(fx.convert(45, 'USD', 'XXX')).resolves.toMatchObject({
      amountMinor: 32,
    });
  });

  it('throws when the result is not a safe integer, like the real converter', async () => {
    await expect(
      new FakeFxService().convert(Number.MAX_SAFE_INTEGER, 'USD', 'EGP'),
    ).rejects.toThrow(Error);
  });
});
