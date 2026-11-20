import { getModelToken } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chromium } from 'playwright';
import { FakeReferenceDataService } from '../../../test/fakes/reference-data.fake.js';
import { FakeFxService } from '../../../test/fakes/fx.fake.js';
import { FxService } from '../fx/fx.service.js';
import { loginAs } from '../../../test/support/auth.js';
import { clearCollections } from '../../../test/support/clear-collections.js';
import { HOOK_TIMEOUT } from '../../../test/support/mongo-memory.js';
import { createTestApp, type TestApp } from '../../../test/support/test-app.js';
import { ErrorCode } from '../../common/errors/error-codes.js';
import { UserRole } from '../accounts/schemas/user.schema.js';
import { ReferenceDataService } from '../reference-data/reference-data.service.js';
import { ItinerariesModule } from './itineraries.module.js';
import { Itinerary, ItineraryVisibility } from './schemas/itinerary.schema.js';

describe('Itinerary PDF HTTP API (ITN-28)', () => {
  let t: TestApp;
  let model: Model<Itinerary>;

  beforeAll(async () => {
    t = await createTestApp({
      imports: [ItinerariesModule],
      providers: [{ provide: FxService, useValue: new FakeFxService() }],
      override: (builder) =>
        builder
          .overrideProvider(ReferenceDataService)
          .useValue(new FakeReferenceDataService()),
    });
    model = t.moduleRef.get<Model<Itinerary>>(getModelToken(Itinerary.name));
  }, HOOK_TIMEOUT);

  beforeEach(() => clearCollections(t.connection));
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => t.close(), HOOK_TIMEOUT);

  async function readPdf(bytes: Buffer) {
    const loading = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: false,
    });
    const pdf = await loading.promise;
    try {
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, async (_, index) => {
          const page = await pdf.getPage(index + 1);
          // Normalize Arabic ligatures after reading visual runs, not before
          // PDF.js applies bidi ordering inside each individual glyph cluster.
          const content = await page.getTextContent({
            disableNormalization: true,
          });
          const items = content.items
            .filter((item) => 'str' in item)
            .filter((item) => item.str !== '');
          const lines = new Map<number, typeof items>();
          for (const item of items) {
            const y = Math.round(item.transform[5] * 10);
            const line = lines.get(y) ?? [];
            line.push(item);
            lines.set(y, line);
          }
          return [...lines.values()]
            .map((line) => {
              const rtl = line.every(
                (item) => item.str.trim() === '' || item.dir === 'rtl',
              );
              const ordered = rtl
                ? line.toSorted((a, b) => b.transform[4] - a.transform[4])
                : line;
              return ordered.map((item) => item.str.normalize('NFKC')).join('');
            })
            .join(' ');
        }),
      );
      return {
        text: pages.join(' ').replace(/\s+/g, ' '),
        pages: pdf.numPages,
      };
    } finally {
      await loading.destroy();
    }
  }

  async function seed(ownerId: string, days = 0): Promise<string> {
    const itinerary = await model.create({
      ownerId: new Types.ObjectId(ownerId),
      title: 'Café (Egypt) \\ November',
      countryCodes: ['EG'],
      startDate: new Date('2027-01-31T00:00:00.000Z'),
      dayCount: days,
      cityIds: days > 0 ? ['cairo'] : [],
      days: Array.from({ length: days }, (_, index) => ({
        _id: new Types.ObjectId(),
        cityId: 'cairo',
        notes: `Notes for day ${index + 1}`,
        activities: [
          {
            name: 'Museum visit',
            time: '09:30',
            description: 'Guided tour',
            cost: { amountMinor: 12550, currency: 'EGP' },
            images: [],
          },
        ],
        budgetEntries: [
          {
            category: 'food',
            amountMinor: 0,
            currency: 'JPY',
            note: 'Included lunch',
          },
        ],
      })),
    });
    if (days > 0) {
      await model.updateOne(
        { _id: itinerary._id },
        {
          $set: {
            transportCosts: [
              {
                dayId: itinerary.days[0]._id,
                mode: 'train',
                fromCityId: 'cairo',
                toCityId: 'luxor',
                amountMinor: 30000,
                currency: 'EGP',
              },
            ],
          },
        },
      );
    }
    return itinerary._id.toHexString();
  }

  it('downloads a real printable PDF with safe headers without modifying the itinerary', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const id = await seed(owner.id, 2);
    const before = await model.findById(id).lean();

    const response = await t
      .http()
      .get(`/api/itineraries/${id}/pdf`)
      .set('Cookie', owner.cookie)
      .expect(200);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="itinerary-${id}.pdf"`,
    );
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    const bytes = response.body as Buffer;
    expect(Number(response.headers['content-length'])).toBe(bytes.length);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.toString('latin1').trimEnd()).toMatch(/%%EOF$/);
    const { text: content } = await readPdf(bytes);
    expect(content).toContain('Café (Egypt) \\ November');
    for (const text of [
      'Countries: EG',
      'Start date: 2027-01-31',
      'Day 1 - 2027-01-31 - cairo',
      'Day 2 - 2027-02-01 - cairo',
      'Notes for day 2',
      '09:30 - Museum visit',
      'Guided tour',
      '12550 EGP (minor units)',
      'food: 0 JPY (minor units) - Included lunch',
      'Day 1 (2027-01-31) - train: cairo to luxor - 30000 EGP (minor units)',
    ]) {
      expect(content).toContain(text);
    }
    expect(await model.findById(id).lean()).toEqual(before);
  });

  it('exports an itinerary with no days', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const id = await seed(owner.id);

    const response = await t
      .http()
      .get(`/api/itineraries/${id}/pdf`)
      .set('Cookie', owner.cookie)
      .expect(200);

    expect((await readPdf(response.body as Buffer)).text).toContain(
      'No days planned yet.',
    );
  });

  it('paginates all 60 days instead of truncating the printable document', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const id = await seed(owner.id, 60);

    const response = await t
      .http()
      .get(`/api/itineraries/${id}/pdf`)
      .set('Cookie', owner.cookie)
      .expect(200);

    const bytes = response.body as Buffer;
    const pdf = await readPdf(bytes);
    expect(pdf.pages).toBeGreaterThan(1);
    expect(pdf.text).toContain('Day 60 - 2027-03-31 - cairo');
  });

  it('requires a login (401)', async () => {
    const response = await t
      .http()
      .get(`/api/itineraries/${new Types.ObjectId().toHexString()}/pdf`)
      .expect(401);
    expect(response.body.code).toBe(ErrorCode.NotAuthenticated);
  });

  it('prints markup as text rather than executing it or loading remote resources', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const id = await seed(owner.id);
    const title =
      '<img src="https://example.invalid/leak"> & <script>alert(1)</script>';
    await model.updateOne({ _id: id }, { $set: { title } });
    const response = await t
      .http()
      .get(`/api/itineraries/${id}/pdf`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect((await readPdf(response.body as Buffer)).text).toContain(title);
  });

  it('returns an explicit 500 if the PDF runtime fails instead of a successful corrupt file', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const id = await seed(owner.id);
    vi.spyOn(chromium, 'launch').mockRejectedValueOnce(
      new Error('PDF runtime unavailable'),
    );
    const response = await t
      .http()
      .get(`/api/itineraries/${id}/pdf`)
      .set('Cookie', owner.cookie)
      .expect(500);
    expect(response.body.code).toBe(ErrorCode.InternalError);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('preserves accented, CJK and emoji text and explicitly represents unsupported characters', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const id = await seed(owner.id);
    const title = 'Café 東京 😀 \u0378';
    await model.updateOne({ _id: id }, { $set: { title } });
    const response = await t
      .http()
      .get(`/api/itineraries/${id}/pdf`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect((await readPdf(response.body as Buffer)).text).toContain(
      'Café 東京 😀 [U+0378]',
    );
  });

  it('embeds Arabic text instead of dropping unsupported glyphs', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const id = await seed(owner.id);
    await model.updateOne({ _id: id }, { $set: { title: 'السفر إلى مصر' } });
    const response = await t
      .http()
      .get(`/api/itineraries/${id}/pdf`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect((await readPdf(response.body as Buffer)).text).toContain(
      'السفر إلى مصر',
    );
  });

  it('validates the itinerary ID (400)', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const response = await t
      .http()
      .get('/api/itineraries/not-an-id/pdf')
      .set('Cookie', owner.cookie)
      .expect(400);
    expect(response.body.code).toBe(ErrorCode.ValidationFailed);
  });

  it("returns 404 for nonexistent, deleted and other users' itineraries, even if public", async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const other = await loginAs(t.connection, UserRole.USER);
    const id = await seed(owner.id);

    for (const visibility of Object.values(ItineraryVisibility)) {
      await model.updateOne({ _id: id }, { $set: { visibility } });
      const response = await t
        .http()
        .get(`/api/itineraries/${id}/pdf`)
        .set('Cookie', other.cookie)
        .expect(404);
      expect(response.body.code).toBe(ErrorCode.NotFound);
    }
    await model.deleteOne({ _id: id });
    for (const missing of [id, new Types.ObjectId().toHexString()]) {
      const response = await t
        .http()
        .get(`/api/itineraries/${missing}/pdf`)
        .set('Cookie', owner.cookie)
        .expect(404);
      expect(response.body.code).toBe(ErrorCode.NotFound);
    }
  });

  it('does not give admins an ownership bypass', async () => {
    const owner = await loginAs(t.connection, UserRole.USER);
    const admin = await loginAs(t.connection, UserRole.ADMIN);
    const id = await seed(owner.id);
    const response = await t
      .http()
      .get(`/api/itineraries/${id}/pdf`)
      .set('Cookie', admin.cookie)
      .expect(404);
    expect(response.body.code).toBe(ErrorCode.NotFound);
  });

  it('documents the authenticated binary PDF response in Swagger', () => {
    const document = SwaggerModule.createDocument(
      t.app,
      new DocumentBuilder().addCookieAuth('access_token').build(),
    );
    const operation = document.paths['/api/itineraries/{id}/pdf']?.get;
    expect(operation?.summary).toMatch(/^ITN-28 /);
    expect(operation?.tags).toContain('itineraries');
    expect(operation?.security).toEqual([{ cookie: [] }]);
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/pdf': { schema: { type: 'string', format: 'binary' } },
      },
    });
    for (const status of ['400', '401', '404']) {
      expect(operation?.responses[status]).toBeDefined();
    }
  });
});
