import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftTracker, type DraftTrackerOptions } from './tracker.js';
import type { DraftSelectionInput, DraftTrackerEvent } from './reconcile.js';

const draftId = 'draft-1';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-30T18:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createDraftTracker polling', () => {
  it('syncs immediately on start and then on the configured interval', async () => {
    const fetchSelections = vi.fn(async () => [pick({ overallPick: 1 })]);
    const tracker = createTracker({ fetchSelections });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSelections).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchSelections).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchSelections).toHaveBeenCalledTimes(3);

    tracker.stop();
  });

  it('emits pick events only when the board actually changes', async () => {
    let payload: DraftSelectionInput[] = [pick({ overallPick: 1 })];
    const events: DraftTrackerEvent[][] = [];
    const tracker = createTracker({ fetchSelections: async () => payload });
    tracker.subscribe((emitted) => events.push([...emitted]));

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([[expect.objectContaining({ type: 'pick_added' })]]);

    // Unchanged payload on the next tick.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(events[1]).toEqual([]);

    payload = [pick({ overallPick: 1 }), pick({ overallPick: 2, playerId: 'player-2' })];
    await vi.advanceTimersByTimeAsync(3_000);
    expect(events[2]).toEqual([expect.objectContaining({ type: 'pick_added' })]);

    tracker.stop();
  });

  it('records a successful sync timestamp and clears staleness', async () => {
    const tracker = createTracker({ fetchSelections: async () => [pick({ overallPick: 1 })] });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(tracker.getState()).toMatchObject({
      status: 'running',
      lastSuccessfulSyncAt: '2026-08-30T18:00:00.000Z',
      consecutiveFailureCount: 0,
      stale: false,
    });

    tracker.stop();
  });
});

describe('createDraftTracker failure handling', () => {
  it('keeps the last known good board when a sync fails', async () => {
    let shouldFail = false;
    const tracker = createTracker({
      fetchSelections: async () => {
        if (shouldFail) {
          throw new Error('network unavailable');
        }
        return [pick({ overallPick: 1 })];
      },
    });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.getState().selections).toHaveLength(1);

    shouldFail = true;
    await vi.advanceTimersByTimeAsync(3_000);

    const state = tracker.getState();
    expect(state.selections).toHaveLength(1);
    expect(state.consecutiveFailureCount).toBe(1);
    expect(state.lastErrorMessage).toBe('network unavailable');

    tracker.stop();
  });

  it('backs off exponentially while failing and recovers on success', async () => {
    const attemptTimes: number[] = [];
    let shouldFail = true;
    const tracker = createTracker({
      backoffBaseMs: 1_000,
      jitterRatio: 0,
      fetchSelections: async () => {
        attemptTimes.push(Date.now());
        if (shouldFail) {
          throw new Error('still down');
        }
        return [pick({ overallPick: 1 })];
      },
    });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000); // first retry after base delay
    await vi.advanceTimersByTimeAsync(2_000); // then doubled
    await vi.advanceTimersByTimeAsync(4_000); // then doubled again

    expect(attemptTimes).toEqual([
      Date.parse('2026-08-30T18:00:00.000Z'),
      Date.parse('2026-08-30T18:00:01.000Z'),
      Date.parse('2026-08-30T18:00:03.000Z'),
      Date.parse('2026-08-30T18:00:07.000Z'),
    ]);
    expect(tracker.getState().consecutiveFailureCount).toBe(4);

    shouldFail = false;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(tracker.getState().consecutiveFailureCount).toBe(0);

    // Back on the normal cadence rather than the backoff delay.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(attemptTimes).toHaveLength(6);

    tracker.stop();
  });

  it('caps the backoff delay', async () => {
    const attemptTimes: number[] = [];
    const tracker = createTracker({
      backoffBaseMs: 1_000,
      backoffMaxMs: 4_000,
      jitterRatio: 0,
      fetchSelections: async () => {
        attemptTimes.push(Date.now());
        throw new Error('down');
      },
    });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of [1_000, 2_000, 4_000, 4_000, 4_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    const gaps = attemptTimes.slice(1).map((time, index) => time - attemptTimes[index]!);
    expect(gaps).toEqual([1_000, 2_000, 4_000, 4_000, 4_000]);

    tracker.stop();
  });

  it('marks the board stale once the last good sync ages out', async () => {
    let shouldFail = false;
    const tracker = createTracker({
      staleAfterMs: 10_000,
      jitterRatio: 0,
      fetchSelections: async () => {
        if (shouldFail) {
          throw new Error('down');
        }
        return [pick({ overallPick: 1 })];
      },
    });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tracker.getState().stale).toBe(false);

    shouldFail = true;
    await vi.advanceTimersByTimeAsync(11_000);

    expect(tracker.getState()).toMatchObject({ stale: true, selections: [expect.anything()] });

    tracker.stop();
  });

  it('applies jitter within the configured ratio', async () => {
    const attemptTimes: number[] = [];
    const tracker = createTracker({
      jitterRatio: 0.5,
      random: () => 1, // maximum jitter
      fetchSelections: async () => {
        attemptTimes.push(Date.now());
        return [];
      },
    });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_500);

    expect(attemptTimes[1]! - attemptTimes[0]!).toBe(4_500);

    tracker.stop();
  });
});

