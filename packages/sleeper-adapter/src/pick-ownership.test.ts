import { describe, expect, it } from 'vitest';
import type { DraftOrderConfig, FranchiseId, SeasonId } from '@keeper/domain';
import type {
  NormalizedSleeperDraft,
  NormalizedSleeperDraftPick,
  NormalizedSleeperTradedPick,
} from './index.js';
import { reconstructDraftPickInventory } from './pick-ownership.js';

const seasonId = 'season-2026' as SeasonId;
const franchiseA = 'franchise-a' as FranchiseId;
const franchiseB = 'franchise-b' as FranchiseId;
const franchiseC = 'franchise-c' as FranchiseId;

const orderConfig: DraftOrderConfig = {
  orderMethod: 'snake',
  teamCount: 3,
  rounds: 3,
  thirdRoundReversal: false,
};

const rosterIdToFranchiseId = {
  101: franchiseA,
  102: franchiseB,
  103: franchiseC,
};

const sleeperUserIdToFranchiseId = {
  'user-a': franchiseA,
  'user-b': franchiseB,
  'user-c': franchiseC,
};

describe('reconstructDraftPickInventory', () => {
  it('builds every pick and applies traded ownership to the original asset', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft(),
      rosterIdToFranchiseId,
      sleeperUserIdToFranchiseId,
      tradedPicks: [createTrade({ round: 2, originalRosterId: 101, currentOwnerRosterId: 102 })],
      selections: [createSelection({ pickNo: 6, round: 2, draftSlot: 1, rosterId: 102 })],
    });

    expect(result.pickInventory).toHaveLength(9);
    expect(result.pickInventory.map((pick) => pick.overallPick)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(findPick(result, 2, 1)).toMatchObject({
      id: 'draft-pick:season-2026:draft-2026:2:1',
      originalFranchiseId: franchiseA,
      currentFranchiseId: franchiseB,
      overallPick: 6,
      ownershipConfidence: 'confirmed',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts a valid sequence of pick transfers without marking the chain disputed', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft(),
      rosterIdToFranchiseId,
      tradedPicks: [
        createTrade({ round: 2, originalRosterId: 101, currentOwnerRosterId: 102 }),
        createTrade({
          round: 2,
          originalRosterId: 101,
          previousOwnerRosterId: 102,
          currentOwnerRosterId: 103,
        }),
      ],
    });

    expect(findPick(result, 2, 1)).toMatchObject({
      currentFranchiseId: franchiseC,
      ownershipConfidence: 'confirmed',
    });
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'conflicting_trade_records'),
    ).toBe(false);
  });

  it('resolves a multi-hop trade chain to its final owner without flagging a conflict', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft(),
      rosterIdToFranchiseId,
      tradedPicks: [
        // A -> B, then B -> C. Consistent records, not a conflict.
        createTrade({
          round: 2,
          originalRosterId: 101,
          previousOwnerRosterId: 101,
          currentOwnerRosterId: 102,
        }),
        createTrade({
          round: 2,
          originalRosterId: 101,
          previousOwnerRosterId: 102,
          currentOwnerRosterId: 103,
        }),
      ],
    });

    expect(findPick(result, 2, 1)).toMatchObject({
      originalFranchiseId: franchiseA,
      currentFranchiseId: franchiseC,
      ownershipConfidence: 'confirmed',
    });
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'conflicting_trade_records'),
    ).toEqual([]);
  });

  it('resolves a trade chain regardless of the order records arrive in', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft(),
      rosterIdToFranchiseId,
      tradedPicks: [
        // Same A -> B -> C chain, but Sleeper returned the later hop first.
        createTrade({
          round: 2,
          originalRosterId: 101,
          previousOwnerRosterId: 102,
          currentOwnerRosterId: 103,
        }),
        createTrade({
          round: 2,
          originalRosterId: 101,
          previousOwnerRosterId: 101,
          currentOwnerRosterId: 102,
        }),
      ],
    });

    expect(findPick(result, 2, 1)).toMatchObject({
      originalFranchiseId: franchiseA,
      currentFranchiseId: franchiseC,
      ownershipConfidence: 'confirmed',
    });
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'conflicting_trade_records'),
    ).toEqual([]);
  });

  it('disputes trade records that fork instead of forming one chain', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft(),
      rosterIdToFranchiseId,
      tradedPicks: [
        // Both records send the pick away from A, so the real owner is unknowable.
        createTrade({
          round: 2,
          originalRosterId: 101,
          previousOwnerRosterId: 101,
          currentOwnerRosterId: 102,
        }),
        createTrade({
          round: 2,
          originalRosterId: 101,
          previousOwnerRosterId: 101,
          currentOwnerRosterId: 103,
        }),
      ],
    });

    expect(findPick(result, 2, 1)).toMatchObject({ ownershipConfidence: 'disputed' });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'conflicting_trade_records', round: 2 }),
    );
  });

  it('ignores an exactly duplicated trade record without disputing ownership', () => {
    const duplicate = {
      round: 2,
      originalRosterId: 101,
      previousOwnerRosterId: 101,
      currentOwnerRosterId: 102,
    };
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft(),
      rosterIdToFranchiseId,
      tradedPicks: [createTrade(duplicate), createTrade(duplicate)],
    });

    expect(findPick(result, 2, 1)).toMatchObject({
      currentFranchiseId: franchiseB,
      ownershipConfidence: 'confirmed',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'conflicting_trade_records',
        message: expect.stringContaining('duplicate was ignored'),
      }),
    );
  });

  it('infers slot ownership from draft-order users when roster metadata is missing', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft({ slotToRosterId: {} }),
      rosterIdToFranchiseId,
      sleeperUserIdToFranchiseId,
    });

    expect(result.pickInventory).toHaveLength(9);
    expect(findPick(result, 1, 1)).toMatchObject({
      originalFranchiseId: franchiseA,
      currentFranchiseId: franchiseA,
      ownershipConfidence: 'inferred',
    });
  });

  it('omits a slot when draft metadata maps it to conflicting franchises', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft({
        draftOrder: { 'user-b': 1, 'user-c': 3 },
      }),
      rosterIdToFranchiseId,
      sleeperUserIdToFranchiseId,
    });

    expect(result.pickInventory).toHaveLength(6);
    expect(result.pickInventory.some((pick) => pick.slot === 1)).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        level: 'error',
        code: 'conflicting_slot_owner',
        slot: 1,
      }),
    );
  });

  it('uses actual selections as the final non-manual ownership evidence', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft(),
      rosterIdToFranchiseId,
      tradedPicks: [createTrade({ round: 2, originalRosterId: 101, currentOwnerRosterId: 102 })],
      selections: [createSelection({ pickNo: 6, round: 1, draftSlot: 3, rosterId: 103 })],
    });

    expect(findPick(result, 2, 1)).toMatchObject({
      originalFranchiseId: franchiseA,
      currentFranchiseId: franchiseC,
      overallPick: 6,
      ownershipConfidence: 'disputed',
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'selection_coordinate_mismatch', overallPick: 6 }),
        expect.objectContaining({ code: 'selection_owner_conflict', overallPick: 6 }),
      ]),
    );
  });

  it('reports duplicate selections deterministically and lets the last mapped owner win', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft(),
      rosterIdToFranchiseId,
      selections: [
        createSelection({ pickNo: 1, round: 1, draftSlot: 1, rosterId: 101 }),
        createSelection({ pickNo: 1, round: 1, draftSlot: 1, rosterId: 102 }),
      ],
    });

    expect(findPick(result, 1, 1)).toMatchObject({
      currentFranchiseId: franchiseB,
      ownershipConfidence: 'disputed',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'duplicate_selection', overallPick: 1 }),
    );
  });

  it('lets audited slot and pick overrides resolve ambiguity and win last', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft({
        draftOrder: { 'user-b': 1, 'user-c': 3 },
      }),
      rosterIdToFranchiseId,
      sleeperUserIdToFranchiseId,
      tradedPicks: [createTrade({ round: 2, originalRosterId: 101, currentOwnerRosterId: 102 })],
      overrides: [
        {
          kind: 'slot',
          slot: 1,
          originalFranchiseId: franchiseA,
          reason: 'Commissioner confirmed the draft-order correction.',
          overriddenBy: 'commissioner-user',
          overriddenAt: '2026-08-01T12:00:00.000Z',
        },
        {
          kind: 'pick',
          round: 2,
          slot: 1,
          currentFranchiseId: franchiseC,
          reason: 'Sleeper omitted the final pick transfer.',
          overriddenBy: 'commissioner-user',
          overriddenAt: '2026-08-01T12:05:00.000Z',
        },
      ],
    });

    expect(findPick(result, 2, 1)).toMatchObject({
      originalFranchiseId: franchiseA,
      currentFranchiseId: franchiseC,
      ownershipConfidence: 'confirmed',
    });
    expect(result.appliedOverrides).toHaveLength(2);
    expect(result.appliedOverrides[1]).toMatchObject({
      kind: 'pick',
      priorCurrentFranchiseId: franchiseB,
      currentFranchiseId: franchiseC,
      overriddenBy: 'commissioner-user',
    });
  });

  it('can create one missing pick when a complete manual pick override supplies its owners', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft({
        slotToRosterId: { 2: 102, 3: 103 },
        draftOrder: { 'user-b': 2, 'user-c': 3 },
      }),
      rosterIdToFranchiseId,
      sleeperUserIdToFranchiseId,
      overrides: [
        {
          kind: 'pick',
          round: 1,
          slot: 1,
          originalFranchiseId: franchiseA,
          currentFranchiseId: franchiseB,
          reason: 'Historical source confirms this isolated asset.',
          overriddenBy: 'data-admin',
          overriddenAt: '2026-08-01T12:00:00.000Z',
        },
      ],
    });

    expect(result.pickInventory).toHaveLength(7);
    expect(findPick(result, 1, 1)).toMatchObject({
      originalFranchiseId: franchiseA,
      currentFranchiseId: franchiseB,
      overallPick: 1,
      ownershipConfidence: 'confirmed',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'missing_slot_owner', slot: 1 }),
    );
    expect(result.appliedOverrides[0]).toMatchObject({
      priorOriginalFranchiseId: null,
      priorCurrentFranchiseId: null,
    });
  });

  it('reports draft metadata mismatches while using the explicit reconstruction config', () => {
    const result = reconstructDraftPickInventory({
      seasonId,
      sleeperSeason: '2026',
      orderConfig,
      draft: createDraft({ rounds: 4, teamCount: 4, type: 'linear' }),
      rosterIdToFranchiseId,
    });

    expect(result.pickInventory).toHaveLength(9);
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.code === 'draft_metadata_mismatch'),
    ).toHaveLength(3);
  });
});

