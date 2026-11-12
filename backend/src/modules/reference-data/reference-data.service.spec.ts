import { NotImplementedException } from '@nestjs/common';
import { ReferenceDataService } from './reference-data.service.js';

describe('ReferenceDataService (stub)', () => {
  const service = new ReferenceDataService();
  const calls: [string, () => unknown][] = [
    ['getAirport', () => service.getAirport('CAI')],
    ['getAirports', () => service.getAirports(['CAI'])],
    ['getCity', () => service.getCity('cairo')],
    ['getCities', () => service.getCities(['cairo'])],
    ['findCityIds', () => service.findCityIds('cai')],
    ['getCountry', () => service.getCountry('EG')],
    ['getCountries', () => service.getCountries(['EG'])],
    ['findCountryCodes', () => service.findCountryCodes('egy')],
    ['getCurrency', () => service.getCurrency('USD')],
    ['listCurrencies', () => service.listCurrencies()],
    ['listAttractions', () => service.listAttractions('cairo')],
  ];

  it.each(calls)('%s is not implemented yet (GEN-12)', (_name, call) => {
    expect(call).toThrow(NotImplementedException);
  });
});
