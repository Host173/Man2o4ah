import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, QueryFilter } from 'mongoose';
import { paginate } from '../../common/pagination/paginate.js';
import type { PaginationQueryDto } from '../../common/pagination/pagination-query.dto.js';
import { keywordRegex } from '../../common/text/escape-regex.js';
import type {
  ListAirportsQueryDto,
  ListAttractionsQueryDto,
  ListCitiesQueryDto,
  SearchReferenceQueryDto,
} from './dto/reference-data-query.dto.js';
import { Airport } from './schemas/airport.schema.js';
import { Attraction } from './schemas/attraction.schema.js';
import { City } from './schemas/city.schema.js';
import { Country } from './schemas/country.schema.js';
import { Currency } from './schemas/currency.schema.js';

const BY_NAME = { name: 1, _id: 1 } as const;

/**
 * The public, paginated lists behind `ReferenceDataController` (GEN-12,
 * FLT-02, GEN-05). Internal to this module; other modules use
 * `ReferenceDataService`.
 */
@Injectable()
export class ReferenceDataListsService {
  constructor(
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(City.name) private readonly cities: Model<City>,
    @InjectModel(Country.name) private readonly countries: Model<Country>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<Attraction>,
  ) {}

  listCountries({ q, ...page }: SearchReferenceQueryDto) {
    const filter: QueryFilter<Country> = {};
    if (q) filter.name = keywordRegex(q);
    return paginate(this.countries, filter, page, { sort: BY_NAME });
  }

  listCities({ q, countryCode, ...page }: ListCitiesQueryDto) {
    const filter: QueryFilter<City> = {};
    if (q) filter.name = keywordRegex(q);
    if (countryCode) filter.countryCode = countryCode;
    return paginate(this.cities, filter, page, { sort: BY_NAME });
  }

  listAirports({ q, countryCode, cityId, ...page }: ListAirportsQueryDto) {
    const filter: QueryFilter<Airport> = {};
    if (q) filter.$or = [{ _id: keywordRegex(q) }, { name: keywordRegex(q) }];
    if (countryCode) filter.countryCode = countryCode;
    if (cityId) filter.cityId = cityId;
    return paginate(this.airports, filter, page, { sort: { _id: 1 } });
  }

  listCurrencies(page: PaginationQueryDto) {
    return paginate(this.currencies, {}, page, { sort: { _id: 1 } });
  }

  listAttractions({ q, cityId, ...page }: ListAttractionsQueryDto) {
    const filter: QueryFilter<Attraction> = {};
    if (q) filter.name = keywordRegex(q);
    if (cityId) filter.cityId = cityId;
    return paginate(this.attractions, filter, page, { sort: BY_NAME });
  }
}
