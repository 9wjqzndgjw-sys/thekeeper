import type {
  DraftOrderConfig,
  DraftPickAsset,
  Franchise,
  LeagueId,
  SeasonId,
} from '@keeper/domain';
import type { SleeperAdapter, SleeperDiagnostic, SleeperRawSnapshot } from './index.js';
import {
  buildFranchiseMap,
  type FranchiseIdentityOverride,
  type FranchiseMap,
} from './franchise-mapping.js';
import {
  reconstructDraftPickInventory,
  type DraftOwnershipOverride,
  type ReconstructDraftPickInventoryResult,
} from './pick-ownership.js';

export type ImportStage = 'adapter' | 'franchise_mapping' | 'pick_ownership' | 'import';

export interface ImportDiagnostic {
  stage: ImportStage;
  level: 'warning' | 'error';
  code: string;
  message: string;
}

export interface ImportSeasonDraftStateInput {
  adapter: SleeperAdapter;
  leagueId: LeagueId;
  seasonId: SeasonId;
  sleeperLeagueId: string;
  /**
   * Sleeper does not report third-round reversal in a shape this adapter reads, and a
   * league can legitimately run fewer rounds than its draft metadata claims, so callers
   * may pin the draft shape. Anything omitted is derived from Sleeper's draft metadata.
   */
  orderConfig?: Partial<DraftOrderConfig>;
  sleeperDraftId?: string;
  franchiseOverrides?: readonly FranchiseIdentityOverride[];
  ownershipOverrides?: readonly DraftOwnershipOverride[];
}

export interface ImportSeasonDraftStateResult {
  franchises: Franchise[];
  franchiseMap: FranchiseMap;
  pickInventory: DraftPickAsset[];
  ownership: ReconstructDraftPickInventoryResult | null;
  orderConfig: DraftOrderConfig | null;
  diagnostics: ImportDiagnostic[];
  snapshots: SleeperRawSnapshot[];
}

/**
 * Runs the read-only import path end to end: fetch a season's league, rosters, users,
 * draft, selections, and traded picks; resolve stable franchise identities; then
 * reconstruct exact pick ownership. Diagnostics from every stage are flattened into one
 * list so a caller sees a single ordered account of what was uncertain.
 */
