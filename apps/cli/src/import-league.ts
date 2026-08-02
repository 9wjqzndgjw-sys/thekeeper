import type { LeagueId, SeasonId } from '@keeper/domain';
import { createSleeperAdapter, importSeasonDraftState } from '@keeper/sleeper-adapter';
import { resolveSleeperLeagueId } from './league-config.js';

/**
 * Runs the read-only Sleeper import against a live league and prints what it resolved.
 *
 *   npm run import -w @keeper/cli [-- <sleeperLeagueId>]
 */
const sleeperLeagueId = resolveSleeperLeagueId(
  process.argv.slice(2).find((arg) => !arg.startsWith('--')),
);

const result = await importSeasonDraftState({
  adapter: createSleeperAdapter(),
  leagueId: `league:${sleeperLeagueId}` as LeagueId,
  seasonId: 'season-2026' as SeasonId,
  sleeperLeagueId,
});

console.log(`League ${sleeperLeagueId}`);
console.log(`  franchises      : ${result.franchises.length}`);
console.log(`  draft shape     : ${JSON.stringify(result.orderConfig)}`);
console.log(`  pick inventory  : ${result.pickInventory.length}`);
console.log(`  endpoints read  : ${result.snapshots.map((s) => s.endpoint).join(', ')}`);

console.log('\nFranchises');
for (const franchise of result.franchises) {
  console.log(`  ${franchise.displayName.padEnd(22)} ${franchise.id}`);
}

const traded = result.pickInventory.filter(
  (pick) => pick.originalFranchiseId !== pick.currentFranchiseId,
);
console.log(`\nTraded picks resolved: ${traded.length}`);
const nameById = new Map(result.franchises.map((f) => [f.id, f.displayName]));
for (const pick of traded) {
  console.log(
    `  R${String(pick.round).padStart(2)} overall ${String(pick.overallPick).padStart(3)}  ` +
      `${(nameById.get(pick.originalFranchiseId) ?? '?').padEnd(20)} -> ` +
      `${(nameById.get(pick.currentFranchiseId) ?? '?').padEnd(20)} [${pick.ownershipConfidence}]`,
  );
}

console.log(`\nDiagnostics: ${result.diagnostics.length}`);
for (const diagnostic of result.diagnostics) {
  console.log(
    `  [${diagnostic.stage}/${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}`,
  );
}
