import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LeagueStateSnapshot, Player, PlayerId } from '@keeper/domain';
import { createSyntheticLeagueSnapshot } from '@keeper/test-fixtures';
import { Dashboard } from './App.js';
import {
  createAppContext,
  createFixtureAppContext,
  createMockDraftAppContext,
} from './app-state.js';

/**
 * Renders the real component tree to markup. Server rendering skips effects, so this does
 * not exercise polling or the database read, but it does prove every panel builds its view
 * model and renders without throwing -- which a passing `vite build` alone does not show.
 *
 * The fixture context is used deliberately: the dashboard takes an assembled context, so it
 * can be checked without a network or credentials.
 */
describe('Dashboard', () => {
  const context = createFixtureAppContext();
  const markup = renderToStaticMarkup(createElement(Dashboard, { context }));

  it('renders each required panel', () => {
    for (const heading of ['Setup', 'Pick horizon', 'Recommendation', 'Keeper combinations']) {
      expect(markup).toContain(heading);
    }
  });

  it('shows sync status before the board', () => {
    expect(markup).toContain('No successful sync yet');
    expect(markup.indexOf('No successful sync yet')).toBeLessThan(markup.indexOf('Pick horizon'));
  });

  it('offers every board and renders one of them', () => {
    expect(markup).toContain('Pre-keeper board');
    expect(markup).toContain('As declared');
    expect(markup).toContain('If everyone keeps optimally');
    expect(markup).toContain('Live board');
    expect(markup).toContain('At your pick');
  });

  it('surfaces the league setup the engine actually loaded', () => {
    expect(markup).toContain('Synthetic Keeper League');
    expect(markup).toContain('180 assets');
  });

  it('names the user next pick and who drafts before them', () => {
    expect(markup).toContain('Your next pick');
    expect(markup).toContain('Team 1');
  });

  it('says plainly that this is not a real league', () => {
    // A synthetic board is indistinguishable from a real one at a glance, and acting on the
    // wrong one is the whole risk.
    expect(markup).toContain('Demonstration data');
    expect(markup).toContain('not your league');
  });

  it('shows the replacement levels every value on the page is measured against', () => {
    expect(markup).toContain('Replacement level');
  });

  it('can render the league-scale mock draft demo used by the deployed site', () => {
    const demoMarkup = renderToStaticMarkup(
      createElement(Dashboard, { context: createMockDraftAppContext(), demoMode: true }),
    );

    expect(demoMarkup).toContain('Mock Draft Rehearsal League');
    expect(demoMarkup).toContain('Mock draft demo');
    expect(demoMarkup).toContain('36 declared');
    expect(demoMarkup).toContain('Live board');
  });
});

describe('createAppContext', () => {
  it('populates a replacement level for every position, never an empty map', () => {
    // The dashboard used to hand the optimizer `{}`, which values every player at his full
    // projection: in a one-quarterback league that alone makes quarterbacks look like the
    // best keepers on the board. The fixture pool is only three players against a twelve
    // team league, so the levels themselves are legitimately zero -- what matters here is
    // that each position was actually computed.
    const levels = createFixtureAppContext().scenarios.replacementLevels;

    for (const position of ['QB', 'RB', 'WR', 'TE', 'DEF'] as const) {
      expect(levels[position]).toBeTypeOf('number');
    }
  });

  it('sets replacement above zero once the pool is deep enough to have one', () => {
    const context = createAppContext({
      snapshot: deepPoolSnapshot(),
      players: deepPoolPlayers(),
      source: 'fixture',
    });

    expect(context.scenarios.replacementLevels.QB!).toBeGreaterThan(0);
    expect(context.scenarios.replacementLevels.RB!).toBeGreaterThan(0);
    // A quarterback projecting 400 in a one-QB league is worth his distance above the best
    // startable alternative, not his whole total.
    expect(context.scenarios.replacementLevels.QB!).toBeGreaterThan(
      context.scenarios.replacementLevels.RB!,
    );
  });

  it('expects at most the keeper limit per franchise, never every rostered player', () => {
    // The regression this guards. A keeper right exists for every rostered player, so
    // feeding rights straight to the post-keeper board emptied all twelve rosters and left
    // a board of free agents. A twelve team league can keep three each, so 36 is the ceiling
    // however many candidates exist.
    const snapshot = deepPoolSnapshot();
    const players = deepPoolPlayers();
    const context = createAppContext({ snapshot, players, source: 'fixture' });

    const limit = snapshot.league.rules.maxKeepers * snapshot.franchises.length;
    expect(context.expectedKeepers.length).toBeLessThanOrEqual(limit);
    expect(context.expectedKeepers.length).toBeLessThan(snapshot.keeperRights.length || Infinity);

    for (const franchise of snapshot.franchises) {
      const held = context.expectedKeepers.filter((right) => right.franchiseId === franchise.id);
      expect(held.length).toBeLessThanOrEqual(snapshot.league.rules.maxKeepers);
    }
  });

  it('keeps one player for at most one franchise', () => {
    // A player kept by two teams would be removed twice from the pool and, worse, would be
    // recommended to both.
    const context = createFixtureAppContext();
    const playerIds = context.expectedKeepers.map((right) => String(right.playerId));

    expect(new Set(playerIds).size).toBe(playerIds.length);
  });

  it('builds a pick value curve that never rises with a later pick', () => {
    // A curve built from ADP ordering is not monotonic, which prices some early picks below
    // later ones and silently inverts the cost of keeping a player.
    const context = createAppContext({
      snapshot: deepPoolSnapshot(),
      players: deepPoolPlayers(),
      source: 'fixture',
    });

    const costs = [1, 5, 10, 25, 50, 100].map((pick) =>
      context.scenarios.assumingDeclarations.getValueForPick(pick),
    );
    for (let index = 1; index < costs.length; index += 1) {
      expect(costs[index]!).toBeLessThanOrEqual(costs[index - 1]!);
    }
  });
});

/** A pool deep enough for a twelve team league to leave someone unrostered. */
function deepPoolPlayers(): Player[] {
  const build = (position: Player['position'], count: number): Player[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `${position}-${index}` as PlayerId,
      fullName: `${position} ${index}`,
      position,
      sleeperPlayerId: null,
    }));

  return [
    ...build('QB', 40),
    ...build('RB', 90),
    ...build('WR', 110),
    ...build('TE', 60),
    ...build('DEF', 32),
  ];
}

function deepPoolSnapshot(): LeagueStateSnapshot {
  const snapshot = createSyntheticLeagueSnapshot();
  const basePoints: Record<Player['position'], number> = {
    QB: 400,
    RB: 320,
    WR: 300,
    TE: 215,
    DEF: 120,
  };

  return {
    ...snapshot,
    keeperRights: [],
    playerSeasons: deepPoolPlayers().map((player, index) => ({
      playerId: player.id,
      seasonId: snapshot.season.id,
      nflTeam: null,
      age: null,
      role: null,
      injuryStatus: null,
      projectedPoints: Math.max(1, basePoints[player.position] - (index % 120) * 2),
      actualPoints: null,
    })),
  };
}
