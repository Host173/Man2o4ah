import type { ConfigService } from '@nestjs/config';
import { FxRatesApiClient } from './fx-rates.client.js';

describe('FxRatesApiClient (ITN-18)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  const clientWith = (values: Record<string, string | undefined>) =>
    new FxRatesApiClient({
      get: (k: string) => values[k],
    } as unknown as ConfigService);

  const answer = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

  const requestedUrl = (): URL => {
    const [input] = fetchMock.mock.calls[0];
    // The adapter always calls fetch with a string URL.
    return new URL(typeof input === 'string' ? input : 'invalid:');
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])(
    'sends base and currencies and no api_key when the key is %s',
    async (_name, key) => {
      answer({ success: true, rates: { EGP: 50 } });
      await clientWith({ FXRATES_API_KEY: key }).fetchLatest('USD', [
        'EGP',
        'JPY',
      ]);
      const url = requestedUrl();
      expect(url.origin + url.pathname).toBe(
        'https://api.fxratesapi.com/latest',
      );
      expect(url.searchParams.get('base')).toBe('USD');
      expect(url.searchParams.get('currencies')).toBe('EGP,JPY');
      expect(url.searchParams.has('api_key')).toBe(false);
    },
  );

  it('sends api_key when the key is set', async () => {
    answer({ success: true, rates: { EGP: 50 } });
    await clientWith({ FXRATES_API_KEY: 'secret-key' }).fetchLatest('USD', [
      'EGP',
    ]);
    expect(requestedUrl().searchParams.get('api_key')).toBe('secret-key');
  });

  it('passes an abort signal (a timeout)', async () => {
    answer({ success: true, rates: { EGP: 50 } });
    await clientWith({}).fetchLatest('USD', ['EGP']);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns only the finite numeric rates', async () => {
    answer({ success: true, rates: { EGP: 50, JPY: 150, BAD: 'x' } });
    await expect(
      clientWith({}).fetchLatest('USD', ['EGP', 'JPY']),
    ).resolves.toEqual({ EGP: 50, JPY: 150 });
  });

  it('throws when the API answers with an error status', async () => {
    answer({}, 500);
    await expect(clientWith({}).fetchLatest('USD', ['EGP'])).rejects.toThrow(
      'FXRatesAPI answered 500',
    );
  });

  it('throws with the description when success is false', async () => {
    answer({
      success: false,
      error: 'invalid_api_key',
      description: 'Invalid key',
    });
    await expect(clientWith({}).fetchLatest('USD', ['EGP'])).rejects.toThrow(
      /Invalid key/,
    );
  });

  it.each([
    ['no rates', { success: true }],
    ['a body that is not an object', 'oops'],
  ])('throws on %s', async (_name, body) => {
    answer(body);
    await expect(clientWith({}).fetchLatest('USD', ['EGP'])).rejects.toThrow(
      /FXRatesAPI error/,
    );
  });

  it('rejects when fetch itself rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(clientWith({}).fetchLatest('USD', ['EGP'])).rejects.toThrow(
      'network down',
    );
  });

  it('never puts the key in an error message', async () => {
    const client = clientWith({ FXRATES_API_KEY: 'secret-key' });
    const failures: Array<() => void> = [
      () => answer({}, 500),
      () => answer({ success: false, description: 'Invalid key' }),
      () => answer({ success: true }),
    ];
    for (const arrange of failures) {
      fetchMock.mockReset();
      arrange();
      const error = await client.fetchLatest('USD', ['EGP']).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('secret-key');
    }
  });
});
