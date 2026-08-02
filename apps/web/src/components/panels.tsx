import type { FranchiseId, LeagueStateSnapshot, Position } from '@keeper/domain';
import type { KeeperOptimizationResult } from '@keeper/keeper-optimizer';
import type { ReplacementLevels } from '@keeper/valuation';
import type { AppContext } from '../app-state.js';
import type { BoardViewModel } from '../view-models/boards.js';
import type { PickHorizon } from '../view-models/pick-horizon.js';
import type { SyncStatusViewModel } from '../view-models/sync-status.js';

const POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'DEF'];

/**
 * Says where these numbers came from, and what is known to be missing from them.
 *
 * Sits at the top because the difference between a real league and demonstration data is
 * the single most important thing on the page: everything below looks equally authoritative
 * either way.
 */
export function DataSourcePanel({
  context,
  franchiseId,
  onFranchiseChange,
}: {
  context: AppContext;
  franchiseId: FranchiseId;
  onFranchiseChange: (franchiseId: FranchiseId) => void;
}) {
  const isFixture = context.source === 'fixture';
  return (
    <section className={`panel ${isFixture ? 'tone-warning' : 'tone-ok'}`}>
      <h2>{isFixture ? 'Demonstration data' : context.snapshot.league.name}</h2>
      <p className="muted">
        {isFixture
          ? 'Synthetic league. Nothing here reflects a real roster.'
          : `${context.players.length} projected players · ${context.snapshot.keeperRights.length} declared keeper(s) · ${context.snapshot.franchises.length} franchises`}
      </p>

      {/* Recommendations are specific to one team's keepers and one team's picks, so which
          team is being viewed has to be visible rather than implied. */}
      <label className="franchise-picker">
        Viewing as{' '}
        <select
          value={franchiseId}
          onChange={(event) => onFranchiseChange(event.target.value as FranchiseId)}
        >
          {context.snapshot.franchises.map((franchise) => (
            <option key={franchise.id} value={franchise.id}>
              {franchise.displayName}
            </option>
          ))}
        </select>
      </label>

      {context.caveats.map((caveat) => (
        <p key={caveat} className="warning">
          {caveat}
        </p>
      ))}
    </section>
  );
}

export function SyncStatusPanel({ status }: { status: SyncStatusViewModel }) {
  return (
    <section className={`panel tone-${status.tone}`}>
      <h2>{status.headline}</h2>
      <p>{status.detail}</p>
      {status.showStaleWarning ? (
        <p className="warning">
          This board may be out of date. Nothing below reflects picks made since the last successful
          sync.
        </p>
      ) : null}
      {status.manualPickCount > 0 ? (
        <p className="warning">{status.manualPickCount} pick(s) entered by hand.</p>
      ) : null}
    </section>
  );
}

export function SetupPanel({
  snapshot,
  replacementLevels,
}: {
  snapshot: LeagueStateSnapshot;
  replacementLevels: ReplacementLevels;
}) {
  const { league, season } = snapshot;
  return (
    <section className="panel">
      <h2>Setup</h2>
      <dl>
        <dt>League</dt>
        <dd>
          {league.name} ({season.year})
        </dd>
        <dt>Teams / rounds</dt>
        <dd>
          {league.rules.teamCount} / {league.rules.draftRounds}
        </dd>
        <dt>Keeper limit</dt>
        <dd>{league.rules.maxKeepers}</dd>
        <dt>Keeper cost</dt>
        <dd>Advances {league.rules.keeperCostAdvancePerSeason} round(s) per season</dd>
        <dt>Undrafted keeper round</dt>
        <dd>{league.rules.undraftedKeeperRound}</dd>
        <dt>Pick inventory</dt>
        <dd>{snapshot.pickInventory.length} assets</dd>
        <dt>Lineup</dt>
        <dd>
          {league.lineup.qb}QB {league.lineup.rb}RB {league.lineup.wr}WR {league.lineup.te}TE{' '}
          {league.lineup.flex}FLEX {league.lineup.def}DEF · {league.lineup.bench} bench
        </dd>
        {/* Every value on this page is a distance above these lines, so they are shown
            rather than buried: a replacement level that looks wrong explains a board that
            looks wrong. */}
        <dt>Replacement level</dt>
        <dd>
          {POSITIONS.map(
            (position) => `${position} ${formatNumber(replacementLevels[position] ?? 0)}`,
          ).join(' · ')}
        </dd>
        <dt>Rules version</dt>
        <dd>{league.rulesVersion}</dd>
      </dl>
    </section>
  );
}

