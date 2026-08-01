import { describe, expect, it } from 'vitest';
import {
  injectManualSelection,
  reconcileSelections,
  type DraftSelectionInput,
} from './reconcile.js';

const draftId = 'draft-1';
const recordedAt = '2026-08-30T18:00:00.000Z';
const laterRecordedAt = '2026-08-30T18:00:03.000Z';

describe('reconcileSelections', () => {
  it('adds picks that were not previously known', () => {
    const result = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 1 }), pick({ overallPick: 2, playerId: 'player-2' })],
      recordedAt,
    });

    expect(result.changed).toBe(true);
    expect(result.selections.map((selection) => selection.overallPick)).toEqual([1, 2]);
    expect(result.events.map((event) => event.type)).toEqual(['pick_added', 'pick_added']);
  });

  it('is idempotent when the same payload arrives again', () => {
    const first = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 1 })],
      recordedAt,
    });
    const second = reconcileSelections({
      draftId,
      previous: first.selections,
      incoming: [pick({ overallPick: 1 })],
      recordedAt: laterRecordedAt,
    });

    expect(second.changed).toBe(false);
    expect(second.events).toEqual([]);
    expect(second.selections).toEqual(first.selections);
  });

  it('does not depend on the order picks arrive in', () => {
    const ascending = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 1 }), pick({ overallPick: 2, playerId: 'player-2' })],
      recordedAt,
    });
    const descending = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 2, playerId: 'player-2' }), pick({ overallPick: 1 })],
      recordedAt,
    });

    expect(descending.selections).toEqual(ascending.selections);
  });

  it('corrects a pick in place when the player changes', () => {
    const previous = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 1, playerId: 'wrong-player' })],
      recordedAt,
    });
    const corrected = reconcileSelections({
      draftId,
      previous: previous.selections,
      incoming: [pick({ overallPick: 1, playerId: 'right-player' })],
      recordedAt: laterRecordedAt,
    });

    expect(corrected.selections).toHaveLength(1);
    expect(corrected.selections[0]).toMatchObject({ playerId: 'right-player' });
    expect(corrected.events[0]).toMatchObject({
      type: 'pick_corrected',
      changedFields: ['playerId'],
    });
  });

  it('detects a changed roster on an already-known pick', () => {
    const previous = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 1, rosterId: 1 })],
      recordedAt,
    });
    const corrected = reconcileSelections({
      draftId,
      previous: previous.selections,
      incoming: [pick({ overallPick: 1, rosterId: 4 })],
      recordedAt: laterRecordedAt,
    });

    expect(corrected.events[0]).toMatchObject({
      type: 'pick_corrected',
      changedFields: ['rosterId'],
    });
  });

  it('removes a pick that disappears from a non-empty payload', () => {
    const previous = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 1 }), pick({ overallPick: 2, playerId: 'player-2' })],
      recordedAt,
    });
    const removed = reconcileSelections({
      draftId,
      previous: previous.selections,
      incoming: [pick({ overallPick: 1 })],
      recordedAt: laterRecordedAt,
    });

    expect(removed.selections.map((selection) => selection.overallPick)).toEqual([1]);
    expect(removed.events[0]).toMatchObject({ type: 'pick_removed' });
  });

  it('retains the board when a payload comes back empty', () => {
    const previous = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 1 }), pick({ overallPick: 2, playerId: 'player-2' })],
      recordedAt,
    });
    const empty = reconcileSelections({
      draftId,
      previous: previous.selections,
      incoming: [],
      recordedAt: laterRecordedAt,
    });

    expect(empty.selections).toHaveLength(2);
    expect(empty.changed).toBe(false);
    expect(empty.events).toEqual([{ type: 'empty_response_ignored', retainedSelectionCount: 2 }]);
  });

  it('collapses duplicate rows for one overall pick', () => {
    const result = reconcileSelections({
      draftId,
      previous: [],
      incoming: [
        pick({ overallPick: 1, playerId: 'first-row' }),
        pick({ overallPick: 1, playerId: 'second-row' }),
      ],
      recordedAt,
    });

    expect(result.selections).toHaveLength(1);
    expect(result.selections[0]).toMatchObject({ playerId: 'second-row' });
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'duplicate_ignored', overallPick: 1 }),
    );
  });

  it('does not mutate the state it was given', () => {
    const previous = reconcileSelections({
      draftId,
      previous: [],
      incoming: [pick({ overallPick: 1 })],
      recordedAt,
    });
    const snapshot = structuredClone(previous.selections);

    reconcileSelections({
      draftId,
      previous: previous.selections,
      incoming: [pick({ overallPick: 1, playerId: 'changed' }), pick({ overallPick: 2 })],
      recordedAt: laterRecordedAt,
    });

    expect(previous.selections).toEqual(snapshot);
  });
});

describe('manual selections', () => {
  it('records a manual pick and marks its source', () => {
    const result = injectManualSelection({
      draftId,
      previous: [],
      selection: pick({ overallPick: 3, playerId: 'typed-by-hand' }),
      recordedAt,
    });

    expect(result.selections[0]).toMatchObject({ source: 'manual', playerId: 'typed-by-hand' });
  });

  it('confirms a manual pick the API later agrees with, without duplicating it', () => {
    const manual = injectManualSelection({
      draftId,
      previous: [],
      selection: pick({ overallPick: 3, playerId: 'typed-by-hand' }),
      recordedAt,
    });
    const synced = reconcileSelections({
      draftId,
      previous: manual.selections,
      incoming: [pick({ overallPick: 3, playerId: 'typed-by-hand' })],
      recordedAt: laterRecordedAt,
    });

    expect(synced.selections).toHaveLength(1);
    expect(synced.selections[0]).toMatchObject({ source: 'api' });
    expect(synced.events[0]).toMatchObject({ type: 'manual_pick_confirmed' });
  });

  it('supersedes a manual pick the API disagrees with, in place', () => {
    const manual = injectManualSelection({
      draftId,
      previous: [],
      selection: pick({ overallPick: 3, playerId: 'guessed-wrong' }),
      recordedAt,
    });
    const synced = reconcileSelections({
      draftId,
      previous: manual.selections,
      incoming: [pick({ overallPick: 3, playerId: 'actually-drafted' })],
      recordedAt: laterRecordedAt,
    });

    expect(synced.selections).toHaveLength(1);
    expect(synced.selections[0]).toMatchObject({
      source: 'api',
      playerId: 'actually-drafted',
    });
    expect(synced.events[0]).toMatchObject({
      type: 'manual_pick_superseded',
      changedFields: ['playerId'],
    });
  });

  it('keeps a manual pick the API has not reported yet', () => {
    const manual = injectManualSelection({
      draftId,
      previous: [],
      selection: pick({ overallPick: 5, playerId: 'offline-entry' }),
      recordedAt,
    });
    const synced = reconcileSelections({
      draftId,
      previous: manual.selections,
      incoming: [pick({ overallPick: 1 })],
      recordedAt: laterRecordedAt,
    });

    expect(synced.selections.map((selection) => selection.overallPick)).toEqual([1, 5]);
    expect(synced.events.some((event) => event.type === 'pick_removed')).toBe(false);
  });
});

function pick(overrides: Partial<DraftSelectionInput> = {}): DraftSelectionInput {
  return {
    overallPick: 1,
    round: 1,
    slot: 1,
    rosterId: 1,
    playerId: 'player-1',
    isKeeper: false,
    ...overrides,
  };
}
