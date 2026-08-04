import { describe, expect, it } from 'vitest';
import { normalizeAction } from './badge-mappings';

describe('normalizeAction', () => {
  it('normalizes the English Finding.actionTaken vocabulary', () => {
    expect(normalizeAction('blocked')).toEqual({ tone: 'danger', label: 'Blocked' });
    expect(normalizeAction('logged')).toEqual({ tone: 'info', label: 'Logged' });
    expect(normalizeAction('rate-limited')).toEqual({ tone: 'warning', label: 'Rate limited' });
  });

  it('normalizes the French CompiledRule.action vocabulary', () => {
    expect(normalizeAction('bloquer')).toEqual({ tone: 'danger', label: 'Blocked' });
    expect(normalizeAction('journaliser')).toEqual({ tone: 'info', label: 'Logged' });
  });

  it('falls back to a neutral tone with the raw string for an unknown value', () => {
    expect(normalizeAction('something-else')).toEqual({ tone: 'neutral', label: 'something-else' });
  });
});
