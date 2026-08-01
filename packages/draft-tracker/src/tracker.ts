import {
  injectManualSelection,
  reconcileSelections,
  type DraftSelectionInput,
  type DraftTrackerEvent,
  type TrackedSelection,
} from './reconcile.js';

export type DraftTrackerStatus = 'idle' | 'running' | 'stopped';

export interface DraftTrackerState {
  draftId: string;
  status: DraftTrackerStatus;
  selections: readonly TrackedSelection[];
  lastSuccessfulSyncAt: string | null;
  lastAttemptedSyncAt: string | null;
  consecutiveFailureCount: number;
  lastErrorMessage: string | null;
  /** True once the last successful sync is older than `staleAfterMs`. Drives the UI warning. */
  stale: boolean;
}

export interface DraftTrackerOptions {
  draftId: string;
  fetchSelections: (signal: AbortSignal) => Promise<readonly DraftSelectionInput[]>;
  /** Active-draft polling cadence. The tracker doc starts at 3 seconds. */
  intervalMs?: number;
  /** Cadence used when `isDocumentVisible` reports the tab is hidden. */
  hiddenIntervalMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Fraction of a delay that may be added as jitter, spreading retries across clients. */
  jitterRatio?: number;
  staleAfterMs?: number;
  now?: () => number;
  random?: () => number;
  isDocumentVisible?: () => boolean;
  initialSelections?: readonly TrackedSelection[];
}

export interface DraftTracker {
  getState(): DraftTrackerState;
  start(): void;
  stop(): void;
  /** Forces an immediate sync and reschedules. Use for a manual refresh or tab resume. */
  refreshNow(): Promise<DraftTrackerState>;
  injectManualPick(selection: DraftSelectionInput): DraftTrackerState;
  subscribe(listener: DraftTrackerListener): () => void;
}

export type DraftTrackerListener = (
  events: readonly DraftTrackerEvent[],
  state: DraftTrackerState,
) => void;

const DEFAULTS = {
  intervalMs: 3_000,
  hiddenIntervalMs: 30_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 30_000,
  jitterRatio: 0.2,
  staleAfterMs: 15_000,
} as const;

