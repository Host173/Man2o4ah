import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './change-password.dto.js';

const valid = { currentPassword: 'abcdefg1', newPassword: 'hijklmn2' };

/** Runs the same steps as the global ValidationPipe: transform, then validate. */
async function check(body: Record<string, unknown>) {
  const dto = plainToInstance(ChangePasswordDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('ChangePasswordDto (ACC-08, ACC-07a)', () => {
  it('accepts a valid body', async () => {
    expect(await check(valid)).toEqual([]);
  });

  describe('newPassword (the ACC-01 rule, 8 to 72 characters)', () => {
    it.each([
      ['7 characters', 'abcdef1'],
      ['73 characters', `${'a'.repeat(72)}1`],
      ['letters only', 'abcdefgh'],
      ['digits only', '12345678'],
      ['missing', undefined],
      ['not a string', 12345678],
    ])('rejects a new password that is %s', async (_case, newPassword) => {
      expect(await check({ ...valid, newPassword })).toEqual(['newPassword']);
    });

    it.each([
      ['8 characters', '1234567a'],
      ['72 characters', `${'a'.repeat(71)}1`],
    ])('accepts %s with a letter and a digit', async (_case, newPassword) => {
      expect(await check({ ...valid, newPassword })).toEqual([]);
    });
  });

  describe('currentPassword (any non-empty string)', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['not a string', 12345678],
    ])('rejects a current password that is %s', async (_case, value) => {
      expect(await check({ ...valid, currentPassword: value })).toEqual([
        'currentPassword',
      ]);
    });

    it.each([
      ['a temporary password outside the rule', 'temp'],
      ['one stored before the 72-character cap', `${'a'.repeat(80)}1`],
    ])('accepts %s', async (_case, currentPassword) => {
      expect(await check({ ...valid, currentPassword })).toEqual([]);
    });
  });

  it('accepts a new password equal to the current one: only the service knows about a forced change (ACC-07a)', async () => {
    expect(
      await check({ currentPassword: 'abcdefg1', newPassword: 'abcdefg1' }),
    ).toEqual([]);
  });

  it.each([['userId'], ['mustChangePassword'], ['passwordHash']])(
    'rejects a client-supplied %s field',
    async (field) => {
      expect(await check({ ...valid, [field]: 'x' })).toEqual([field]);
    },
  );
});
