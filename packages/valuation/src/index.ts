import type { ValuationComponents } from '@keeper/domain';

export const ENGINE_VERSION = '0.0.0';

// Placeholder until Phase 3 (baseline valuation) implements real component math.
export function emptyValuationComponents(): ValuationComponents {
  return {
    intrinsicValue: 0,
    keeperSurplusValue: null,
    teamContextValue: null,
    breakdown: {},
  };
}
