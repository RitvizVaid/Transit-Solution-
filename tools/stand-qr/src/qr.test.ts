import jsqrModule from 'jsqr';
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commuterUrl, marshalUrl, QR_OPTIONS, readStands, standSheet } from './qr.js';

// jsqr ships CommonJS with an ESM-style d.ts; at runtime the default import is the function.
const jsQR = ((jsqrModule as unknown as { default?: unknown }).default ??
  jsqrModule) as typeof jsqrModule.default;

const STOPS = fileURLToPath(new URL('../../../data/geojson/stops.geojson', import.meta.url));
const WEB = 'https://transit.example';
const DRIVER = 'https://driver.transit.example';

/** Render a QR matrix to RGBA pixels and decode it with an independent decoder. */
function decode(text: string): string | null {
  const qr = QRCode.create(text, QR_OPTIONS);
  const n = qr.modules.size;
  const quiet = 4;
  const scale = 4;
  const size = (n + quiet * 2) * scale;
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
        }
      }
    }
  }
  return jsQR(rgba, size, size)?.data ?? null;
}

describe('stand QR codes (Sprint 4)', () => {
  const stands = readStands(STOPS);

  it('covers every marshalled stand', () => {
    expect(stands.length).toBeGreaterThanOrEqual(10);
    expect(stands.map((s) => s.id)).toContain('kg-auto-1');
  });

  it('links use the formats the apps read', () => {
    const kg = stands.find((s) => s.id === 'kg-auto-1')!;
    const url = new URL(commuterUrl(WEB, kg));
    expect(url.searchParams.get('from')).toBe('28.66620,77.22960,Kashmere Gate Auto Stand');
    expect(marshalUrl(`${DRIVER}/`, kg)).toBe(`${DRIVER}/?stand=kg-auto-1`);
  });

  it('every QR code decodes back to its exact URL', () => {
    for (const s of stands) {
      for (const url of [commuterUrl(WEB, s), marshalUrl(DRIVER, s)]) {
        expect(decode(url), url).toBe(url);
      }
    }
  });

  it('produces a printable sheet with one card per stand and escaped names', async () => {
    const html = await standSheet(
      [...stands, { id: 'x<y', name: 'A & B <stand>', lat: 28.6, lng: 77.2 }],
      WEB,
      DRIVER,
    );
    expect(html.match(/<section class="card"/g)).toHaveLength(stands.length + 1);
    expect(html.match(/<svg/g)).toHaveLength((stands.length + 1) * 2);
    expect(html).toContain('A &amp; B &lt;stand&gt;');
    expect(html).not.toContain('<stand>');
    expect(html).toContain('@page { size: A4');
  });
});
