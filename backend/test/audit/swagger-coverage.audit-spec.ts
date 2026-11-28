import { execSync } from 'node:child_process';
import type { OpenAPIObject } from '@nestjs/swagger';
import { CATALOG, ENDPOINTS } from './requirements-catalog.js';
import type { CatalogOperation } from './requirements-catalog.js';
import { createAuditApp, routeMeta } from './support/audit-app.js';
import type { AuditApp } from './support/audit-app.js';
import { writeOut } from './support/results.js';

interface CheckResult {
  check: string;
  subject: string;
  ok: boolean;
  detail: string;
}

type Operation = {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: unknown[];
  responses?: Record<
    string,
    { content?: Record<string, { schema?: unknown }> }
  >;
  requestBody?: unknown;
};

const HTTP = ['get', 'post', 'put', 'patch', 'delete'] as const;
const key = (o: CatalogOperation) => `${o.method} ${o.path}`;
const ignored = (path: string) =>
  path === '/api/health' || path.startsWith('/api/docs');

describe('TST-02 Swagger coverage', () => {
  let app: AuditApp;
  let doc: OpenAPIObject;
  const results: CheckResult[] = [];
  const add = (check: string, subject: string, ok: boolean, detail = '') =>
    results.push({ check, subject, ok, detail });

  beforeAll(async () => {
    app = await createAuditApp();
    doc = app.openApi();
  });
  afterAll(() => app?.t.close());

  it('covers every mandatory requirement and route', () => {
    const opOf = (o: CatalogOperation): Operation | undefined =>
      (doc.paths[o.path] as Record<string, Operation> | undefined)?.[
        o.method.toLowerCase()
      ];
    const docOps: { op: CatalogOperation; body: Operation }[] = [];
    for (const [path, item] of Object.entries(doc.paths)) {
      if (ignored(path)) continue;
      for (const verb of HTTP) {
        const body = (item as Record<string, Operation>)[verb];
        if (body)
          docOps.push({
            op: {
              method: verb.toUpperCase() as CatalogOperation['method'],
              path,
            },
            body,
          });
      }
    }

    // C1
    for (const e of ENDPOINTS)
      add('C1', key(e), opOf(e) !== undefined, opOf(e) ? '' : 'not in Swagger');

    // C2: extras are listed, not failures.
    const known = new Set(ENDPOINTS.map(key));
    for (const { op } of docOps)
      if (!known.has(key(op)))
        add('C2', key(op), true, 'extra: not in endpoints.md');

    // C3, C4, C5
    for (const entry of CATALOG.filter((c) => c.kind === 'api')) {
      add(
        'C3',
        entry.id,
        entry.operations.length > 0,
        entry.operations.length ? '' : 'no operation',
      );
      for (const o of entry.operations)
        add(
          'C4',
          `${entry.id} ${key(o)}`,
          opOf(o) !== undefined,
          opOf(o) ? '' : 'not in Swagger',
        );
      const word = new RegExp(`\\b${entry.id}\\b`);
      const naming = entry.operations.filter((o) => {
        const b = opOf(o);
        return b && word.test(`${b.summary ?? ''} ${b.description ?? ''}`);
      });
      add(
        'C5',
        entry.id,
        naming.length > 0,
        naming.length
          ? `named by ${naming.map(key).join(', ')}`
          : `none of ${entry.operations.map(key).join(', ')} names ${entry.id}`,
      );
    }

    // C6, C7
    const meta = routeMeta(app);
    for (const { op, body } of docOps) {
      const responses = body.responses ?? {};
      const problems: string[] = [];
      if (!body.summary) problems.push('no summary');
      if (!body.tags?.length) problems.push('no tags');
      const ok2xx = Object.entries(responses).some(
        ([code, r]) =>
          code === '204' ||
          (code.startsWith('2') &&
            Object.entries(r.content ?? {}).some(
              ([type, c]) => c.schema !== undefined || !type.includes('json'),
            )),
      );
      if (!ok2xx) problems.push('no 2xx response with a schema');
      add('C6', key(op), problems.length === 0, problems.join('; '));

      const m = meta.get(key(op));
      if (!m) {
        add('C7', key(op), false, 'route not found in controller metadata');
        continue;
      }
      if (m.isPublic) continue;
      const missing: string[] = [];
      if (!responses['401']) missing.push('401');
      if (m.roles.length && !responses['403']) missing.push('403');
      add(
        'C7',
        key(op),
        missing.length === 0,
        missing.length
          ? `protected${m.roles.length ? ` (roles ${m.roles.join(',')})` : ''} but no ${missing.join(', ')} documented`
          : '',
      );
    }

    // C8
    let stubs = '';
    try {
      stubs = execSync('git grep -n "implemented in [A-Z]\\+-[0-9]" -- src', {
        encoding: 'utf8',
      });
    } catch {
      stubs = ''; // git grep exits 1 when nothing matches
    }
    const hits = stubs.split('\n').filter(Boolean);
    if (hits.length === 0) add('C8', 'stubs', true);
    for (const hit of hits)
      add('C8', hit.split(':').slice(0, 2).join(':'), false, hit);

    writeOut('coverage.json', results);
    const failures = results.filter((r) => !r.ok);
    expect(failures, `${failures.length} coverage failures`).toEqual([]);
  });
});
