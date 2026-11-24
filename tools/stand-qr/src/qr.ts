import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';

export interface Stand {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Marshalled stands (is_stand) from the corridor sources. */
export function readStands(stopsGeojsonPath: string): Stand[] {
  const fc = JSON.parse(readFileSync(stopsGeojsonPath, 'utf8')) as {
    features: {
      properties: { stop_id: string; name: string; is_stand?: boolean };
      geometry: { coordinates: [number, number] };
    }[];
  };
  return fc.features
    .filter((f) => f.properties.is_stand)
    .map((f) => ({
      id: f.properties.stop_id,
      name: f.properties.name,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
}

/** Same `?from=lat,lng,Name` format the commuter app reads (apps/web/src/lib/url.ts). */
export function commuterUrl(webBase: string, s: Stand): string {
  const from = `${s.lat.toFixed(5)},${s.lng.toFixed(5)},${s.name}`;
  return `${webBase.replace(/\/+$/, '')}/?${new URLSearchParams({ from })}`;
}

export function marshalUrl(driverBase: string, s: Stand): string {
  return `${driverBase.replace(/\/+$/, '')}/?${new URLSearchParams({ stand: s.id })}`;
}

/** Error correction M survives scuffs and stickers on outdoor prints. */
export const QR_OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 4 };

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { ...QR_OPTIONS, type: 'svg' });
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** One A4-printable HTML page with a card per stand. */
export async function standSheet(
  stands: Stand[],
  webBase: string,
  driverBase: string,
): Promise<string> {
  const cards = await Promise.all(
    stands.map(async (s) => {
      const [c, m] = await Promise.all([
        qrSvg(commuterUrl(webBase, s)),
        qrSvg(marshalUrl(driverBase, s)),
      ]);
      return `<section class="card" data-stand="${esc(s.id)}">
  <h2>${esc(s.name)}</h2>
  <div class="codes">
    <figure><div class="qr">${c}</div><figcaption><b>Plan your trip from here</b><br><span lang="hi">यहाँ से अपना सफ़र प्लान करें</span></figcaption></figure>
    <figure class="marshal"><div class="qr">${m}</div><figcaption><b>Stand marshal reporting</b><br><span lang="hi">स्टैंड मार्शल रिपोर्ट</span></figcaption></figure>
  </div>
  <p class="id">Stand ID: ${esc(s.id)}</p>
</section>`;
    }),
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Transit stand QR codes</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: system-ui, 'Noto Sans', 'Noto Sans Devanagari', sans-serif; color: #0f172a; margin: 0; }
  .card { break-inside: avoid; border: 2px solid #0f766e; border-radius: 12px; padding: 10mm; margin-bottom: 8mm; }
  h2 { margin: 0 0 6mm; font-size: 20pt; }
  .codes { display: flex; gap: 10mm; }
  figure { margin: 0; flex: 1; text-align: center; }
  .qr svg { width: 55mm; height: 55mm; }
  .marshal .qr svg { width: 35mm; height: 35mm; }
  figcaption { font-size: 11pt; margin-top: 2mm; }
  .id { font-size: 8pt; color: #64748b; margin: 4mm 0 0; }
</style></head>
<body>
${cards.join('\n')}
</body></html>
`;
}
