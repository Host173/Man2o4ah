import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddActivityDto } from './add-activity.dto.js';
import { UpdateActivityDto } from './update-activity.dto.js';

describe('activity payload validation (ITN-10)', () => {
  it('validates a zero minor-unit cost and trims the name before checking its length', async () => {
    const dto = plainToInstance(AddActivityDto, {
      name: `  ${'N'.repeat(100)}  `,
      cost: { amountMinor: 0, currency: 'USD' },
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.name).toBe('N'.repeat(100));
  });

  it('accepts an empty update but rejects null rather than treating it as omission', async () => {
    expect(await validate(plainToInstance(UpdateActivityDto, {}))).toHaveLength(
      0,
    );
    const errors = await validate(
      plainToInstance(UpdateActivityDto, {
        name: null,
        description: null,
        time: null,
        cost: null,
      }),
    );
    expect(errors.map((error) => error.property).sort()).toEqual([
      'cost',
      'description',
      'name',
      'time',
    ]);
  });
});
