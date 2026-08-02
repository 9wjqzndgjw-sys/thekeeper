import { readFileSync } from 'node:fs';
import type { FranchiseId, SeasonId } from '@keeper/domain';
import { createServiceClientFromEnv, KeeperRepository } from '@keeper/persistence';
import { loadProjections } from '@keeper/projections';
import { resolveKeeperCombination } from '@keeper/keeper-optimizer';
import {
  computeIntrinsicValue,
  computeKeeperSurplusValue,
  computeReplacementLevels,
  createPickValueCurveFromRankedValues,
} from '@keeper/valuation';
import {
  LEAGUE_LINEUP,
  LEAGUE_SCORING,
  LEAGUE_TEAM_COUNT,
  resolveSleeperLeagueId,
} from './league-config.js';

/**
 * Prices every declared keeper in the league against the exact pick it consumes.
 *
 *   npm run keeper-values -w @keeper/cli
 *
 * Pulls declarations, pick ownership, and player identity from the database, scores
 * projections under the league's own settings, then resolves each franchise's declared
 * set against the picks that franchise actually owns -- so a traded-away round shows up
 * as displacement onto an earlier pick rather than a round label.
 */
const sleeperLeagueId = resolveSleeperLeagueId(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')),
);
const seasonId = `season:${sleeperLeagueId}` as SeasonId;

const skillCsv = process.env.KEEPER_SKILL_PROJECTIONS_CSV;
const defenseCsv = process.env.KEEPER_DEFENSE_PROJECTIONS_CSV;
if (!skillCsv) {
  console.error('Set KEEPER_SKILL_PROJECTIONS_CSV in .env.local.');
  process.exit(1);
}

const repository = new KeeperRepository(createServiceClientFromEnv());
const [catalog, keeperRights, pickInventory, franchises] = await Promise.all([
  repository.readAllPlayers(),
  repository.readKeeperRights(seasonId),
  repository.readPickInventory(seasonId),
  repository.readFranchises(seasonId),
]);

const projections = loadProjections({
  skillPositionCsv: readFileSync(skillCsv, 'utf8'),
  defenseCsv: defenseCsv ? readFileSync(defenseCsv, 'utf8') : undefined,
  scoring: LEAGUE_SCORING,
  seasonId,
});

