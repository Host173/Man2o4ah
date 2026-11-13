import { FakeReportableContent } from '../../../../test/fakes/reportable-content.fake.js';
import type { ReportableContent } from './reportable-content.port.js';
import { ReportTargetType } from './reportable-content.port.js';
import { ReportableContentRegistry } from './reportable-content.registry.js';

describe('ReportableContentRegistry', () => {
  it('registers and resolves providers for every ReportTargetType', () => {
    const registry = new ReportableContentRegistry();
    const posts = new FakeReportableContent(ReportTargetType.POST);
    const comments = new FakeReportableContent(ReportTargetType.COMMENT);
    const reviews = new FakeReportableContent(ReportTargetType.REVIEW);
    const itineraries = new FakeReportableContent(ReportTargetType.ITINERARY);

    registry.register(posts);
    registry.register(comments);
    registry.register(reviews);
    registry.register(itineraries);

    expect(registry.get(ReportTargetType.POST)).toBe(posts);
    expect(registry.get(ReportTargetType.COMMENT)).toBe(comments);
    expect(registry.get(ReportTargetType.REVIEW)).toBe(reviews);
    expect(registry.get(ReportTargetType.ITINERARY)).toBe(itineraries);
  });

  it('refuses duplicate registration for the same content type', () => {
    const registry = new ReportableContentRegistry();
    registry.register(new FakeReportableContent(ReportTargetType.POST));

    expect(() =>
      registry.register(new FakeReportableContent(ReportTargetType.POST)),
    ).toThrow(/post.*already registered/);
  });

  it('throws, naming the type, when looking up an unregistered content type', () => {
    const registry = new ReportableContentRegistry();
    registry.register(new FakeReportableContent(ReportTargetType.POST));

    expect(() => registry.get(ReportTargetType.REVIEW)).toThrow(/review/);
  });

  it('throws when looking up or registering an unknown runtime content type', () => {
    const registry = new ReportableContentRegistry();
    const unknownType = 'flight' as unknown as ReportTargetType;

    expect(() => registry.get(unknownType)).toThrow(/flight/);

    const invalidProvider: ReportableContent = {
      targetType: unknownType,
      exists: () => Promise.resolve(false),
      hide: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    expect(() => registry.register(invalidProvider)).toThrow(/flight/);
  });
});

