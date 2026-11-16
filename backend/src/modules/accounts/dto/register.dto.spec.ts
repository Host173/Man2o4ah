import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto.js';

const valid = {
  name: 'Aisha',
  email: 'aisha@example.com',
  password: 'abcdefg1',
  acceptTerms: true,
};

/** Runs the same steps as the global ValidationPipe: transform, then validate. */
async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(RegisterDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, failed: errors.map((e) => e.property) };
}

describe('RegisterDto (ACC-01)', () => {
  it('accepts a valid body', async () => {
    const { failed } = await check(valid);
    expect(failed).toEqual([]);
  });

  it('trims the name and trims and lowercases the email', async () => {
    const { dto, failed } = await check({
      ...valid,
      name: '  Aisha  ',
      email: '  Aisha@Example.COM ',
    });
    expect(failed).toEqual([]);
    expect(dto.name).toBe('Aisha');
    expect(dto.email).toBe('aisha@example.com');
  });

  describe('name (1-100 characters after trimming)', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['only spaces', '   '],
      ['101 characters', 'a'.repeat(101)],
      ['not a string', 42],
    ])('rejects a name that is %s', async (_case, name) => {
      const { failed } = await check({ ...valid, name });
      expect(failed).toEqual(['name']);
    });

    it.each([
      ['1 character', 'A'],
      ['100 characters', 'a'.repeat(100)],
    ])('accepts a name of %s', async (_case, name) => {
      const { failed } = await check({ ...valid, name });
      expect(failed).toEqual([]);
    });
  });

  describe('email', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['without @', 'aisha.example.com'],
      ['without a domain', 'aisha@'],
      ['without a top-level domain', 'aisha@example'],
      ['with a space', 'ai sha@example.com'],
      ['not a string', 42],
    ])('rejects an email that is %s', async (_case, email) => {
      const { failed } = await check({ ...valid, email });
      expect(failed).toEqual(['email']);
    });
  });

  describe('password (the ACC-01 rule)', () => {
    it.each([
      ['7 characters', 'abcdef1'],
      ['letters only', 'abcdefgh'],
      ['digits only', '12345678'],
      ['missing', undefined],
      ['not a string', 12345678],
    ])('rejects a password that is %s', async (_case, password) => {
      const { failed } = await check({ ...valid, password });
      expect(failed).toEqual(['password']);
    });

    it('accepts 8 characters with a letter and a digit', async () => {
      const { failed } = await check({ ...valid, password: '1234567a' });
      expect(failed).toEqual([]);
    });
  });

  describe('acceptTerms (mandatory consent)', () => {
    it.each([
      ['missing', undefined],
      ['false', false],
      ['the string "true"', 'true'],
      ['1', 1],
    ])('rejects consent that is %s', async (_case, acceptTerms) => {
      const { failed } = await check({ ...valid, acceptTerms });
      expect(failed).toEqual(['acceptTerms']);
    });
  });

  it.each([['role'], ['status'], ['passwordHash'], ['termsAcceptedAt']])(
    'rejects a client-supplied %s field',
    async (field) => {
      const { failed } = await check({ ...valid, [field]: 'x' });
      expect(failed).toEqual([field]);
    },
  );
});
