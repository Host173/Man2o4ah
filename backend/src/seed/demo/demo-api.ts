export interface ApiResponse {
  status: number;
  /** The parsed JSON body, or `undefined` when the response had none. */
  body: unknown;
}

/**
 * A tiny HTTP client for one actor (PLT-08): it keeps that actor's cookies,
 * so a login stays valid for the calls after it. Non-2xx responses are
 * returned, never thrown; the seed decides what an unexpected status means.
 */
export interface DemoApi {
  login(email: string, password: string): Promise<ApiResponse>;
  get(path: string): Promise<ApiResponse>;
  post(path: string, body?: unknown): Promise<ApiResponse>;
  put(path: string, body?: unknown): Promise<ApiResponse>;
  patch(path: string, body?: unknown): Promise<ApiResponse>;
  /** A new client for the same server with an empty cookie jar (another actor). */
  fork(): DemoApi;
}

export type FetchFunction = typeof fetch;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

/** `name=value` of a `Set-Cookie` header, and whether it clears the cookie. */
function parseSetCookie(
  header: string,
): { name: string; value: string; cleared: boolean } | null {
  const [pair = '', ...attributes] = header.split(';');
  const separator = pair.indexOf('=');
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  const expired = attributes.some((attribute) => {
    const [key = '', attributeValue = ''] = attribute.split('=');
    const lowerKey = key.trim().toLowerCase();
    return (
      (lowerKey === 'max-age' && Number(attributeValue.trim()) <= 0) ||
      (lowerKey === 'expires' &&
        Date.parse(attributeValue.trim()) <= Date.now())
    );
  });
  return { name, value, cleared: value === '' || expired };
}

/** `baseUrl` is the API root, e.g. `http://127.0.0.1:4000/api`. */
export function createDemoApi(
  baseUrl: string,
  fetchFunction: FetchFunction = fetch,
): DemoApi {
  const jar = new Map<string, string>();

  async function send(
    method: Method,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (jar.size > 0) {
      headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchFunction(`${baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const header of response.headers.getSetCookie()) {
      const cookie = parseSetCookie(header);
      if (!cookie) continue;
      if (cookie.cleared) jar.delete(cookie.name);
      else jar.set(cookie.name, cookie.value);
    }
    const text = await response.text();
    let parsed: unknown;
    if (text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    return { status: response.status, body: parsed };
  }

  return {
    login: (email, password) =>
      send('POST', '/auth/login', { email, password }),
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
    put: (path, body) => send('PUT', path, body),
    patch: (path, body) => send('PATCH', path, body),
    fork: () => createDemoApi(baseUrl, fetchFunction),
  };
}
