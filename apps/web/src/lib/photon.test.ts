import { describe, expect, it } from 'vitest';
import { parsePhoton, photonSearchUrl } from './photon';

const feature = (coordinates: [number, number], properties: Record<string, string>) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
});

describe('parsePhoton', () => {
  it('maps features to places with a readable detail line', () => {
    const places = parsePhoton({
      features: [
        feature([77.2303, 28.6506], {
          name: 'Chandni Chowk',
          district: 'Old Delhi',
          city: 'Delhi',
          state: 'Delhi',
        }),
      ],
    });
    expect(places).toEqual([
      {
        name: 'Chandni Chowk',
        detail: 'Old Delhi, Delhi',
        lat: 28.6506,
        lng: 77.2303,
        source: 'search',
      },
    ]);
  });

  it('falls back to the street address when there is no name', () => {
    const [p] = parsePhoton({
      features: [
        feature([77.2, 28.6], { housenumber: '12', street: 'Netaji Subhash Marg', city: 'Delhi' }),
      ],
    });
    expect(p?.name).toBe('12 Netaji Subhash Marg');
    expect(p?.detail).toBe('Delhi');
  });

  it('drops duplicates and malformed features', () => {
    const places = parsePhoton({
      features: [
        feature([77.2, 28.6], { name: 'Red Fort', city: 'Delhi' }),
        feature([77.21, 28.61], { name: 'Red Fort', city: 'Delhi' }),
        { geometry: {}, properties: { name: 'No coords' } },
        feature([77.2, 28.6], {}),
      ],
    });
    expect(places.map((p) => p.name)).toEqual(['Red Fort']);
  });

  it('tolerates non-object input', () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({})).toEqual([]);
  });
});

describe('photonSearchUrl', () => {
  it('encodes the query and location bias', () => {
    const url = new URL(
      photonSearchUrl('https://photon.example', 'red fort & co', { lat: 28.6, lng: 77.2 }),
    );
    expect(url.pathname).toBe('/api/');
    expect(url.searchParams.get('q')).toBe('red fort & co');
    expect(url.searchParams.get('lat')).toBe('28.6');
    expect(url.searchParams.get('lon')).toBe('77.2');
    expect(url.searchParams.has('bbox')).toBe(false);
  });

  it('restricts to a bounding box when given', () => {
    const url = new URL(
      photonSearchUrl(
        'https://photon.example',
        'x',
        { lat: 0, lng: 0 },
        [76.84, 28.4, 77.35, 28.88],
      ),
    );
    expect(url.searchParams.get('bbox')).toBe('76.84,28.4,77.35,28.88');
  });
});
