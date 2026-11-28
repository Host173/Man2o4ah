/** TST-02 smoke audit: typed accessors for untyped JSON bodies, and shared types. */

export type Who =
  'guest' | 'user' | 'otherUser' | 'admin' | 'airlineMod' | 'hotelMod';
export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Expected = number | number[] | { not: number };

export interface Res {
  status: number;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
}

export interface Upload {
  field: string;
  data: Buffer;
  filename: string;
  contentType: string;
}

type Lazy<T> = T | (() => T | Promise<T>);

export interface Probe {
  requirement: string;
  name: string;
  as: Who;
  method: Method;
  path: Lazy<string>;
  body?: Lazy<unknown>;
  file?: Upload;
  /** Sends as someone other than `as` (a throwaway account): their cookie. */
  cookie?: () => string;
  expect: Expected;
  check?: (res: Res) => string | null | Promise<string | null>;
  /** A request the generic sender cannot make (signed webhook, login). */
  run?: () => Promise<Res>;
}

export interface Row {
  requirement: string;
  probe: string;
  method: string;
  path: string;
  as: string;
  expected: Expected;
  got: number | null;
  code: string | null;
  message: string | null;
  ok: boolean;
}

export async function resolve<T>(value: Lazy<T>): Promise<T> {
  return typeof value === 'function'
    ? await (value as () => T | Promise<T>)()
    : value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `get(body, 'a.0.b')`: the value at a dotted path, or undefined. */
export function get(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current)) current = current[Number(part)] as unknown;
    else if (isRecord(current)) current = current[part];
    else return undefined;
  }
  return current;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/** The rows of a list answer: a bare array or a page's `items`. */
export function items(body: unknown): unknown[] {
  return Array.isArray(body) ? (body as unknown[]) : arr(get(body, 'items'));
}

export function idOf(value: unknown): string | undefined {
  return str(get(value, '_id')) ?? str(get(value, 'id'));
}

export function matches(expected: Expected, status: number): boolean {
  if (typeof expected === 'number') return status === expected;
  if (Array.isArray(expected)) return expected.includes(status);
  return status !== expected.not;
}

export function setCookies(res: Res): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
}

/** `access_token=…; refresh_token=…` from a login answer. */
export function cookieOf(res: Res): string {
  return setCookies(res)
    .map((line) => line.split(';')[0] ?? '')
    .filter((pair) => !pair.endsWith('='))
    .join('; ');
}

/** The first failing message of a list of [ok, message] pairs. */
export function all(...checks: [boolean, string][]): string | null {
  const failed = checks.find(([ok]) => !ok);
  return failed ? failed[1] : null;
}