/**
 * Punctuation and case are dropped so Ja'Marr and JaMarr are the same player, and a
 * generational suffix is removed because projection sources carry it while Sleeper often
 * does not: "Kenneth Walker III" and "Kenneth Walker" are one player.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z]/g, '');
}

const projectedByKey = new Map<string, number>();
const projectedById = new Map<string, number>(
  projections.playerSeasons.map((season) => [String(season.playerId), season.projectedPoints ?? 0]),
);
for (const player of projections.players) {
  const key = `${player.position}:${normalizeName(player.fullName)}`;
  projectedByKey.set(key, projectedById.get(String(player.id)) ?? 0);
}

// Match on position plus normalized name: the projection exports carry no Sleeper ids.
const pointsBySleeperId = new Map<string, number>();
for (const player of catalog) {
  if (!player.sleeperPlayerId) {
    continue;
  }
  const key = `${player.position}:${normalizeName(player.fullName)}`;
  const points = projectedByKey.get(key);
  if (points !== undefined) {
    pointsBySleeperId.set(player.sleeperPlayerId, points);
  }
}

const positionBySleeperId = new Map(
  catalog.filter((p) => p.sleeperPlayerId).map((p) => [p.sleeperPlayerId!, p.position]),
);
const nameBySleeperId = new Map(
  catalog.filter((p) => p.sleeperPlayerId).map((p) => [p.sleeperPlayerId!, p.fullName]),
);

const declaredIds = new Set(keeperRights.map((right) => String(right.playerId)));
const unmatchedKeepers = [...declaredIds].filter((id) => !pointsBySleeperId.has(id));

console.log(
  `Projections matched to catalog: ${pointsBySleeperId.size} of ${projections.players.length}`,
);
if (unmatchedKeepers.length > 0) {
  console.log(
    `Declared keepers with no projection: ${unmatchedKeepers.map((id) => nameBySleeperId.get(id) ?? id).join(', ')}`,
  );
}

// Replacement comes from the pool that is actually draftable, so declared keepers are out.
const replacementLevels = computeReplacementLevels({
  candidates: [...pointsBySleeperId.entries()]
    .filter(([id]) => !declaredIds.has(id))
    .map(([id, projectedPoints]) => ({
      position: (positionBySleeperId.get(id) ?? 'RB') as 'QB' | 'RB' | 'WR' | 'TE' | 'DEF',
      projectedPoints,
    })),
  lineup: LEAGUE_LINEUP,
  teamCount: LEAGUE_TEAM_COUNT,
});

// A pick is worth the best player still on the board when it comes up. One player leaves
// the pool per pick, so ranking the draftable pool by value and reading off position N
// gives what pick N can buy.
//
// Ordering by ADP instead looks tempting, since it reflects where the market takes people,
// but it produces a curve that is not monotonic: the player who happens to go 92nd may be
// worth less than the one who goes 93rd, which would price the earlier pick below the
// later one.
const draftBoardValues = [...pointsBySleeperId.entries()]
  .filter(([id]) => !declaredIds.has(id))
  .map(([id, projectedPoints]) => {
    const position = (positionBySleeperId.get(id) ?? 'RB') as 'QB' | 'RB' | 'WR' | 'TE' | 'DEF';
    return computeIntrinsicValue({
      projectedPoints,
      replacementLevel: replacementLevels[position] ?? 0,
    }).intrinsicValue;
  })
  .sort((left, right) => right - left);

const pickValueCurve = createPickValueCurveFromRankedValues(draftBoardValues);

console.log(
  `\nReplacement levels: ${(['QB', 'RB', 'WR', 'TE', 'DEF'] as const)
    .map((p) => `${p} ${(replacementLevels[p] ?? 0).toFixed(0)}`)
    .join('  ')}`,
);

const rightsByFranchise = new Map<FranchiseId, typeof keeperRights>();
for (const right of keeperRights) {
  rightsByFranchise.set(right.franchiseId, [
    ...(rightsByFranchise.get(right.franchiseId) ?? []),
    right,
  ]);
}

const rows: { franchise: string; total: number; lines: string[] }[] = [];

for (const franchise of franchises) {
  const rights = rightsByFranchise.get(franchise.id as FranchiseId) ?? [];
  if (rights.length === 0) {
    continue;
  }

  const resolution = resolveKeeperCombination(rights, pickInventory, {
    franchiseId: franchise.id as FranchiseId,
    maxKeepers: 3,
  });

  const lines: string[] = [];
  let total = 0;

  if (!resolution.legal) {
    lines.push(`   ILLEGAL: ${resolution.invalidReason}`);
  }

  for (const resolved of resolution.resolvedPicks) {
    const sleeperId = String(resolved.playerId);
    const points = pointsBySleeperId.get(sleeperId);
    const position = (positionBySleeperId.get(sleeperId) ?? 'RB') as
      'QB' | 'RB' | 'WR' | 'TE' | 'DEF';
    const name = nameBySleeperId.get(sleeperId) ?? sleeperId;

    if (points === undefined) {
      lines.push(`   ${name.padEnd(22)} r${resolved.nominalRound} -> no projection`);
      continue;
    }

    const intrinsic = computeIntrinsicValue({
      projectedPoints: points,
      replacementLevel: replacementLevels[position] ?? 0,
    });
    const surplus = computeKeeperSurplusValue({
      intrinsicValue: intrinsic.intrinsicValue,
      pickValueCurve,
      exactOverallPick: resolved.resolvedOverallPick,
    });
    total += surplus.keeperSurplusValue;

    const displaced = resolution.displacements.find(
      (d) => d.keeperRightId === resolved.keeperRightId,
    );
    lines.push(
      `   ${name.padEnd(22)} ${position.padEnd(3)} r${String(resolved.nominalRound).padStart(2)}` +
        ` -> pick ${String(resolved.resolvedOverallPick).padStart(3)}` +
        `  IV ${intrinsic.intrinsicValue.toFixed(0).padStart(4)}` +
        `  cost ${surplus.breakdown.pickOpportunityCost.toFixed(0).padStart(4)}` +
        `  KSV ${surplus.keeperSurplusValue.toFixed(0).padStart(5)}` +
        (displaced ? `  [${displaced.cause}]` : ''),
    );
  }

  rows.push({ franchise: franchise.displayName, total, lines });
}

console.log('\nDeclared keepers, priced against the exact pick each consumes\n');
for (const row of rows.sort((a, b) => b.total - a.total)) {
  console.log(`${row.franchise}  (total KSV ${row.total.toFixed(0)})`);
  for (const line of row.lines) {
    console.log(line);
  }
  console.log('');
}
