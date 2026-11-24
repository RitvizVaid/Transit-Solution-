import { test as base, type Page } from '@playwright/test';
import { PORTS } from './playwright.config';

export const WEB = `http://localhost:${PORTS.web}`;
export const DRIVER = `http://localhost:${PORTS.driver}`;

export const KG_METRO = '28.66750,77.22820,Kashmere Gate Metro';
export const CC_MARKET = '28.65550,77.23000,Chandni Chowk Market';
export const RED_FORT = '28.65630,77.24120,Red Fort';
export const TIS_HAZARI = '28.66720,77.21650,Tis Hazari';

export const planUrl = (from: string, to?: string, extra = '') =>
  `${WEB}/?from=${encodeURIComponent(from)}${to ? `&to=${encodeURIComponent(to)}` : ''}${extra}`;

/** Photon stub: tests must not depend on a third-party geocoder. */
const photonFixture = {
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [77.2412, 28.6563] },
      properties: { name: 'Red Fort', district: 'Old Delhi', city: 'Delhi' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [77.23, 28.6555] },
      properties: { name: 'Chandni Chowk Market', city: 'Delhi' },
    },
  ],
};

/** Minimal MapLibre style: the map loads and draws our layers without any tile server. */
const MIN_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8eef0' } }],
};

export let photonRequests = 0;

async function isolate(page: Page) {
  photonRequests = 0;
  await page.route('https://photon.komoot.io/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/') photonRequests++;
    return route.fulfill({ json: photonFixture });
  });
  // Routes run in reverse registration order: style stub first, everything else aborted.
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort());
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: MIN_STYLE }),
  );
}

export const test = base.extend<{ isolated: Page }>({
  // Named `provide` (not `use`) so the React Hooks lint rule does not mistake it for React.use.
  isolated: async ({ page }, provide) => {
    await isolate(page);
    await provide(page);
  },
});

export { expect } from '@playwright/test';

// --- Map inspection (pages opened with ?debug=map) ---------------------------------------

type Json = Record<string, unknown>;
export interface FeatureLike {
  properties: Json;
  geometry: { type: string; coordinates: unknown };
}

export async function waitForMap(page: Page) {
  await page.waitForFunction(() => {
    const m = (window as unknown as { __transitMap?: { loaded(): boolean; getSource(id: string): unknown } })
      .__transitMap;
    return !!m && m.loaded() && !!m.getSource('route');
  });
}

/** GeoJSON currently set on one of our map sources. */
export function sourceFeatures(page: Page, id: string): Promise<FeatureLike[]> {
  return page.evaluate((sourceId) => {
    const m = (
      window as unknown as {
        __transitMap: {
          getSource(id: string): { serialize(): { data: { type: string; features?: unknown[] } } };
        };
      }
    ).__transitMap;
    const data = m.getSource(sourceId).serialize().data;
    return (data.type === 'FeatureCollection' ? data.features : [data]) as FeatureLike[];
  }, id);
}
