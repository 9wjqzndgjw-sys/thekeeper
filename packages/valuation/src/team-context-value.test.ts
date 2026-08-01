import { describe, expect, it } from 'vitest';
import { computeRosterFit, computeTeamContextValue } from './team-context-value.js';

describe('computeRosterFit', () => {
  it('awards the positional-need weight when a starter slot is open', () => {
    const result = computeRosterFit({
      starterSlotsAtPosition: 2,
      rosterAboveReplacementCountAtPosition: 1,
    });

    expect(result.openStarterSlots).toBe(1);
    expect(result.rosterFit).toBe(10);
  });

  it('awards nothing once the position is already fully staffed', () => {
    const result = computeRosterFit({
      starterSlotsAtPosition: 2,
      rosterAboveReplacementCountAtPosition: 2,
    });

    expect(result.openStarterSlots).toBe(0);
    expect(result.rosterFit).toBe(0);
  });
});

describe('computeTeamContextValue', () => {
  it('adds roster fit on top of keeper surplus value', () => {
    const result = computeTeamContextValue({ keeperSurplusValue: 50, rosterFit: 10 });

    expect(result.teamContextValue).toBe(60);
  });

  it('differs for the same keeper surplus value under different roster fit', () => {
    const needsPosition = computeTeamContextValue({ keeperSurplusValue: 50, rosterFit: 10 });
    const positionFilled = computeTeamContextValue({ keeperSurplusValue: 50, rosterFit: 0 });

    expect(needsPosition.teamContextValue).not.toBe(positionFilled.teamContextValue);
  });
});