function createDraft(overrides: Partial<NormalizedSleeperDraft> = {}): NormalizedSleeperDraft {
  return {
    sleeperDraftId: 'draft-2026',
    sleeperLeagueId: 'league-2026',
    type: 'snake',
    status: 'pre_draft',
    season: '2026',
    rounds: 3,
    teamCount: 3,
    startTime: null,
    draftOrder: { 'user-a': 1, 'user-b': 2, 'user-c': 3 },
    slotToRosterId: { 1: 101, 2: 102, 3: 103 },
    metadata: {},
    ...overrides,
  };
}

function createTrade(
  overrides: Partial<NormalizedSleeperTradedPick> = {},
): NormalizedSleeperTradedPick {
  return {
    season: '2026',
    round: 1,
    originalRosterId: 101,
    previousOwnerRosterId: 101,
    currentOwnerRosterId: 102,
    ...overrides,
  };
}

function createSelection(
  overrides: Partial<NormalizedSleeperDraftPick> = {},
): NormalizedSleeperDraftPick {
  return {
    sleeperDraftId: 'draft-2026',
    pickNo: 1,
    round: 1,
    draftSlot: 1,
    rosterId: 101,
    sleeperPlayerId: 'player-1',
    pickedBySleeperUserId: null,
    isKeeper: false,
    metadata: {},
    ...overrides,
  };
}

function findPick(
  result: ReturnType<typeof reconstructDraftPickInventory>,
  round: number,
  slot: number,
) {
  const pick = result.pickInventory.find(
    (candidate) => candidate.round === round && candidate.slot === slot,
  );
  expect(pick).toBeDefined();
  return pick;
}
