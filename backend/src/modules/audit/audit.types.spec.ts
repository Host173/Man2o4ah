import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuditLogQueryDto } from './audit.types.js';

async function check(query: Record<string, unknown>) {
  const dto = plainToInstance(AuditLogQueryDto, query);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('AuditLogQueryDto', () => {
  it('accepts no filter and keeps the pagination defaults', async () => {
    const { dto, errors } = await check({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
  });

  it('accepts an action of the enum', async () => {
    const { dto, errors } = await check({ action: 'account_suspended' });
    expect(errors).toHaveLength(0);
    expect(dto.action).toBe('account_suspended');
  });

  it('rejects an action that is not in the enum', async () => {
    const { errors } = await check({ action: 'nope' });
    expect(errors.map((error) => error.property)).toEqual(['action']);
  });

  it('converts from and to to dates', async () => {
    const { dto, errors } = await check({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T23:59:59.999Z',
    });
    expect(errors).toHaveLength(0);
    expect(dto.from).toEqual(new Date('2026-11-01T00:00:00.000Z'));
    expect(dto.to).toEqual(new Date('2026-11-30T23:59:59.999Z'));
  });

  it('rejects a date that is not a date', async () => {
    const { errors } = await check({ from: 'yesterday' });
    expect(errors.map((error) => error.property)).toEqual(['from']);
  });

  it('turns a from calendar day into the start of that UTC day', async () => {
    const { dto, errors } = await check({ from: '2026-11-01' });
    expect(errors).toHaveLength(0);
    expect(dto.from).toEqual(new Date('2026-11-01T00:00:00.000Z'));
  });

  it('turns a to calendar day into the last millisecond of that UTC day', async () => {
    const { dto, errors } = await check({ to: '2026-11-30' });
    expect(errors).toHaveLength(0);
    expect(dto.to).toEqual(new Date('2026-11-30T23:59:59.999Z'));
  });

  it('rejects a from day that does not exist', async () => {
    const { errors } = await check({ from: '2026-02-30' });
    expect(errors.map((error) => error.property)).toEqual(['from']);
  });

  it('rejects a to day that does not exist', async () => {
    const { errors } = await check({ to: '2026-13-01' });
    expect(errors.map((error) => error.property)).toEqual(['to']);
  });
});
