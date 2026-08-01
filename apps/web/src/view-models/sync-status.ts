import type { DraftTrackerState } from '@keeper/draft-tracker';

export type SyncTone = 'ok' | 'warning' | 'error';

export interface SyncStatusViewModel {
  tone: SyncTone;
  headline: string;
  detail: string;
  lastSuccessfulSyncAt: string | null;
  secondsSinceLastSync: number | null;
  manualPickCount: number;
  showStaleWarning: boolean;
}

export interface BuildSyncStatusInput {
  state: DraftTrackerState;
  now: number;
}

/**
 * Turns tracker bookkeeping into something a person can act on. The board is always shown
 * even when a sync fails, so the status has to say clearly whether what is on screen is
 * current or the last known good copy.
 */
export function buildSyncStatus(input: BuildSyncStatusInput): SyncStatusViewModel {
  const { state } = input;
  const lastSyncMs =
    state.lastSuccessfulSyncAt === null ? null : Date.parse(state.lastSuccessfulSyncAt);
  const secondsSinceLastSync =
    lastSyncMs === null ? null : Math.max(0, Math.round((input.now - lastSyncMs) / 1000));
  const manualPickCount = state.selections.filter(
    (selection) => selection.source === 'manual',
  ).length;

  return {
    tone: resolveTone(state),
    headline: resolveHeadline(state),
    detail: resolveDetail(state, secondsSinceLastSync),
    lastSuccessfulSyncAt: state.lastSuccessfulSyncAt,
    secondsSinceLastSync,
    manualPickCount,
    showStaleWarning: state.stale,
  };
}

function resolveTone(state: DraftTrackerState): SyncTone {
  if (state.consecutiveFailureCount > 0 && state.stale) {
    return 'error';
  }
  if (state.consecutiveFailureCount > 0 || state.stale) {
    return 'warning';
  }
  return 'ok';
}

function resolveHeadline(state: DraftTrackerState): string {
  if (state.status === 'stopped') {
    return 'Tracking stopped';
  }
  if (state.stale) {
    return 'Showing last known good board';
  }
  if (state.consecutiveFailureCount > 0) {
    return 'Retrying after a failed sync';
  }
  return state.status === 'running' ? 'Live' : 'Idle';
}

function resolveDetail(state: DraftTrackerState, secondsSinceLastSync: number | null): string {
  const freshness =
    secondsSinceLastSync === null
      ? 'No successful sync yet.'
      : `Last synced ${secondsSinceLastSync}s ago.`;

  if (state.consecutiveFailureCount === 0) {
    return freshness;
  }

  const attempts = state.consecutiveFailureCount === 1 ? 'attempt' : 'attempts';
  return `${freshness} ${state.consecutiveFailureCount} failed ${attempts}${
    state.lastErrorMessage === null ? '' : `: ${state.lastErrorMessage}`
  }`;
}
