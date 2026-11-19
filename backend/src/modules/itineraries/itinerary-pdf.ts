import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import { ItinerariesService } from './itineraries.service.js';
import type { ItineraryDetailView } from './itineraries.types.js';
import { pdfFonts, pdfText } from './pdf-text.js';

@Injectable()
export class ItineraryPdf {
  constructor(private readonly itineraries: ItinerariesService) {}

  /**
   * ITN-28: exports the owner's full itinerary as a printable A4 PDF.
   * Reuses ITN-03 ownership/validation errors. Costs retain their stored currency
   * and integer minor units; this export does not perform currency conversion.
   * Chromium uses bundled fonts only, with scripts and external requests disabled.
   */
  async export(itineraryId: string, userId: string): Promise<Buffer> {
    const itinerary = await this.itineraries.getById(itineraryId, userId);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        javaScriptEnabled: false,
        serviceWorkers: 'block',
      });
      await page.route('**/*', (route) => {
        const font = pdfFonts.find(
          (item) => item.url === route.request().url(),
        );
        return font
          ? route.fulfill({
              body: font.bytes,
              contentType: font.contentType,
              headers: { 'access-control-allow-origin': '*' },
            })
          : route.abort();
      });
      await page.setContent(this.document(itinerary));
      await page.evaluate(async () => {
        await document.fonts.ready;
        for (const font of document.fonts) {
          if (font.status === 'error') {
            throw new Error('A bundled PDF font failed to load');
          }
        }
      });
      return await page.pdf({
        format: 'A4',
        tagged: true,
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate:
          '<div style="font-size:8px;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span> | Unsupported characters: [U+XXXX] notation</div>',
        margin: { top: '15mm', right: '15mm', bottom: '20mm', left: '15mm' },
      });
    } finally {
      await browser.close();
    }
  }

  private document(itinerary: ItineraryDetailView): string {
    const line = (value: string) => `<p dir="auto">${pdfText(value)}</p>`;
    const content = [
      `<h1 dir="auto">${pdfText(itinerary.title)}</h1>`,
      line(`Countries: ${itinerary.countryCodes.join(', ')}`),
      line(`Start date: ${itinerary.startDate}`),
      line(`Visibility: ${itinerary.visibility}`),
      line(`Days: ${itinerary.days.length}`),
    ];

    if (itinerary.days.length === 0) content.push(line('No days planned yet.'));

    for (const day of itinerary.days) {
      content.push(
        `<h2 dir="auto">${pdfText(`Day ${day.dayNumber} - ${day.date} - ${day.cityId}`)}</h2>`,
      );
      if (day.notes) content.push(line(day.notes));
      for (const activity of day.activities) {
        content.push(
          `<h3 dir="auto">${pdfText(`${activity.time ? `${activity.time} - ` : ''}${activity.name}`)}</h3>`,
        );
        if (activity.description) content.push(line(activity.description));
        if (activity.cost) {
          content.push(
            line(
              `Cost: ${activity.cost.amountMinor} ${activity.cost.currency} (minor units)`,
            ),
          );
        }
        for (const image of activity.images) {
          content.push(line(`Image: /uploads/${image.key}`));
        }
      }
      if (day.budgetEntries.length > 0) {
        content.push('<h3>Budget entries</h3>');
        for (const entry of day.budgetEntries) {
          content.push(
            line(
              `${entry.category}: ${entry.amountMinor} ${entry.currency} (minor units)${entry.note ? ` - ${entry.note}` : ''}`,
            ),
          );
        }
      }
    }
    if (itinerary.transportCosts.length > 0) {
      content.push('<h2>Intercity transport</h2>');
      for (const cost of itinerary.transportCosts) {
        const day = itinerary.days.find((item) => item._id === cost.dayId);
        content.push(
          line(
            `${day ? `Day ${day.dayNumber} (${day.date}) - ` : ''}${cost.mode}: ${cost.fromCityId} to ${cost.toCityId} - ${cost.amountMinor} ${cost.currency} (minor units)`,
          ),
        );
      }
    }

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${pdfText(itinerary.title)}</title>
<style>
${pdfFonts.map((font) => `@font-face { font-family: "${font.name}"; src: url("${font.url}"); }`).join('\n')}
body { font: 10pt Latin, Arabic, CJK, Emoji; color: #000; }
h1 { font-size: 22pt; }
h2 { font-size: 14pt; margin-top: 20pt; break-after: avoid; }
h3 { font-size: 11pt; break-after: avoid; }
p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 4pt 0; }
h1, h2, h3 { overflow-wrap: anywhere; }
</style></head><body>${content.join('\n')}</body></html>`;
  }
}
