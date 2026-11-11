import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto } from './pagination-query.dto.js';

async function check(query: Record<string, unknown>) {
  const dto = plainToInstance(PaginationQueryDto, query);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('PaginationQueryDto', () => {
  it('defaults to page 1 and limit 10', async () => {
    const { dto, errors } = await check({});
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
  });

  it('turns a query string number into a number', async () => {
    const { dto, errors } = await check({ page: '2' });
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
  });

  it('accepts limit 50 and rejects 51', async () => {
    expect((await check({ limit: '50' })).errors).toHaveLength(0);
    expect((await check({ limit: '51' })).errors).toHaveLength(1);
  });

  it('rejects page 0 and limit 0', async () => {
    expect((await check({ page: '0' })).errors).toHaveLength(1);
    expect((await check({ limit: '0' })).errors).toHaveLength(1);
  });

  it('rejects text', async () => {
    expect((await check({ page: 'abc' })).errors).toHaveLength(1);
    expect((await check({ limit: 'abc' })).errors).toHaveLength(1);
  });
});
