import { describe, expect, it } from 'vitest';
import type { DraftTrackerState, TrackedSelection } from '@keeper/draft-tracker';
import { buildSyncStatus } from './sync-status.js';

const now = Date.parse('2026-08-30T18:00:30.000Z');

describe('buildSyncStatus', () => {
  it('reports a healthy live sync', () => {
    const status = buildSyncStatus({
      state: trackerState({ lastSuccessfulSyncAt: '2026-08-30T18:00:27.000Z' }),
      now,
    });

    expect(status).toMatchObject({
      tone: 'ok',
      headline: 'Live',
      secondsSinceLastSync: 3,
      showStaleWarning: false,
    });
  });

  it('warns while retrying but before the board goes stale', () => {
    const status = buildSyncStatus({
      state: trackerState({
        lastSuccessfulSyncAt: '2026-08-30T18:00:27.000Z',
        consecutiveFailureCount: 2,
        lastErrorMessage: 'network unavailable',
      }),
      now,
    });

    expect(status.tone).toBe('warning');
    expect(status.headline).toBe('Retrying after a failed sync');
    expect(status.detail).toContain('2 failed attempts');
    expect(status.detail).toContain('network unavailable');
  });

  it('escalates to an error once a failing sync leaves the board stale', () => {
    const status = buildSyncStatus({
      state: trackerState({
        lastSuccessfulSyncAt: '2026-08-30T17:59:00.000Z',
        consecutiveFailureCount: 5,
        stale: true,
      }),
      now,
    });

    expect(status.tone).toBe('error');
    expect(status.headline).toBe('Showing last known good board');
    expect(status.showStaleWarning).toBe(true);
  });

  it('says so when nothing has ever synced', () => {
    const status = buildSyncStatus({
      state: trackerState({ lastSuccessfulSyncAt: null }),
      now,
    });

    expect(status.secondsSinceLastSync).toBeNull();
    expect(status.detail).toContain('No successful sync yet');
  });

  it('counts picks that were entered by hand', () => {
    const status = buildSyncStatus({
      state: trackerState({
        selections: [selection('api'), selection('manual'), selection('manual')],
      }),
      now,
    });

    expect(status.manualPickCount).toBe(2);
  });

  it('uses singular wording for a single failure', () => {
    const status = buildSyncStatus({
      state: trackerState({ consecutiveFailureCount: 1, lastErrorMessage: null }),
      now,
    });

    expect(status.detail).toContain('1 failed attempt');
    expect(status.detail).not.toContain('attempts');
  });

  it('reports a stopped tracker distinctly from a failing one', () => {
    const status = buildSyncStatus({ state: trackerState({ status: 'stopped' }), now });

    expect(status.headline).toBe('Tracking stopped');
  });
});

function trackerState(overrides: Partial<DraftTrackerState> = {}): DraftTrackerState {
  return {
    draftId: 'draft-1',
    status: 'running',
    selections: [],
    lastSuccessfulSyncAt: '2026-08-30T18:00:27.000Z',
    lastAttemptedSyncAt: '2026-08-30T18:00:30.000Z',
    consecutiveFailureCount: 0,
    lastErrorMessage: null,
    stale: false,
    ...overrides,
  };
}

function selection(source: TrackedSelection['source']): TrackedSelection {
  return {
    draftId: 'draft-1',
    overallPick: 1,
    round: 1,
    slot: 1,
    rosterId: 1,
    playerId: 'player-1',
    isKeeper: false,
    source,
    recordedAt: '2026-08-30T18:00:00.000Z',
  };
}