export async function importSeasonDraftState(
  input: ImportSeasonDraftStateInput,
): Promise<ImportSeasonDraftStateResult> {
  const diagnostics: ImportDiagnostic[] = [];
  const snapshots: SleeperRawSnapshot[] = [];

  const league = await input.adapter.getLeague(input.sleeperLeagueId);
  collectAdapterDiagnostics(league.diagnostics, diagnostics);
  snapshots.push(league.snapshot);

  const rosters = await input.adapter.getLeagueRosters(input.sleeperLeagueId);
  collectAdapterDiagnostics(rosters.diagnostics, diagnostics);
  snapshots.push(rosters.snapshot);

  const users = await input.adapter.getLeagueUsers(input.sleeperLeagueId);
  collectAdapterDiagnostics(users.diagnostics, diagnostics);
  snapshots.push(users.snapshot);

  const franchiseMap = buildFranchiseMap({
    leagueId: input.leagueId,
    rosters: rosters.data,
    users: users.data,
    overrides: input.franchiseOverrides,
  });
  for (const diagnostic of franchiseMap.diagnostics) {
    diagnostics.push({
      stage: 'franchise_mapping',
      level: diagnostic.level,
      code: diagnostic.code,
      message: diagnostic.message,
    });
  }

  const drafts = await input.adapter.getLeagueDrafts(input.sleeperLeagueId);
  collectAdapterDiagnostics(drafts.diagnostics, diagnostics);
  snapshots.push(drafts.snapshot);

  const draft = selectDraft(drafts.data, input.sleeperDraftId);
  if (!draft) {
    diagnostics.push({
      stage: 'import',
      level: 'error',
      code: 'draft_not_found',
      message: input.sleeperDraftId
        ? `League ${input.sleeperLeagueId} has no draft ${input.sleeperDraftId}; pick ownership was not reconstructed.`
        : `League ${input.sleeperLeagueId} has no drafts; pick ownership was not reconstructed.`,
    });
    return {
      franchises: franchiseMap.franchises,
      franchiseMap,
      pickInventory: [],
      ownership: null,
      orderConfig: null,
      diagnostics,
      snapshots,
    };
  }

  const selections = await input.adapter.getDraftPicks(draft.sleeperDraftId);
  collectAdapterDiagnostics(selections.diagnostics, diagnostics);
  snapshots.push(selections.snapshot);

  const tradedPicks = await input.adapter.getLeagueTradedPicks(input.sleeperLeagueId);
  collectAdapterDiagnostics(tradedPicks.diagnostics, diagnostics);
  snapshots.push(tradedPicks.snapshot);

  const orderConfig = resolveOrderConfig(
    input,
    draft.rounds,
    draft.teamCount,
    league.data.totalRosters,
    draft.type,
  );
  if (!orderConfig) {
    diagnostics.push({
      stage: 'import',
      level: 'error',
      code: 'indeterminate_draft_shape',
      message:
        'Sleeper did not report a usable team count and round count for this draft, and none was supplied; pick ownership was not reconstructed.',
    });
    return {
      franchises: franchiseMap.franchises,
      franchiseMap,
      pickInventory: [],
      ownership: null,
      orderConfig: null,
      diagnostics,
      snapshots,
    };
  }

  const ownership = reconstructDraftPickInventory({
    seasonId: input.seasonId,
    sleeperSeason: league.data.season,
    orderConfig,
    draft,
    rosterIdToFranchiseId: franchiseMap.rosterIdToFranchiseId,
    sleeperUserIdToFranchiseId: franchiseMap.sleeperUserIdToFranchiseId,
    tradedPicks: tradedPicks.data,
    selections: selections.data,
    overrides: input.ownershipOverrides,
  });
  for (const diagnostic of ownership.diagnostics) {
    diagnostics.push({
      stage: 'pick_ownership',
      level: diagnostic.level,
      code: diagnostic.code,
      message: diagnostic.message,
    });
  }

  return {
    franchises: franchiseMap.franchises,
    franchiseMap,
    pickInventory: ownership.pickInventory,
    ownership,
    orderConfig,
    diagnostics,
    snapshots,
  };
}

function selectDraft<T extends { sleeperDraftId: string; startTime: number | null }>(
  drafts: readonly T[],
  sleeperDraftId: string | undefined,
): T | null {
  if (sleeperDraftId) {
    return drafts.find((draft) => draft.sleeperDraftId === sleeperDraftId) ?? null;
  }

  // Newest first, so a league that has run a mock alongside its real draft still lands
  // on the most recent one rather than an arbitrary array position.
  return [...drafts].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))[0] ?? null;
}

function resolveOrderConfig(
  input: ImportSeasonDraftStateInput,
  draftRounds: number | null,
  draftTeamCount: number | null,
  leagueTotalRosters: number,
  draftType: string,
): DraftOrderConfig | null {
  const teamCount = input.orderConfig?.teamCount ?? draftTeamCount ?? leagueTotalRosters;
  const rounds = input.orderConfig?.rounds ?? draftRounds;
  if (!teamCount || !rounds) {
    return null;
  }

  return {
    teamCount,
    rounds,
    orderMethod: input.orderConfig?.orderMethod ?? (draftType === 'linear' ? 'linear' : 'snake'),
    thirdRoundReversal: input.orderConfig?.thirdRoundReversal ?? false,
  };
}

function collectAdapterDiagnostics(
  adapterDiagnostics: readonly SleeperDiagnostic[],
  diagnostics: ImportDiagnostic[],
): void {
  for (const diagnostic of adapterDiagnostics) {
    diagnostics.push({
      stage: 'adapter',
      level: diagnostic.level,
      code: `${diagnostic.endpoint}_unknown_field`,
      message: diagnostic.message,
    });
  }
}