export function PickHorizonPanel({ horizon }: { horizon: PickHorizon }) {
  return (
    <section className="panel">
      <h2>Pick horizon</h2>
      <p>
        Current pick: {horizon.currentOverallPick ?? 'draft complete'} · Your next pick:{' '}
        {horizon.userNextOverallPick ?? 'none left'} ·{' '}
        {horizon.picksUntilUserTurn === null
          ? 'No further turn'
          : horizon.picksUntilUserTurn === 0
            ? 'You are on the clock'
            : `${horizon.picksUntilUserTurn} pick(s) until your turn`}
      </p>
      <ol className="horizon">
        {horizon.upcoming.map((pick) => (
          <li key={pick.overallPick} className={pick.isUser ? 'is-user' : undefined}>
            {pick.overallPick}. {pick.displayName} (round {pick.round})
          </li>
        ))}
      </ol>
    </section>
  );
}

export function BoardPanel({ board }: { board: BoardViewModel }) {
  return (
    <section className="panel">
      <h2>{board.title}</h2>
      <p className="muted">{board.poolDescription}</p>
      {board.caveats.map((caveat) => (
        <p key={caveat} className="warning">
          {caveat}
        </p>
      ))}
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Tier</th>
            <th>Player</th>
            <th>Pos</th>
            <th>Proj</th>
            <th>IV</th>
            <th>At your pick</th>
          </tr>
        </thead>
        <tbody>
          {board.board.rows.map((row) => (
            <tr key={row.playerId}>
              <td>{row.rank}</td>
              <td>{row.tier}</td>
              <td>{row.fullName}</td>
              <td>{row.position}</td>
              <td>{formatNumber(row.projectedPoints)}</td>
              <td>{formatNumber(row.intrinsicValue)}</td>
              <td>
                {row.valueAtUserNextPick === null ? '—' : formatNumber(row.valueAtUserNextPick)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function KeeperCombinationsPanel({
  optimization,
}: {
  optimization: KeeperOptimizationResult;
}) {
  return (
    <section className="panel">
      <h2>Keeper combinations</h2>
      <h3>Best by mode</h3>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Score</th>
            <th>Keepers</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(optimization.bestByMode).map(([mode, combination]) => (
            <tr key={mode}>
              <td>{mode}</td>
              <td>
                {combination === null ? '—' : formatNumber(combination.modeScores[mode as never])}
              </td>
              <td>{combination === null ? '—' : describeKeepers(combination)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Every legal set</h3>
      <table>
        <thead>
          <tr>
            <th>Score</th>
            <th>Keepers</th>
            <th>Retained IV</th>
            <th>Pick cost</th>
            <th>KSV</th>
            <th>TCV</th>
          </tr>
        </thead>
        <tbody>
          {optimization.combinations.map((combination) => (
            <tr key={combination.selectedKeeperRightIds.join('|') || 'none'}>
              <td>{formatNumber(combination.totalScore)}</td>
              <td>{describeKeepers(combination)}</td>
              <td>{formatNumber(combination.retainedIntrinsicValue)}</td>
              <td>{formatNumber(combination.consumedPickValue)}</td>
              <td>{formatNumber(combination.keeperSurplusValue)}</td>
              <td>{formatNumber(combination.teamContextValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function RecommendationPanel({ optimization }: { optimization: KeeperOptimizationResult }) {
  const best = optimization.bestByMode.expected;
  if (!best) {
    return (
      <section className="panel">
        <h2>Recommendation</h2>
        <p>No legal keeper set was found.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Recommendation</h2>
      <p>{describeKeepers(best)}</p>
      <pre>{best.explanation}</pre>
    </section>
  );
}

function describeKeepers(combination: KeeperOptimizationResult['combinations'][number]): string {
  if (combination.playerValuations.length === 0) {
    return 'Keep nobody';
  }
  return combination.playerValuations
    .map(
      (player) =>
        `${player.fullName} (round ${player.nominalRound} → overall ${player.resolvedOverallPick})`,
    )
    .join(', ');
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
