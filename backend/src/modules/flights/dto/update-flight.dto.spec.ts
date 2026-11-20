import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateFlightDto } from './update-flight.dto.js';

describe('UpdateFlightDto', () => {
  it('accepts airport codes and local date-times', async () => {
    const dto = plainToInstance(UpdateFlightDto, {
      departureAirportId: 'CAI',
      arrivalAirportId: 'DXB',
      departureLocal: '2027-03-14T03:30',
      arrivalLocal: '2027-03-14T10:00',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    ['departureAirportId', 'cai'],
    ['arrivalAirportId', 'DUBAI'],
    ['departureLocal', '2027-03-14 03:30'],
    ['arrivalLocal', '2027-03-14 10:00'],
  ])('rejects invalid %s: %p', async (field, value) => {
    const dto = plainToInstance(UpdateFlightDto, { [field]: value });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
