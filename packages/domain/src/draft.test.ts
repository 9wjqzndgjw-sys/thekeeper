import { describe, expect, it } from 'vitest';
import {
  calculateDraftSlot,
  calculateOverallPick,
  createDraftOrderStrategy,
  formatDraftPick,
  listDraftSlots,
  type DraftOrderConfig,
} from './draft.js';

const snakeConfig: DraftOrderConfig = {
  orderMethod: 'snake',
  teamCount: 12,
  rounds: 15,
  thirdRoundReversal: false,
};

describe('draft pick math', () => {
  it('converts every 12-team, 15-round snake draft pick to the documented overall pick', () => {
    const overallPicks: number[] = [];

    for (let round = 1; round <= snakeConfig.rounds; round += 1) {
      for (let slot = 1; slot <= snakeConfig.teamCount; slot += 1) {
        const expectedOverallPick =
          round % 2 === 1
            ? (round - 1) * snakeConfig.teamCount + slot
            : (round - 1) * snakeConfig.teamCount + (snakeConfig.teamCount + 1 - slot);

        const overallPick = calculateOverallPick(snakeConfig, round, slot);
        overallPicks.push(overallPick);
        expect(overallPick).toBe(expectedOverallPick);
        expect(calculateDraftSlot(snakeConfig, overallPick)).toEqual({
          round,
          slot,
          overallPick,
        });
      }
    }

    expect(overallPicks.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 180 }, (_, index) => index + 1),
    );
  });

  it('exposes a draft-order strategy and stable pick labels', () => {
    const strategy = createDraftOrderStrategy(snakeConfig);

    expect(strategy.toOverallPick(4, 8)).toBe(41);
    expect(strategy.fromOverallPick(41)).toEqual({ round: 4, slot: 8, overallPick: 41 });
    expect(strategy.listSlots()).toEqual(listDraftSlots(snakeConfig));
    expect(formatDraftPick(4, 8)).toBe('4.08');
  });

  it('rejects invalid ordered draft coordinates', () => {
    expect(() => calculateOverallPick(snakeConfig, 16, 1)).toThrow(/round/);
    expect(() => calculateDraftSlot(snakeConfig, 181)).toThrow(/overallPick/);
    expect(() => calculateOverallPick({ ...snakeConfig, orderMethod: 'auction' }, 1, 1)).toThrow(
      /Auction/,
    );
  });

  it('keeps round 2 in the same order as round 1 under third-round reversal', () => {
    const reversalConfig: DraftOrderConfig = {
      orderMethod: 'snake',
      teamCount: 12,
      rounds: 6,
      thirdRoundReversal: true,
    };

    // Round 1 and 2 both run forward (no reversal at the 1/2 boundary — that's
    // the point of 3RR); the snake reversal only starts at round 3.
    expect(calculateOverallPick(reversalConfig, 1, 1)).toBe(1);
    expect(calculateOverallPick(reversalConfig, 1, 12)).toBe(12);
    expect(calculateOverallPick(reversalConfig, 2, 1)).toBe(13);
    expect(calculateOverallPick(reversalConfig, 2, 12)).toBe(24);
    expect(calculateOverallPick(reversalConfig, 3, 1)).toBe(36);
    expect(calculateOverallPick(reversalConfig, 3, 12)).toBe(25);
    expect(calculateOverallPick(reversalConfig, 4, 1)).toBe(37);
    expect(calculateOverallPick(reversalConfig, 4, 12)).toBe(48);
    expect(calculateOverallPick(reversalConfig, 5, 1)).toBe(60);
    expect(calculateOverallPick(reversalConfig, 5, 12)).toBe(49);

    for (let round = 1; round <= reversalConfig.rounds; round += 1) {
      for (let slot = 1; slot <= reversalConfig.teamCount; slot += 1) {
        const overallPick = calculateOverallPick(reversalConfig, round, slot);
        expect(calculateDraftSlot(reversalConfig, overallPick)).toEqual({
          round,
          slot,
          overallPick,
        });
      }
    }
  });
});
