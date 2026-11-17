import { NotImplementedException } from '@nestjs/common';
import { ItinerariesService } from './itineraries.service.js';

describe('itineraries contract (stubs)', () => {
  // The stub throws before touching either dependency.
  const itineraries = new ItinerariesService(null as never, null as never);

  it('listPublicByAuthor fails explicitly until ITN-20 implements it', () => {
    expect(() => itineraries.listPublicByAuthor('user-1')).toThrow(
      NotImplementedException,
    );
  });
});
