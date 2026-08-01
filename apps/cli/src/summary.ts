import { formatDraftPick, type LeagueStateSnapshot, type Player } from '@keeper/domain';
import {
  KEEPER_OPTIMIZATION_MODES,
  optimizeKeeperCombinations,
  resolveKeeperCombinations,
  type KeeperOptimizationResult,
} from '@keeper/keeper-optimizer';
import {
  computeReplacementLevels,
  createPickValueCurveFromRankedValues,
  createSnapshotProjectionSource,
  type ReplacementCandidate,
} from '@keeper/valuation';

export interface BuildLeagueSummaryOptions {
  players?: Player[];
}

export function buildLeagueSummary(
  snapshot: LeagueStateSnapshot,
  options: BuildLeagueSummaryOptions = {},
): string[] {
  const userRights = snapshot.keeperRights.filter(
    (right) => right.franchiseId === snapshot.userFranchiseId,
  );
  const legalCombinations = resolveKeeperCombinations({
    keeperRights: userRights,
    pickInventory: snapshot.pickInventory,
    franchiseId: snapshot.userFranchiseId,
    maxKeepers: snapshot.league.rules.maxKeepers,
    includeIllegal: false,
  });

  const lines = [
    `# ${snapshot.league.name} (${snapshot.season.year})`,
    '',
    `- Teams: ${snapshot.league.rules.teamCount}`,
    `- Draft rounds: ${snapshot.league.rules.draftRounds}`,
    `- Pick inventory loaded: ${snapshot.pickInventory.length} assets`,
    `- User franchise: ${snapshot.userFranchiseId}`,
    '',
    '## Keeper-Eligible Players',
    ...userRights.map(
      (right) =>
        `- ${right.playerId} (nominal round ${right.nominalRound}, source: ${right.sourceType})`,
    ),
    '',
    `Legal keeper combinations enumerated: ${legalCombinations.length}`,
  ];

  if (!options.players) {
    lines.push('Pass a player catalog to include IV/KSV/TCV optimization tables.');
    return lines;
  }

  const optimization = buildOptimization(snapshot, options.players);
  lines.push('', ...renderOptimizationMarkdown(optimization));
  return lines;
}

function buildOptimization(
  snapshot: LeagueStateSnapshot,
  players: Player[],
): KeeperOptimizationResult {
  return optimizeKeeperCombinations({
    keeperRights: snapshot.keeperRights,
    pickInventory: snapshot.pickInventory,
    players,
    franchiseId: snapshot.userFranchiseId,
    seasonId: snapshot.season.id,
    evaluatedAt: snapshot.evaluatedAt,
    projectionSource: createSnapshotProjectionSource(snapshot),
    replacementLevels: computeReplacementLevels({
      candidates: buildReplacementCandidates(snapshot, players),
      lineup: snapshot.league.lineup,
      teamCount: snapshot.league.rules.teamCount,
    }),
    pickValueCurve: createPickValueCurveFromRankedValues(buildFixturePickValues(snapshot)),
    maxKeepers: snapshot.league.rules.maxKeepers,
    rulesVersion: snapshot.league.rulesVersion,
  });
}

function renderOptimizationMarkdown(optimization: KeeperOptimizationResult): string[] {
  const lines = [
    '## Best Keeper Views',
    '| Mode | Score | Keepers |',
    '| --- | ---: | --- |',
    ...KEEPER_OPTIMIZATION_MODES.map((mode) => {
      const best = optimization.bestByMode[mode];
      return `| ${mode} | ${best ? formatNumber(best.modeScores[mode]) : '-'} | ${
        best ? formatKeeperValuations(best.playerValuations) : '-'
      } |`;
    }),
    '',
    '## Legal Keeper Sets',
    '| Score | Keepers | Retained IV | Pick Cost | KSV | TCV | Displacements |',
    '| ---: | --- | ---: | ---: | ---: | ---: | --- |',
    ...optimization.combinations.map(
      (combination) =>
        `| ${formatNumber(combination.totalScore)} | ${formatKeeperValuations(
          combination.playerValuations,
        )} | ${formatNumber(combination.retainedIntrinsicValue)} | ${formatNumber(
          combination.consumedPickValue,
        )} | ${formatNumber(combination.keeperSurplusValue)} | ${formatNumber(
          combination.teamContextValue,
        )} | ${formatDisplacements(combination.displacements)} |`,
    ),
  ];

  return lines;
}

function buildReplacementCandidates(
  snapshot: LeagueStateSnapshot,
  players: Player[],
): ReplacementCandidate[] {
  const projectedPointsByPlayerId = new Map(
    snapshot.playerSeasons
      .filter((playerSeason) => playerSeason.projectedPoints !== null)
      .map((playerSeason) => [playerSeason.playerId, playerSeason.projectedPoints!]),
  );

  return players.flatMap((player) => {
    const projectedPoints = projectedPointsByPlayerId.get(player.id);
    return projectedPoints === undefined ? [] : [{ position: player.position, projectedPoints }];
  });
}

function buildFixturePickValues(snapshot: LeagueStateSnapshot): number[] {
  const pickCount =
    (snapshot.draft?.teamCount ?? snapshot.league.rules.teamCount) *
    (snapshot.draft?.rounds ?? snapshot.league.rules.draftRounds);
  return Array.from({ length: pickCount }, (_, index) => Math.max(0, 120 - index * 0.75));
}

function formatKeeperValuations(
  playerValuations: KeeperOptimizationResult['combinations'][number]['playerValuations'],
): string {
  if (playerValuations.length === 0) {
    return 'None';
  }

  return playerValuations
    .map(
      (player) =>
        `${player.fullName} (round ${player.nominalRound} -> ${formatResolvedPick(
          player.resolvedRound,
          player.resolvedSlot,
          player.resolvedOverallPick,
        )})`,
    )
    .join(', ');
}

function formatDisplacements(
  displacements: KeeperOptimizationResult['combinations'][number]['displacements'],
): string {
  if (displacements.length === 0) {
    return 'None';
  }

  return displacements
    .map(
      (displacement) =>
        `${displacement.keeperRightId}: round ${displacement.nominalRound} -> round ${displacement.resolvedRound} (${displacement.cause})`,
    )
    .join('; ');
}

function formatResolvedPick(round: number, slot: number | null, overallPick: number): string {
  const slotLabel = slot === null ? `round ${round}` : formatDraftPick(round, slot);
  return `${slotLabel}, overall ${overallPick}`;
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
