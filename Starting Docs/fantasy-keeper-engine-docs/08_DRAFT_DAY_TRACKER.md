# Draft-Day Tracker

## Goal

Provide a live decision dashboard that updates as Sleeper draft selections appear. Prioritize correctness and explicit sync status over pretending to be instantaneous.

## Data flow

```text
Sleeper polling
  -> raw validation
  -> pick reconciliation
  -> immutable league snapshot
  -> valuation recomputation
  -> UI update
```

## Polling loop

During active drafting:

1. fetch metadata periodically;
2. fetch current picks every configurable interval;
3. compare with canonical state;
4. emit new, changed, or removed pick events;
5. recalculate;
6. persist the snapshot.

Initial interval: 3 seconds. Use abortable requests, backoff, jitter, visibility-aware throttling, tab-resume refresh, and manual refresh.

## Idempotent reconciliation

Key selections by draft ID and overall pick. Detect new picks, corrected players, changed rosters, removed picks, and duplicate rows. Rebuild canonical state when necessary.

## UI status

Always show draft status, last successful sync, polling state, stale warning, current pick, and user's next pick.

## Dashboard

### Available board

Rank, player, position, IV, current value, future keeper value, next keeper cost, user TCV, tier, and confidence.

### Recommendation panel

Top overall, win-now, future keeper, safest, position alternatives, and reasons to deviate from consensus.

### Pick horizon

Teams selecting before the user, current roster, declared keepers, likely needs, picks owned, and target overlap.

### Scarcity panel

Players left in tiers, positional runs, replacement shifts, and expected drop before the next user pick.

## Survival probability

Start with heuristics, then simulate selections using ranks, roster needs, manager tendencies, and keeper economics. Every probability must identify assumptions and model version.

## Offline mode

Retain last state, allow manual pick entry, mark it clearly, and reconcile later with API data without double counting.

## Replay mode

Use the same tracker to replay historical drafts for testing and counterfactual analysis.

## Performance targets

- reconciliation under 50 ms;
- deterministic valuation under 250 ms on a normal laptop;
- simulation asynchronous;
- immediate deterministic UI update.
