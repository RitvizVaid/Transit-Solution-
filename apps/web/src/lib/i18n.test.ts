import { afterEach, describe, expect, it } from 'vitest';
import { formatDuration, formatFrequency, MODE_META, QUEUE_META } from './format';
import { getLang, placeholderMismatches, setLang, t } from './i18n';

afterEach(() => setLang('en'));

describe('i18n', () => {
  it('defaults to English and fills placeholders', () => {
    expect(getLang()).toBe('en');
    expect(t('{n} ways to go', { n: 3 })).toBe('3 ways to go');
  });

  it('switches labels, units and formatted values to Hindi', () => {
    setLang('hi');
    expect(t('Plan a trip')).toBe('यात्रा प्लान करें');
    expect(t('{n} ways to go', { n: 3 })).toBe('जाने के 3 तरीके');
    expect(MODE_META.AUTO_RICKSHAW.label).toBe('शेयर्ड ऑटो');
    expect(QUEUE_META.severe.label).toBe('बहुत भीड़');
    expect(formatDuration(600)).toBe('10\u00a0मिनट');
    expect(formatFrequency({ min: 3, max: 5 })).toBe('हर 3–5 मिनट');
  });

  it('falls back to English for text without a translation', () => {
    setLang('hi');
    expect(t('Some brand new sentence')).toBe('Some brand new sentence');
  });

  it('keeps the same placeholders in every Hindi string', () => {
    expect(placeholderMismatches()).toEqual([]);
  });
});
