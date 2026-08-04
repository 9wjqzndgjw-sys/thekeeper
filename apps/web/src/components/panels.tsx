import type { FranchiseId, LeagueStateSnapshot, Position } from '@keeper/domain';
import type { KeeperOptimizationResult } from '@keeper/keeper-optimizer';
import type { ReplacementLevels } from '@keeper/valuation';
import type { AppContext, FranchiseOutlook } from '../app-state.js';
import type { BoardViewModel } from '../view-models/boards.js';
import { buildKeeperModes } from '../view-models/keeper-modes.js';
import type { PickHorizon } from '../view-models/pick-horizon.js';
import type { SyncStatusViewModel } from '../view-models/sync-status.js';
import { PanelShell } from './panel-shell.js';

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
          : `${context.players.length} projected players · ${context.snapshot.keeperRights.length} keeper candidate(s) · ${context.declaredPlayerIds.size} declared · ${context.snapshot.franchises.length} franchises`}
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

export function BoardPanel({
  board,
  expanded = false,
  onExpand,
  onClose,
}: {
  board: BoardViewModel;
  expanded?: boolean;
  onExpand?: () => void;
  onClose?: () => void;
}) {
  return (
    <PanelShell title={board.title} expanded={expanded} onExpand={onExpand ?? noop} onClose={onClose ?? noop}>
      <p className="muted">{board.poolDescription}</p>
      {board.caveats.map((caveat) => (
        <p key={caveat} className="warning">
          {caveat}
        </p>
      ))}
      <p className="table-scroll-hint muted">Scroll sideways to see every column.</p>
      <div className="data-table-wrap responsive-table--board">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Tier</th>
              <th scope="col">Player</th>
              <th scope="col">Pos</th>
              <th scope="col" className="numeric">
                Proj
              </th>
              <th scope="col" className="numeric">
                IV
              </th>
              {/* Beside the league's own valuation rather than instead of it. Where the two
                  disagree is the part of a board worth reading before a pick. */}
              <th scope="col" className="numeric">
                ADP
              </th>
              <th scope="col" className="numeric">
                At your pick
              </th>
            </tr>
          </thead>
          <tbody>
            {board.board.rows.map((row) => (
              <tr key={row.playerId}>
                <td className="numeric">{row.rank}</td>
                <td className="numeric">{row.tier}</td>
                <td>{row.fullName}</td>
                <td>{row.position}</td>
                <td className="numeric">{formatNumber(row.projectedPoints)}</td>
                <td className="numeric">{formatNumber(row.intrinsicValue)}</td>
                {/* An em dash where the source ranked nobody -- a defence has no ADP, and a
                    zero there would read as the first pick of the draft. */}
                <td className="numeric">
                  {row.averageDraftPosition === null
                    ? '—'
                    : formatNumber(row.averageDraftPosition)}
                </td>
                <td className="numeric">
                  {row.valueAtUserNextPick === null ? '—' : formatNumber(row.valueAtUserNextPick)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
}

function noop(): void {}

export function KeeperCombinationsPanel({ outlook }: { outlook: FranchiseOutlook }) {
  // Every rostered player is a candidate, so the full list runs to hundreds of sets. The
  // best few are what a reader can act on; the count says what they were chosen from.
  const optimization = outlook.assumingDeclarations;
  const floorByIds = new Map(
    outlook.floor.combinations.map((combination) => [
      combination.selectedKeeperRightIds.join('|'),
      combination,
    ]),
  );
  const ranked = [...optimization.combinations]
    .sort((left, right) => right.totalScore - left.totalScore)
    .slice(0, 15);
  const modes = buildKeeperModes(optimization);

  return (
    <section className="panel">
      <h2>Keeper combinations</h2>
      <p className="muted">
        {optimization.combinations.length} legal set(s) across this roster. Scores are shown
        assuming declarations hold, with the floor beside them.
      </p>
      <h3>Best by mode</h3>
      {/* Each mode maximises a different quantity, so the scores are not on one scale and
          the column that names the quantity is doing real work. The components sit beside
          the score for the same reason. */}
      <p className="table-scroll-hint muted">Scroll sideways to see every column.</p>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Mode</th>
              <th scope="col">Maximises</th>
              <th scope="col" className="numeric">
                Score
              </th>
              <th scope="col" className="numeric">
                IV
              </th>
              <th scope="col" className="numeric">
                Pick cost
              </th>
              <th scope="col" className="numeric">
                KSV
              </th>
              <th scope="col" className="numeric">
                Keepers
              </th>
            </tr>
          </thead>
          <tbody>
            {modes.rows.map((row) => (
              <tr key={row.mode}>
                <td>{row.mode}</td>
                <td className="muted-cell">{row.optimises}</td>
                <td className="numeric">{formatNumber(row.score)}</td>
                <td className="numeric">{formatNumber(row.retainedIntrinsicValue)}</td>
                <td className="numeric">{formatNumber(row.consumedPickValue)}</td>
                <td className="numeric">{formatNumber(row.keeperSurplusValue)}</td>
                <td className="numeric">
                  {row.keepers}
                  {row.agreesWith.length > 0 ? (
                    <span className="muted-cell"> · same set as {row.agreesWith.join(', ')}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modes.notes.map((note) => (
        <p key={note} className="warning">
          {note}
        </p>
      ))}

      <h3>Best fifteen sets</h3>
      <p className="table-scroll-hint muted">Scroll sideways to see every column.</p>
      <div className="data-table-wrap responsive-table--keeper-combinations">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="numeric">
                Score
              </th>
              <th scope="col">Keepers</th>
              <th scope="col" className="numeric">
                Retained IV
              </th>
              <th scope="col" className="numeric">
                Pick cost
              </th>
              <th scope="col" className="numeric">
                KSV
              </th>
              <th scope="col" className="numeric">
                Floor KSV
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((combination) => {
              const key = combination.selectedKeeperRightIds.join('|');
              const floor = floorByIds.get(key);
              return (
                <tr key={key || 'none'}>
                  <td className="numeric">{formatNumber(combination.totalScore)}</td>
                  <td>{describeKeepers(combination)}</td>
                  <td className="numeric">{formatNumber(combination.retainedIntrinsicValue)}</td>
                  <td className="numeric">{formatNumber(combination.consumedPickValue)}</td>
                  <td className="numeric">{formatNumber(combination.keeperSurplusValue)}</td>
                  <td className="numeric">{floor ? formatNumber(floor.keeperSurplusValue) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The recommendation, read both ways.
 *
 * A keeper is worth what it beats, and what a pick would otherwise have bought depends on
 * whether the rest of the league's declarations hold. When both readings pick the same set,
 * that set is not relying on anyone else's choices; when they disagree, the difference is
 * the thing worth thinking about, so it is stated rather than averaged away.
 */
export function RecommendationPanel({ outlook }: { outlook: FranchiseOutlook }) {
  const floor = outlook.floor.bestByMode.expected;
  const assuming = outlook.assumingDeclarations.bestByMode.expected;

  if (!floor && !assuming) {
    return (
      <section className="panel">
        <h2>Recommendation</h2>
        <p>No legal keeper set was found.</p>
      </section>
    );
  }

  const agree =
    floor !== null &&
    assuming !== null &&
    describeKeepers(floor) === describeKeepers(assuming as typeof floor);

  return (
    <section className="panel">
      <h2>Recommendation</h2>
      {agree && floor ? (
        <>
          <p>{describeKeepers(floor)}</p>
          <p className="muted">
            The same set wins whether or not the rest of the league&apos;s declarations hold, so it
            does not depend on anyone else&apos;s choices.
          </p>
          <pre>{floor.explanation}</pre>
        </>
      ) : (
        <>
          <dl>
            <dt>If declarations hold</dt>
            <dd>{assuming ? describeKeepers(assuming) : 'No legal set'}</dd>
            <dt>If they do not</dt>
            <dd>{floor ? describeKeepers(floor) : 'No legal set'}</dd>
          </dl>
          <p className="warning">
            These disagree, so the better set depends on twelve other managers not changing their
            minds before the deadline.
          </p>
          {floor ? <pre>{floor.explanation}</pre> : null}
        </>
      )}
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
