import type { Schema } from 'mongoose';
import { ALL_SCHEMAS } from '../support/all-schemas.js';

/**
 * Paths that are free-form on purpose. Anything else being `Mixed` means a
 * `@Prop` type was not understood by @nestjs/mongoose (for example
 * `type: Types.ObjectId`), so the field is neither cast nor validated.
 */
const ALLOWED_MIXED = new Set(['audit_logs.details']);

interface SchemaPath {
  instance: string;
  options: { ref?: unknown };
  schema?: Schema;
}

function* walk(
  schema: Schema,
  prefix: string,
): Generator<{ path: string; type: SchemaPath }> {
  for (const [path, type] of Object.entries(
    schema.paths as Record<string, SchemaPath>,
  )) {
    yield { path: `${prefix}.${path}`, type };
    if (type.schema) yield* walk(type.schema, `${prefix}.${path}`);
  }
}

describe('schema path types', () => {
  it.each(Object.keys(ALL_SCHEMAS))(
    '%s has no untyped (Mixed) paths and no ref',
    (name) => {
      const mixed: string[] = [];
      const withRef: string[] = [];
      for (const { path, type } of walk(ALL_SCHEMAS[name], name)) {
        if (type.instance === 'Mixed' && !ALLOWED_MIXED.has(path)) {
          mixed.push(path);
        }
        if (type.options.ref !== undefined) withRef.push(path);
      }
      expect(mixed).toEqual([]);
      expect(withRef).toEqual([]);
    },
  );

  it('every path ending in "Id" is an ObjectId or a String, never Mixed', () => {
    const wrong: string[] = [];
    for (const name of Object.keys(ALL_SCHEMAS)) {
      for (const { path, type } of walk(ALL_SCHEMAS[name], name)) {
        const leaf = path.split('.').at(-1) ?? '';
        if (
          leaf.endsWith('Id') &&
          !['ObjectId', 'String'].includes(type.instance)
        ) {
          wrong.push(`${path}: ${type.instance}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
