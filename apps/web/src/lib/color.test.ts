import { describe, expect, it } from 'vitest';
import { parseHex, readableTextColor } from './color';

describe('parseHex', () => {
  it('parses short and long forms', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('16A34A')).toEqual([22, 163, 74]);
  });
  it('rejects junk', () => {
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });
});

describe('readableTextColor', () => {
  it('uses dark text on light route colours', () => {
    expect(readableTextColor('#EAB308')).toBe('#0f172a'); // yellow
    expect(readableTextColor('#ffffff')).toBe('#0f172a');
  });
  it('uses white text on dark route colours', () => {
    expect(readableTextColor('#7C3AED')).toBe('#ffffff'); // violet
    expect(readableTextColor('#0f766e')).toBe('#ffffff'); // teal
  });
  it('falls back to white for invalid input', () => {
    expect(readableTextColor('nope')).toBe('#ffffff');
  });
});
