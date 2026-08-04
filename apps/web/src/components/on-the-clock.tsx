import { useState } from 'react';
import type { PlayerId } from '@keeper/domain';
import type { RehearsalView } from '../rehearsal.js';

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
  busy,
  onPick,
  onUndo,
}: {
  view: RehearsalView;
  franchiseName: string;
  busy: boolean;
  onPick: (playerId: PlayerId) => void;
  onUndo: () => void;
}) {
  const [search, setSearch] = useState('');

  if (view.status === 'complete') {
    const mine = view.selections.filter((selection) => selection.byUser);
    return (
      <section className="panel tone-ok">
        <h2>Draft complete</h2>
        <p className="muted">
          {franchiseName} finished with {mine.length} player(s) across {view.selections.length}{' '}
          selections.
        </p>
        <RosterSummary view={view} />
        {view.canUndo && (
          <button type="button" onClick={onUndo} disabled={busy}>
            Undo last pick
          </button>
        )}
      </section>
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
    <section className="panel tone-ok">
      <h2>
        You are on the clock · round {slot?.round}, pick {slot?.overallPick}
      </h2>
      <p className="muted">
        {franchiseName} · {view.userPicksRemaining} pick(s) left including this one ·{' '}
        {view.available.length} players available
      </p>

      <h3>Best fits</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Pos</th>
            <th scope="col">Proj</th>
            <th scope="col">Value</th>
            <th scope="col">ADP</th>
            <th scope="col">Need</th>
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
                <button type="button" disabled={busy} onClick={() => onPick(entry.player.playerId)}>
                  Draft
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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

      {view.canUndo && (
        <button type="button" onClick={onUndo} disabled={busy}>
          Undo last pick
        </button>
      )}
    </section>
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
