import { vi } from 'vitest';
import { createDemoApi } from './demo-api.js';

function jsonResponse(
  status: number,
  body: unknown,
  cookies: string[] = [],
): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers,
  });
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

function cookieOf(
  stub: ReturnType<typeof vi.fn<typeof fetch>>,
  call: number,
): string | undefined {
  return headersOf(stub.mock.calls[call]?.[1]).Cookie;
}

describe('demo API client (PLT-08)', () => {
  it('captures cookies from a login and sends them on the next call', async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, { user: {} }, [
          'access_token=abc; Path=/; HttpOnly; Secure',
          'refresh_token=def; Path=/; HttpOnly',
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const api = createDemoApi('http://h/api', fetchStub);

    await api.login('a@example.com', 'x');
    await api.get('/auth/me');

    expect(cookieOf(fetchStub, 1)).toBe('access_token=abc; refresh_token=def');
  });

  it('sends a JSON body with its header and returns non-2xx responses', async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(409, { code: 'CONFLICT' }));
    const api = createDemoApi('http://h/api', fetchStub);

    const result = await api.post('/airlines', { code: 'NA' });

    expect(result).toEqual({ status: 409, body: { code: 'CONFLICT' } });
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe('http://h/api/airlines');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"code":"NA"}');
    expect(headersOf(init)['Content-Type']).toBe('application/json');
  });

  it('replaces a refreshed cookie and drops a cleared one', async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {}, ['access_token=one; Path=/']),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {}, ['access_token=two; Path=/']),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {}, ['access_token=; Max-Age=0; Path=/']),
      )
      .mockResolvedValueOnce(jsonResponse(200, {}));
    const api = createDemoApi('http://h/api', fetchStub);

    await api.get('/a');
    await api.get('/b');
    await api.get('/c');
    await api.get('/d');

    expect(cookieOf(fetchStub, 1)).toBe('access_token=one');
    expect(cookieOf(fetchStub, 2)).toBe('access_token=two');
    expect(cookieOf(fetchStub, 3)).toBeUndefined();
  });

  it('forks a client with its own empty cookie jar', async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {}, ['access_token=one; Path=/']),
      )
      .mockResolvedValueOnce(jsonResponse(200, {}));
    const api = createDemoApi('http://h/api', fetchStub);
    await api.get('/a');

    await api.fork().get('/b');

    expect(cookieOf(fetchStub, 1)).toBeUndefined();
  });

  it('returns an undefined body when the response is empty or not JSON', async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('oops', { status: 502 }));
    const api = createDemoApi('http://h/api', fetchStub);

    expect(await api.patch('/x', {})).toEqual({
      status: 204,
      body: undefined,
    });
    expect(await api.put('/y')).toEqual({ status: 502, body: undefined });
  });
});