export function createDraftTracker(options: DraftTrackerOptions): DraftTracker {
  const config = {
    intervalMs: options.intervalMs ?? DEFAULTS.intervalMs,
    hiddenIntervalMs: options.hiddenIntervalMs ?? DEFAULTS.hiddenIntervalMs,
    backoffBaseMs: options.backoffBaseMs ?? DEFAULTS.backoffBaseMs,
    backoffMaxMs: options.backoffMaxMs ?? DEFAULTS.backoffMaxMs,
    jitterRatio: options.jitterRatio ?? DEFAULTS.jitterRatio,
    staleAfterMs: options.staleAfterMs ?? DEFAULTS.staleAfterMs,
  };
  assertPositive('intervalMs', config.intervalMs);
  assertPositive('hiddenIntervalMs', config.hiddenIntervalMs);
  assertPositive('backoffBaseMs', config.backoffBaseMs);
  assertPositive('backoffMaxMs', config.backoffMaxMs);
  assertPositive('staleAfterMs', config.staleAfterMs);
  if (config.jitterRatio < 0 || config.jitterRatio >= 1) {
    throw new Error(`jitterRatio must be at least 0 and below 1; received ${config.jitterRatio}.`);
  }

  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const isDocumentVisible = options.isDocumentVisible ?? (() => true);

  const listeners = new Set<DraftTrackerListener>();
  let selections: readonly TrackedSelection[] = options.initialSelections ?? [];
  let status: DraftTrackerStatus = 'idle';
  let lastSuccessfulSyncAtMs: number | null = null;
  let lastAttemptedSyncAt: string | null = null;
  let consecutiveFailureCount = 0;
  let lastErrorMessage: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let syncQueue: Promise<void> = Promise.resolve();
  let nextDueAtMs: number | null = null;
  let wasDocumentVisible = isDocumentVisible();

  function getState(): DraftTrackerState {
    return {
      draftId: options.draftId,
      status,
      selections,
      lastSuccessfulSyncAt:
        lastSuccessfulSyncAtMs === null ? null : new Date(lastSuccessfulSyncAtMs).toISOString(),
      lastAttemptedSyncAt,
      consecutiveFailureCount,
      lastErrorMessage,
      stale:
        lastSuccessfulSyncAtMs === null
          ? selections.length > 0
          : now() - lastSuccessfulSyncAtMs > config.staleAfterMs,
    };
  }

  function emit(events: readonly DraftTrackerEvent[]): void {
    const state = getState();
    for (const listener of listeners) {
      listener(events, state);
    }
  }

  function currentIntervalMs(): number {
    if (consecutiveFailureCount > 0) {
      const exponential = config.backoffBaseMs * 2 ** (consecutiveFailureCount - 1);
      return Math.min(config.backoffMaxMs, exponential);
    }
    return isDocumentVisible() ? config.intervalMs : config.hiddenIntervalMs;
  }

  function withJitter(delayMs: number): number {
    if (config.jitterRatio === 0) {
      return delayMs;
    }
    return Math.round(delayMs * (1 + config.jitterRatio * random()));
  }

  function scheduleNext(): void {
    if (status !== 'running') {
      return;
    }
    clearTimer();
    nextDueAtMs = now() + withJitter(currentIntervalMs());
    wasDocumentVisible = isDocumentVisible();
    armTimer();
  }

  /**
   * Never sleeps past the active cadence even when the next fetch is further out, so a
   * tab returning to the foreground is noticed promptly instead of waiting out the whole
   * hidden interval. The extra wake-ups do no work and issue no requests.
   */
  function armTimer(): void {
    if (status !== 'running' || nextDueAtMs === null) {
      return;
    }
    const remainingMs = Math.max(0, nextDueAtMs - now());
    timer = setTimeout(onWake, Math.min(remainingMs, config.intervalMs));
  }

  function onWake(): void {
    timer = null;
    if (status !== 'running') {
      return;
    }

    const documentVisible = isDocumentVisible();
    const resumed = documentVisible && !wasDocumentVisible;
    wasDocumentVisible = documentVisible;

    if (resumed || nextDueAtMs === null || now() >= nextDueAtMs) {
      void runSync();
      return;
    }
    armTimer();
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // Every sync goes through one queue so a manual refresh landing mid-poll cannot
  // interleave two reconciliations against the same prior state.
  function runSync(): Promise<void> {
    const queued = syncQueue.then(() => performSync());
    syncQueue = queued.catch(() => undefined);
    return queued;
  }

  async function performSync(): Promise<void> {
    if (status === 'stopped') {
      return;
    }

    const controller = new AbortController();
    inFlight = controller;
    lastAttemptedSyncAt = new Date(now()).toISOString();

    try {
      const incoming = await options.fetchSelections(controller.signal);
      if (controller.signal.aborted) {
        return;
      }

      const result = reconcileSelections({
        draftId: options.draftId,
        previous: selections,
        incoming,
        recordedAt: new Date(now()).toISOString(),
      });
      selections = result.selections;
      lastSuccessfulSyncAtMs = now();
      consecutiveFailureCount = 0;
      lastErrorMessage = null;
      emit(result.events);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      // Retain the last known good board; only the freshness signals change.
      consecutiveFailureCount += 1;
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      emit([]);
    } finally {
      if (inFlight === controller) {
        inFlight = null;
      }
      scheduleNext();
    }
  }

  return {
    getState,
    start(): void {
      if (status === 'running') {
        return;
      }
      status = 'running';
      void runSync();
    },
    stop(): void {
      status = 'stopped';
      clearTimer();
      inFlight?.abort();
      inFlight = null;
    },
    async refreshNow(): Promise<DraftTrackerState> {
      if (status === 'stopped') {
        status = 'idle';
      }
      clearTimer();
      await runSync();
      return getState();
    },
    injectManualPick(selection: DraftSelectionInput): DraftTrackerState {
      const result = injectManualSelection({
        draftId: options.draftId,
        previous: selections,
        selection,
        recordedAt: new Date(now()).toISOString(),
      });
      selections = result.selections;
      emit(result.events);
      return getState();
    },
    subscribe(listener: DraftTrackerListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function assertPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number; received ${value}.`);
  }
}
