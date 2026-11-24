import { describe, expect, it } from 'vitest';
import { CITIES, selectCity } from './city';

describe('selectCity', () => {
  it('defaults to Delhi and accepts known ids case-insensitively', () => {
    expect(selectCity(undefined).id).toBe('delhi');
    expect(selectCity(' Delhi ').id).toBe('delhi');
  });
  it('fails loudly for an unknown city instead of silently using Delhi', () => {
    expect(() => selectCity('lucknow')).toThrow(/Unknown VITE_CITY "lucknow"/);
  });
  it('every configured city is internally consistent', () => {
    for (const id of Object.keys(CITIES)) expect(() => selectCity(id)).not.toThrow();
  });
});
