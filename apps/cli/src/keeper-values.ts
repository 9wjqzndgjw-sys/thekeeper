import type { FranchiseId, KeeperRight, Position, SeasonId } from '@keeper/domain';
import { createAnonClient, loadLeagueSnapshot } from '@keeper/persistence';
import { optimizeKeeperCombinations, resolveKeeperCombination } from '@keeper/keeper-optimizer';
import {
  buildDeclarationScenarios,
  computeIntrinsicValue,
  computeKeeperSurplusValue,
  createSnapshotProjectionSource,
  type PickValueCurve,
} from '@keeper/valuation';
import { resolveSleeperLeagueId } from './league-config.js';

/**
 * Prices keepers two ways, against the exact pick each consumes.
 *
 *   npm run keeper-values -w @keeper/cli [-- --all]
 *
 * Every rostered player is a candidate, so this reports both what each franchise declared
 * and what it could have declared instead. `--all` prints the best alternative sets too.
 *
 * The two valuations differ only in whether the rest of the league's declarations are
 * assumed to hold. Nothing else moves: replacement level, and therefore intrinsic value, is
 * the same in both, because a kept player takes a roster slot off the board along with
 * himself. What changes is what a pick would otherwise have bought.
 */
const args = process.argv.slice(2);
const showAlternatives = args.includes('--all');
const sleeperLeagueId = resolveSleeperLeagueId(args.find((arg) => !arg.startsWith('--')));
const seasonId = `season:${sleeperLeagueId}` as SeasonId;

const loaded = await loadLeagueSnapshot({
  client: createAnonClient(process.env),
  seasonId,
});
const snapshot = loaded.snapshot;
const projectionSource = createSnapshotProjectionSource(snapshot);

const pointsOf = (playerId: string): number =>
  projectionSource.getProjectedPoints(playerId as never, snapshot.season.id) ?? 0;
const positionById = new Map(loaded.players.map((p) => [String(p.id), p.position as Position]));
const nameById = new Map(loaded.players.map((p) => [String(p.id), p.fullName]));

const scenarios = buildDeclarationScenarios({
  candidates: loaded.players.map((player) => ({
    position: player.position as Position,
    projectedPoints: pointsOf(String(player.id)),
    declared: loaded.declaredPlayerIds.has(String(player.id)),
  })),
  lineup: snapshot.league.lineup,
  teamCount: snapshot.league.rules.teamCount,
});

// A candidate with no projection cannot be valued. Treating him as zero would rank him as
// a uniquely bad keeper, which is a claim rather than a measurement, so he is set aside and
// counted instead.
const projectedIds = new Set(loaded.players.map((player) => String(player.id)));
const valuable = snapshot.keeperRights.filter((right) => projectedIds.has(String(right.playerId)));
const unprojected = snapshot.keeperRights.length - valuable.length;

const rightsByFranchise = new Map<string, KeeperRight[]>();
for (const right of valuable) {
  rightsByFranchise.set(String(right.franchiseId), [
    ...(rightsByFranchise.get(String(right.franchiseId)) ?? []),
    right,
  ]);
}

console.log(`League:            ${snapshot.league.name} (${snapshot.season.year})`);
console.log(
  `Keeper candidates: ${snapshot.keeperRights.length} across ${snapshot.franchises.length} rosters`,
);
console.log(`Declared:          ${loaded.declaredPlayerIds.size}`);
if (unprojected > 0) {
  console.log(`Not valued:        ${unprojected} rostered player(s) carry no projection`);
}
console.log(
  `\nReplacement levels: ${(['QB', 'RB', 'WR', 'TE', 'DEF'] as const)
    .map((p) => `${p} ${(scenarios.replacementLevels[p] ?? 0).toFixed(0)}`)
    .join('  ')}`,
);

const intrinsicOf = (playerId: string): number =>
  computeIntrinsicValue({
    projectedPoints: pointsOf(playerId),
    replacementLevel: scenarios.replacementLevels[positionById.get(playerId) ?? 'RB'] ?? 0,
  }).intrinsicValue;

