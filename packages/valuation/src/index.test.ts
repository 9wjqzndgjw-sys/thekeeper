import { describe, expect, it } from 'vitest';
import { emptyValuationComponents } from './index.js';

describe('emptyValuationComponents', () => {
  it('returns a zeroed breakdown', () => {
    expect(emptyValuationComponents()).toEqual({
      intrinsicValue: 0,
      keeperSurplusValue: null,
      teamContextValue: null,
      breakdown: {},
    });
  });
});
