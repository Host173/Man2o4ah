import { FakeReferenceDataService } from './reference-data.fake.js';

describe('FakeReferenceDataService', () => {
  const data = new FakeReferenceDataService();

  it('finds an airport by code, and returns null for an unknown one', async () => {
    expect((await data.getAirport('CAI'))?.timeZone).toBe('Africa/Cairo');
    expect(await data.getAirport('XXX')).toBeNull();
  });

  it('returns only the known airports of a bulk lookup', async () => {
    const airports = await data.getAirports(['CAI', 'XXX']);
    expect([...airports.keys()]).toEqual(['CAI']);
  });

  it('looks up cities, countries and currencies', async () => {
    expect(await data.getCity('dubai')).toMatchObject({ countryCode: 'AE' });
    expect(await data.getCity('nope')).toBeNull();
    expect([...(await data.getCities(['cairo', 'nope'])).keys()]).toEqual([
      'cairo',
    ]);
    expect(await data.getCountry('EG')).toMatchObject({ currency: 'EGP' });
    expect(await data.getCountry('XX')).toBeNull();
    expect([...(await data.getCountries(['US', 'XX'])).keys()]).toEqual(['US']);
    expect(await data.getCurrency('JPY')).toMatchObject({ minorUnits: 0 });
    expect(await data.getCurrency('XXX')).toBeNull();
  });

  it('finds city IDs by keyword, case-insensitive', async () => {
    expect(await data.findCityIds('CAI')).toEqual(['cairo']);
    expect(await data.findCityIds('york')).toEqual(['new-york']);
  });

  it('finds country codes by keyword', async () => {
    expect(await data.findCountryCodes('united')).toEqual(['AE', 'US']);
  });

  it('treats the keyword as text, not as a pattern', async () => {
    await expect(data.findCityIds('(')).resolves.toEqual([]);
    await expect(data.findCityIds('.*')).resolves.toEqual([]);
  });

  it('lists the currencies sorted by code', async () => {
    const codes = (await data.listCurrencies()).map((c) => c.code);
    expect(codes).toEqual(['AED', 'EGP', 'EUR', 'JPY', 'USD']);
  });

  it('lists the attractions of a city sorted by name', async () => {
    const names = (await data.listAttractions('cairo')).map((a) => a.name);
    expect(names).toEqual(['Egyptian Museum', 'Pyramids of Giza']);
    expect(await data.listAttractions('nope')).toEqual([]);
  });

  it('accepts a replacement dataset', async () => {
    const custom = new FakeReferenceDataService({
      cities: [{ id: 'paris', name: 'Paris', countryCode: 'FR' }],
    });
    expect(await custom.findCityIds('par')).toEqual(['paris']);
    expect(await custom.getCity('cairo')).toBeNull();
    expect(await custom.getAirport('CAI')).not.toBeNull();
  });
});
