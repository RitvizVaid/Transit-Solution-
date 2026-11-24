import { describe, expect, it } from 'vitest';
import type { Place } from '../types';
import { geocodeView } from './useGeocode';

const redFort = { name: 'Red Fort', lat: 28.6563, lng: 77.2412 } as Place;

describe('geocodeView', () => {
  it('never offers the previous query’s results while a new query loads', () => {
    const answer = { query: 'red', status: 'ok' as const, results: [redFort] };
    expect(geocodeView('red f', true, answer)).toEqual({ status: 'loading', results: [] });
  });
  it('shows results that belong to the current query', () => {
    const answer = { query: 'red fort', status: 'ok' as const, results: [redFort] };
    expect(geocodeView('red fort', true, answer)).toEqual({ status: 'ok', results: [redFort] });
  });
  it('is idle for short queries or when disabled', () => {
    expect(geocodeView('re', true, null).status).toBe('idle');
    expect(geocodeView('red fort', false, null).status).toBe('idle');
  });
});