const surplusAt = (playerId: string, overallPick: number, curve: PickValueCurve): number =>
  computeKeeperSurplusValue({
    intrinsicValue: intrinsicOf(playerId),
    pickValueCurve: curve,
    exactOverallPick: overallPick,
  }).keeperSurplusValue;

console.log(
  '\nEach keeper priced two ways. "floor" assumes the rest of the league could still change',
);
console.log('its mind; "declared" takes the twelve declarations at face value.\n');

for (const franchise of snapshot.franchises) {
  const rights = rightsByFranchise.get(franchise.id) ?? [];
  const declaredRights = rights.filter((r) => loaded.declaredPlayerIds.has(String(r.playerId)));
  if (rights.length === 0) {
    continue;
  }

  const resolution = resolveKeeperCombination(declaredRights, snapshot.pickInventory, {
    franchiseId: franchise.id as FranchiseId,
    maxKeepers: snapshot.league.rules.maxKeepers,
  });

  let floorTotal = 0;
  let declaredTotal = 0;
  const lines: string[] = [];

  for (const resolved of resolution.resolvedPicks) {
    const playerId = String(resolved.playerId);
    const floor = surplusAt(playerId, resolved.resolvedOverallPick, scenarios.ignoringDeclarations);
    const held = surplusAt(playerId, resolved.resolvedOverallPick, scenarios.assumingDeclarations);
    floorTotal += floor;
    declaredTotal += held;

    const displaced = resolution.displacements.find(
      (d) => d.keeperRightId === resolved.keeperRightId,
    );
    lines.push(
      `   ${(nameById.get(playerId) ?? playerId).padEnd(22)}` +
        ` ${(positionById.get(playerId) ?? '').padEnd(3)}` +
        ` r${String(resolved.nominalRound).padStart(2)} -> pick ${String(resolved.resolvedOverallPick).padStart(3)}` +
        `  IV ${intrinsicOf(playerId).toFixed(0).padStart(4)}` +
        `  floor ${floor.toFixed(0).padStart(5)}` +
        `  declared ${held.toFixed(0).padStart(5)}` +
        (floor < 0 && held >= 0 ? '  [contingent]' : '') +
        (displaced ? `  [${displaced.cause}]` : ''),
    );
  }

  console.log(
    `${franchise.displayName}  (${rights.length} candidates, floor ${floorTotal.toFixed(0)} / declared ${declaredTotal.toFixed(0)})`,
  );
  for (const line of lines) {
    console.log(line);
  }

  if (showAlternatives) {
    // The whole roster is eligible, so the best set is a real search rather than a subset of
    // three. Run under the floor curve: a set that wins there does not depend on anyone else.
    const best = optimizeKeeperCombinations({
      keeperRights: rights,
      pickInventory: snapshot.pickInventory,
      players: loaded.players,
      franchiseId: franchise.id as FranchiseId,
      seasonId: snapshot.season.id,
      evaluatedAt: snapshot.evaluatedAt,
      projectionSource,
      replacementLevels: scenarios.replacementLevels,
      pickValueCurve: scenarios.ignoringDeclarations,
      maxKeepers: snapshot.league.rules.maxKeepers,
      rulesVersion: snapshot.league.rulesVersion,
    }).bestByMode.expected;

    if (best) {
      const declaredIds = new Set(declaredRights.map((r) => String(r.playerId)));
      const bestIds = new Set(best.playerValuations.map((p) => String(p.playerId)));
      const same =
        bestIds.size === declaredIds.size && [...bestIds].every((id) => declaredIds.has(id));
      console.log(
        `   best available (floor ${best.keeperSurplusValue.toFixed(0)}): ${
          best.playerValuations
            .map((p) => `${p.fullName} r${p.nominalRound}->${p.resolvedOverallPick}`)
            .join(', ') || 'keep nobody'
        }${same ? '  = declared' : ''}`,
      );
    }
  }
  console.log('');
}

for (const caveat of loaded.caveats) {
  console.log(`  note: ${caveat}`);
}
