import { describe, expect, it } from 'vitest';
import { CONGESTION_LEVELS, LEG_MODES, QUEUE_LEVELS, REPORT_KINDS } from './index.js';

describe('shared enums', () => {
  it('includes the informal transit modes', () => {
    expect(LEG_MODES).toContain('AUTO_RICKSHAW');
    expect(LEG_MODES).toContain('WALK');
  });

  it('keeps enum values unique', () => {
    for (const values of [LEG_MODES, CONGESTION_LEVELS, QUEUE_LEVELS, REPORT_KINDS]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });
});
