import { useState } from 'react';
import type { FranchiseId, PlayerId } from '@keeper/domain';
import type { RehearsalView } from '../rehearsal.js';
import { PanelShell } from './panel-shell.js';

type Recommendation = RehearsalView['recommendations'][number];
type Selection = RehearsalView['selections'][number];

/**
 * The pick, when it is yours.
 *
 * The panel a rehearsal exists for. The old demo advanced on a timer whatever the person
 * watching did, so nothing they chose changed anything -- this is the part that makes the
 * room respond. Every pick below it in the draft is drawn after this one and because of it.
 */
export function OnTheClockPanel({
  view,
  franchiseName,
  franchiseNames = new Map(),
  busy,
  onPick,
  onUndo,
  expanded = false,
  onExpand,
  onClose,
}: {
  view: RehearsalView;
  franchiseName: string;
  /** Every franchise's display name, so the draft log can say who took whom. */
  franchiseNames?: ReadonlyMap<FranchiseId, string>;
  busy: boolean;
  onPick: (playerId: PlayerId) => void;
  onUndo: () => void;
  expanded?: boolean;
  onExpand?: () => void;
  onClose?: () => void;
}) {
  const [search, setSearch] = useState('');

  if (view.status === 'complete') {
    const mine = view.selections.filter((selection) => selection.byUser);
    return (
      <PanelShell
        title="Draft complete"
        toneClassName="tone-ok"
        expanded={expanded}
        onExpand={onExpand ?? noop}
        onClose={onClose ?? noop}
      >
        <p className="muted">
          {franchiseName} finished with {mine.length} player(s) across {view.selections.length}{' '}
          selections.
        </p>
        <RosterSummary view={view} />
        <DraftLog view={view} franchiseNames={franchiseNames} />
        {view.canUndo && (
          <button type="button" onClick={onUndo} disabled={busy}>
            Undo last pick
          </button>
        )}
      </PanelShell>
    );
  }

  const slot = view.onTheClock;
  const query = search.trim().toLowerCase();
  const searchResults =
    query.length < 2
      ? []
      : view.available
          .filter((player) => player.fullName.toLowerCase().includes(query))
          .slice(0, 8);

  return (
    <PanelShell
      title={
        <>
          You are on the clock · round {slot?.round}, pick {slot?.overallPick}
        </>
      }
      toneClassName="tone-ok"
      expanded={expanded}
      onExpand={onExpand ?? noop}
      onClose={onClose ?? noop}
    >
      <p className="muted">
        {franchiseName} · {view.userPicksRemaining} pick(s) left including this one ·{' '}
        {view.available.length} players available
      </p>

      <h3>Best fits</h3>
      {/* Two markups of the same recommendations, never both visible at once: the table for
          wider screens, cards below the 40rem breakpoint where a seven-column table cannot
          fit the Draft button on screen. The CSS that hides one of them uses display: none,
          which also drops it from the accessibility tree, so a screen reader on a phone only
          ever finds the card list and one at a time on desktop only finds the table. */}
      <div className="responsive-table--recommendations">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Pos</th>
              <th scope="col" className="numeric">
                Proj
              </th>
              <th scope="col" className="numeric">
                Value
              </th>
              <th scope="col" className="numeric">
                ADP
              </th>
              <th scope="col" className="numeric">
                Need
              </th>
              <th scope="col" aria-label="Draft" />
            </tr>
          </thead>
          <tbody>
            {view.recommendations.map((entry) => (
              <tr key={String(entry.player.playerId)}>
                <td>{entry.player.fullName}</td>
                <td>{entry.player.position}</td>
                <td className="numeric">{entry.player.projectedPoints.toFixed(1)}</td>
                <td className="numeric">{entry.player.intrinsicValue.toFixed(1)}</td>
                {/* Where the room takes him, against where this league values him. A pick
                    far below its ADP is a reach; far above it is a player falling. */}
                <td className="numeric">
                  {entry.player.averageDraftPosition === null
                    ? '—'
                    : entry.player.averageDraftPosition.toFixed(1)}
                </td>
                {/* Shown because a recommendation that departs from the board should say why. */}
                <td className="numeric">{entry.needWeight.toFixed(2)}</td>
                <td>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Draft ${entry.player.fullName}`}
                    onClick={() => onPick(entry.player.playerId)}
                  >
                    Draft
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="recommendation-cards">
        {view.recommendations.map((entry) => (
          <RecommendationCard
            key={String(entry.player.playerId)}
            entry={entry}
            busy={busy}
            onPick={onPick}
          />
        ))}
      </ul>

      {/* The whole pool stays reachable. A rehearsal that only lets you take what it already
          recommends cannot teach you anything about deviating from it. */}
      <h3>Draft someone else</h3>
      <label className="player-search">
        Search{' '}
        <input
          type="search"
          value={search}
          placeholder="Player name"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {query.length >= 2 && searchResults.length === 0 && (
        <p className="muted">Nobody available matches “{search.trim()}”.</p>
      )}
      <ul className="search-results">
        {searchResults.map((player) => (
          <li key={String(player.playerId)}>
            <button type="button" disabled={busy} onClick={() => onPick(player.playerId)}>
              Draft {player.fullName} ({player.position}
              {player.averageDraftPosition === null
                ? ''
                : `, ADP ${player.averageDraftPosition.toFixed(1)}`}
              )
            </button>
          </li>
        ))}
      </ul>

      <RosterSummary view={view} />
      <DraftLog view={view} franchiseNames={franchiseNames} />

      {view.canUndo && (
        <button type="button" onClick={onUndo} disabled={busy}>
          Undo last pick
        </button>
      )}
    </PanelShell>
  );
}

function noop(): void {}

/**
 * One recommendation, as a card rather than a table row.
 *
 * Reads the same entry the desktop row reads and calls the same onPick -- there is no
 * separate mobile state, only a narrower rendering of it. The visible button label stays
 * "Draft" to match the table, but the accessible name carries the player so a screen reader
 * moving through several cards does not hear "Draft" seven times with nothing to tell them
 * apart.
 */
function RecommendationCard({
  entry,
  busy,
  onPick,
}: {
  entry: Recommendation;
  busy: boolean;
  onPick: (playerId: PlayerId) => void;
}) {
  const { player, needWeight } = entry;
  return (
    <li className="recommendation-card">
      <div className="recommendation-card-head">
        <span className="recommendation-card-name">{player.fullName}</span>
        <span className="recommendation-card-pos">{player.position}</span>
      </div>
      <dl className="recommendation-card-stats">
        <div>
          <dt>Proj</dt>
          <dd>{player.projectedPoints.toFixed(1)}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{player.intrinsicValue.toFixed(1)}</dd>
        </div>
        <div>
          <dt>ADP</dt>
          <dd>{player.averageDraftPosition === null ? '—' : player.averageDraftPosition.toFixed(1)}</dd>
        </div>
        <div>
          <dt>Need</dt>
          <dd>{needWeight.toFixed(2)}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="recommendation-card-draft"
        disabled={busy}
        aria-label={`Draft ${player.fullName}`}
        onClick={() => onPick(player.playerId)}
      >
        Draft
      </button>
    </li>
  );
}

/**
 * What has been assembled so far.
 *
 * Keepers are marked rather than blended in, because a keeper was decided months ago and a
 * draft pick was decided just now, and a roster that hides the difference invites the wrong
 * lesson about which decisions built it.
 */
function RosterSummary({ view }: { view: RehearsalView }) {
  const mine = view.selections.filter((selection) => selection.byUser);
  if (mine.length === 0) {
    return null;
  }

  const byPosition = new Map<string, number>();
  for (const selection of mine) {
    byPosition.set(selection.position, (byPosition.get(selection.position) ?? 0) + 1);
  }

  return (
    <>
      <h3>Your roster</h3>
      <p className="muted">
        {[...byPosition.entries()]
          .sort()
          .map(([position, count]) => `${position} ${count}`)
          .join(' · ')}
      </p>
      <ol className="roster-list">
        {mine.map((selection) => (
          <li key={selection.overallPick}>
            <span className="pick-label">
              R{selection.round} · {selection.overallPick}
            </span>{' '}
            {selection.fullName} ({selection.position})
            {selection.isKeeper && <span className="muted"> keeper</span>}
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Every pick so far, with the algorithm's own accounting for why it liked that player.
 *
 * Collapsed by default and ordered most-recent-first: this is a record to check, not
 * something that needs to be read on every render. What it shows is exactly what
 * `candidatesFor` computed at the moment of the pick, not a re-justification after the fact
 * -- a bot that reached is shown reaching, not quietly rationalised into looking like the top
 * choice all along.
 */
function DraftLog({
  view,
  franchiseNames,
}: {
  view: RehearsalView;
  franchiseNames: ReadonlyMap<FranchiseId, string>;
}) {
  if (view.selections.length === 0) {
    return null;
  }

  const byRecency = [...view.selections].sort((a, b) => b.overallPick - a.overallPick);

  return (
    <details className="draft-log">
      <summary>Draft log · why the algorithm took each player</summary>
      <ol className="draft-log-list">
        {byRecency.map((selection) => (
          <li key={selection.overallPick} className="draft-log-entry">
            <div className="draft-log-head">
              <span className="pick-label">
                R{selection.round} · {selection.overallPick}
              </span>
              <span className="draft-log-team">
                {franchiseNames.get(selection.franchiseId) ?? String(selection.franchiseId)}
              </span>
              <span>
                {selection.fullName} ({selection.position})
              </span>
            </div>
            <p className="muted draft-log-reason">{describePickReason(selection)}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Plain-language account of {@link Selection.pickReason}, the number behind a pick. */
function describePickReason(selection: Selection): string {
  if (selection.isKeeper) {
    return 'Kept before the draft — never scored by the algorithm.';
  }

  const reason = selection.pickReason;
  if (reason === null) {
    return 'Not among the algorithm’s ranked candidates for this pick.';
  }

  const breakdown =
    `value × need ${reason.needWeight.toFixed(2)} × market ${reason.marketWeight.toFixed(2)}` +
    ` = ${reason.score.toFixed(1)}`;

  return reason.rank === 1
    ? `Algorithm’s top-ranked candidate (${breakdown}).`
    : `Ranked #${reason.rank} of ${reason.candidatesConsidered} candidates (${breakdown}).`;
}
