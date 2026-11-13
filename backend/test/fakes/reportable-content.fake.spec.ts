import type { ReportableContent } from '../../src/modules/moderation/ports/reportable-content.port.js';
import { ReportTargetType } from '../../src/modules/moderation/ports/reportable-content.port.js';
import { FakeReportableContent } from './reportable-content.fake.js';

describe('FakeReportableContent', () => {
  it('satisfies the ReportableContent contract and exposes its targetType', () => {
    const fake = new FakeReportableContent(ReportTargetType.POST, ['post-1']);
    const port: ReportableContent = fake;

    expect(port.targetType).toBe(ReportTargetType.POST);
    expectTypeOf(fake).toMatchTypeOf<ReportableContent>();
  });

  it('reports existence for seeded items and false for unknown items', async () => {
    const fake = new FakeReportableContent(ReportTargetType.ITINERARY, [
      'itn-1',
    ]);
    fake.set('itn-2');

    expect(await fake.exists('itn-1')).toBe(true);
    expect(await fake.exists('itn-2')).toBe(true);
    expect(await fake.exists('unknown-id')).toBe(false);
    expect(fake.has('itn-1')).toBe(true);
    expect(fake.has('unknown-id')).toBe(false);
  });

  it('hides existing content, keeps it existing, and is idempotent on repeated calls', async () => {
    const fake = new FakeReportableContent(ReportTargetType.REVIEW, ['rev-1']);

    expect(fake.isHidden('rev-1')).toBe(false);

    await fake.hide('rev-1');
    expect(fake.isHidden('rev-1')).toBe(true);
    expect(await fake.exists('rev-1')).toBe(true);

    // Calling hide a second time succeeds and keeps the item hidden.
    await expect(fake.hide('rev-1')).resolves.toBeUndefined();
    expect(fake.isHidden('rev-1')).toBe(true);
    expect(await fake.exists('rev-1')).toBe(true);
  });

  it('rejects hide with 404 NOT_FOUND for unknown content', async () => {
    const fake = new FakeReportableContent(ReportTargetType.COMMENT);

    await expect(fake.hide('missing-comment')).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
  });

  it('deletes existing content and rejects repeated delete or subsequent hide with 404 NOT_FOUND', async () => {
    const fake = new FakeReportableContent(ReportTargetType.POST, [
      'post-1',
      'post-2',
    ]);

    await fake.hide('post-2');
    await fake.delete('post-2');
    expect(await fake.exists('post-2')).toBe(false);
    expect(fake.isHidden('post-2')).toBe(false);

    await fake.delete('post-1');
    expect(await fake.exists('post-1')).toBe(false);

    // Second delete on the same ID rejects with 404 NOT_FOUND.
    await expect(fake.delete('post-1')).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });

    // Hiding an already-deleted item rejects with 404 NOT_FOUND.
    await expect(fake.hide('post-1')).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });
  });

  it('rejects delete with 404 NOT_FOUND for unknown content and supports clear()', async () => {
    const fake = new FakeReportableContent(ReportTargetType.ITINERARY, [
      'itn-1',
    ]);

    await expect(fake.delete('missing-itn')).rejects.toMatchObject({
      status: 404,
      response: { code: 'NOT_FOUND' },
    });

    fake.clear();
    expect(await fake.exists('itn-1')).toBe(false);
  });
});
