import { describe, expect, it } from 'vitest';
import { createMockDraftRehearsal } from './mock-draft.js';

describe('createMockDraftRehearsal', () => {
  const rehearsal = createMockDraftRehearsal();

  it('builds a twelve-team, fifteen-round snake rehearsal without 3RR', () => {
    expect(rehearsal.snapshot.league.rules.teamCount).toBe(12);
    expect(rehearsal.snapshot.league.rules.draftRounds).toBe(15);
    expect(rehearsal.snapshot.draft).toMatchObject({
      rounds: 15,
      teamCount: 12,
      orderMethod: 'snake',
      thirdRoundReversal: false,
    });
    expect(rehearsal.snapshot.pickInventory).toHaveLength(180);
  });

  it('locks three unique keepers per team as consumed draft slots', () => {
    expect(rehearsal.snapshot.keeperRights).toHaveLength(36);

    const playerIds = rehearsal.snapshot.keeperRights.map((right) => right.playerId);
    expect(new Set(playerIds).size).toBe(playerIds.length);

    const initialStage = rehearsal.stages[0]!;
    expect(initialStage.picks).toHaveLength(36);
    expect(initialStage.picks.every((pick) => pick.isKeeper)).toBe(true);
    expect(new Set(initialStage.picks.map((pick) => pick.pickNo)).size).toBe(36);
  });

  it('applies the keeper round policy into the mock rights', () => {
    const priorSecondRoundKeeper = rehearsal.snapshot.keeperRights.find(
      (right) => right.priorSeasonRound === 2,
    );
    const undraftedKeeper = rehearsal.snapshot.keeperRights.find(
      (right) => right.sourceType === 'undrafted_free_agent',
    );

    expect(priorSecondRoundKeeper?.nominalRound).toBe(1);
    expect(undraftedKeeper?.nominalRound).toBe(10);
  });

  it('adds live picks cumulatively without colliding with keeper slots', () => {
    const counts = rehearsal.stages.map((stage) => stage.picks.length);
    expect(counts).toEqual([...counts].sort((left, right) => left - right));

    for (const stage of rehearsal.stages) {
      expect(new Set(stage.picks.map((pick) => pick.pickNo)).size).toBe(stage.picks.length);
    }

    const finalStage = rehearsal.stages.at(-1)!;
    expect(finalStage.picks.filter((pick) => !pick.isKeeper)).toHaveLength(120);
  });
});
