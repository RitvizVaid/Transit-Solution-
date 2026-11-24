/**
 * pnpm --filter @transit/stand-qr generate -- --web https://transit.example --driver https://driver.transit.example
 * → tools/stand-qr/out/stands.html (print it, laminate, stick at each stand)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readStands, standSheet } from './qr.js';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  // `pnpm generate -- --web …` forwards a literal `--`.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    web: { type: 'string', default: 'http://localhost:5173' },
    driver: { type: 'string', default: 'http://localhost:5174' },
    stops: { type: 'string', default: resolve(here, '../../../data/geojson/stops.geojson') },
    out: { type: 'string', default: resolve(here, '../out/stands.html') },
  },
});

const stands = readStands(values.stops!);
const html = await standSheet(stands, values.web!, values.driver!);
mkdirSync(dirname(values.out!), { recursive: true });
writeFileSync(values.out!, html);
process.stdout.write(`stand-qr: ${stands.length} stands → ${values.out}\n`);
if (values.web!.includes('localhost')) {
  process.stdout.write(
    '  note: links point at localhost; pass --web/--driver with your public URLs before printing\n',
  );
}
