import { describe, expect, it } from 'vitest';
import { createMockDraftAppContext } from './app-state.js';
import {
  createRehearsal,
  readRehearsal,
  submitPick,
  undoPick,
  type Rehearsal,
} from './rehearsal.js';

function start(): Rehearsal {
  const rehearsal = createRehearsal({ context: createMockDraftAppContext() });
  if ('error' in rehearsal) {
    throw new Error(`fixture league is not rehearsable: ${rehearsal.error}`);
  }
  return rehearsal;
}

describe('createRehearsal', () => {
  it('opens with the user on the clock and a board to choose from', () => {
    const view = readRehearsal(start());

    expect(view.status).toBe('awaiting_user');
    expect(view.onTheClock).not.toBeNull();
    expect(view.recommendations.length).toBeGreaterThan(0);
    expect(view.available.length).toBeGreaterThan(0);
    expect(view.canUndo).toBe(false);
  });

  it('reports why rather than throwing when the league cannot be rehearsed', () => {
    const context = createMockDraftAppContext();
    const result = createRehearsal({
      // A league whose picks have no draft slots has no order to rehearse against.
      context: {
        ...context,
        snapshot: {
          ...context.snapshot,
          pickInventory: context.snapshot.pickInventory.map((pick) => ({
            ...pick,
            overallPick: null,
            slot: null,
          })),
        },
      },
    });

    expect('error' in result).toBe(true);
  });
});

describe('submitPick', () => {
  it('takes the player off the board and moves the clock on', async () => {
    const rehearsal = start();
    const before = readRehearsal(rehearsal);
    const target = before.recommendations[0]!.player;

    await submitPick(rehearsal, target.playerId);
    const after = readRehearsal(rehearsal);

    expect(after.selections.some((s) => s.playerId === target.playerId && s.byUser)).toBe(true);
    expect(after.available.some((p) => p.playerId === target.playerId)).toBe(false);
    expect(after.onTheClock?.overallPick).toBeGreaterThan(before.onTheClock!.overallPick);
  });

  it('changes what the room does afterwards', async () => {
    // The gate for the whole rehearsal: everything after a pick is drawn because of it.
    // The old demo advanced on a timer and this test would have failed against it.
    //
    // Two things have to be right for this to mean anything. The pick has to come off the
    // top of the board, since a need-weighted recommendation can sit outside the window the
    // bots consider at all. And the comparison has to look only at picks made *after* it:
    // this franchise owns two consecutive picks, so its first two selections have no bot
    // picks between them and everything before them is identical by construction.
    const runTaking = async (index: number): Promise<string[]> => {
      const rehearsal = start();
      const opening = readRehearsal(rehearsal);
      const from = opening.onTheClock!.overallPick;

      await submitPick(rehearsal, opening.available[index]!.playerId);
      // Far enough on that the room has had to respond.
      for (let picks = 0; picks < 4; picks += 1) {
        const view = readRehearsal(rehearsal);
        if (view.status !== 'awaiting_user') {
          break;
        }
        await submitPick(rehearsal, view.recommendations[0]!.player.playerId);
      }

      return readRehearsal(rehearsal)
        .selections.filter((selection) => !selection.byUser && selection.overallPick > from)
        .map((selection) => String(selection.playerId));
    };

    // Top of the board against a deliberate reach twenty deep. Taking the top two in either
    // order would not do: this franchise picks back to back, so both runs would have removed
    // the same pair by pick 26 and the room would be in an identical state either way.
    const [tookBest, reached] = await Promise.all([runTaking(0), runTaking(20)]);
    expect(tookBest.length).toBeGreaterThan(0);
    expect(tookBest).not.toEqual(reached);
  });

  it('feeds the tracker the whole board, so it reconciles as a real draft would', async () => {
    const rehearsal = start();
    await submitPick(rehearsal, readRehearsal(rehearsal).recommendations[0]!.player.playerId);

    const tracked = rehearsal.tracker.getState().selections;
    expect(tracked.length).toBe(readRehearsal(rehearsal).selections.length);
    // Reconciled through the normal path rather than injected as a manual entry.
    expect(tracked.every((selection) => selection.source === 'api')).toBe(true);
  });

  it('refuses a player who is already gone', async () => {
    const rehearsal = start();
    const target = readRehearsal(rehearsal).recommendations[0]!.player;
    await submitPick(rehearsal, target.playerId);

    await expect(submitPick(rehearsal, target.playerId)).rejects.toThrow();
  });
});

describe('undoPick', () => {
  it('puts the player back and returns the clock', async () => {
    const rehearsal = start();
    const target = readRehearsal(rehearsal).recommendations[0]!.player;
    const openingPick = readRehearsal(rehearsal).onTheClock!.overallPick;

    await submitPick(rehearsal, target.playerId);
    await undoPick(rehearsal);
    const view = readRehearsal(rehearsal);

    expect(view.onTheClock?.overallPick).toBe(openingPick);
    expect(view.available.some((p) => p.playerId === target.playerId)).toBe(true);
    expect(view.canUndo).toBe(false);
  });

  it('lets a different pick be made after undoing', async () => {
    const rehearsal = start();
    const first = readRehearsal(rehearsal).recommendations[0]!.player;
    const second = readRehearsal(rehearsal).recommendations[1]!.player;

    await submitPick(rehearsal, first.playerId);
    await undoPick(rehearsal);
    await submitPick(rehearsal, second.playerId);

    const view = readRehearsal(rehearsal);
    expect(view.selections.some((s) => s.byUser && s.playerId === second.playerId)).toBe(true);
    expect(view.selections.some((s) => s.byUser && s.playerId === first.playerId)).toBe(false);
  });
});