describe('createDraftTracker control', () => {
  it('stops polling and aborts the in-flight request', async () => {
    let observedSignal: AbortSignal | null = null;
    const fetchSelections = vi.fn(async (signal: AbortSignal) => {
      observedSignal = signal;
      return [pick({ overallPick: 1 })];
    });
    const tracker = createTracker({ fetchSelections });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    tracker.stop();

    expect(tracker.getState().status).toBe('stopped');
    expect(observedSignal).not.toBeNull();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchSelections).toHaveBeenCalledTimes(1);
  });

  it('refreshes on demand for a manual refresh or tab resume', async () => {
    const fetchSelections = vi.fn(async () => [pick({ overallPick: 1 })]);
    const tracker = createTracker({ fetchSelections });

    const state = await tracker.refreshNow();

    expect(fetchSelections).toHaveBeenCalledTimes(1);
    expect(state.selections).toHaveLength(1);
    expect(state.lastSuccessfulSyncAt).toBe('2026-08-30T18:00:00.000Z');
  });

  it('polls more slowly while the tab is hidden', async () => {
    let visible = false;
    const fetchSelections = vi.fn(async () => []);
    const tracker = createTracker({
      jitterRatio: 0,
      hiddenIntervalMs: 30_000,
      isDocumentVisible: () => visible,
      fetchSelections,
    });

    tracker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSelections).toHaveBeenCalledTimes(1);

    // The active cadence would have fired here; the hidden cadence should not.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchSelections).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(27_000);
    expect(fetchSelections).toHaveBeenCalledTimes(2);

    visible = true;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchSelections).toHaveBeenCalledTimes(3);

    tracker.stop();
  });

  it('accepts a manual pick offline and reconciles it on the next sync', async () => {
    let payload: DraftSelectionInput[] = [];
    const tracker = createTracker({ fetchSelections: async () => payload });

    const afterInjection = tracker.injectManualPick(
      pick({ overallPick: 2, playerId: 'offline-entry' }),
    );
    expect(afterInjection.selections[0]).toMatchObject({
      source: 'manual',
      playerId: 'offline-entry',
    });

    payload = [pick({ overallPick: 2, playerId: 'offline-entry' })];
    await tracker.refreshNow();

    const state = tracker.getState();
    expect(state.selections).toHaveLength(1);
    expect(state.selections[0]).toMatchObject({ source: 'api' });
  });

  it('rejects an invalid polling configuration', () => {
    expect(() => createTracker({ intervalMs: 0, fetchSelections: async () => [] })).toThrow(
      /intervalMs/,
    );
    expect(() => createTracker({ jitterRatio: 1, fetchSelections: async () => [] })).toThrow(
      /jitterRatio/,
    );
  });
});

function createTracker(overrides: Partial<DraftTrackerOptions> = {}) {
  return createDraftTracker({
    draftId,
    fetchSelections: async () => [],
    jitterRatio: 0,
    ...overrides,
  });
}

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
