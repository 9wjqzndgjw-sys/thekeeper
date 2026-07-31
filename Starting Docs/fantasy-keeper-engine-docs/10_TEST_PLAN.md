# Test Plan

## Priority

1. rule correctness;
2. deterministic reproducibility;
3. explanation consistency;
4. API reconciliation;
5. UI behavior.

## Unit tests

### Keeper progression

Drafted in the 8th becomes 7th, repeated keeps advance, undrafted becomes 10th, overrides win, and impossible costs error explicitly.

### Missing-pick displacement

Test 5th to 4th, 5th to 3rd, no legal earlier pick, no pick reuse, traded-in nominal picks, and exact overall-pick resolution.

### Multiple keepers

Distinct rounds, collisions, displacement chains, maximum three, and all combinations from zero through three.

### Snake conversion

For 12 teams:

```text
odd round overall = (round - 1) * 12 + slot
even round overall = (round - 1) * 12 + (13 - slot)
```

Test all 180 picks and isolate the strategy for future draft types.

### Value calculations

IV team-independent, KSV exact-pick-dependent, TCV team-dependent, pre/post replacement differences, TE premium, future-option discount, and no double counting.

## Required user scenario

Given picks 1.05, 2.08, 3.05, 4.08, no 5th, 6.08, 7.05, no 8th, and the remaining documented picks, Jayden Daniels at nominal round 5 must resolve to 4.08 when unused. Another keeper consuming that pick must change or invalidate the set.

## Scenario tests

- keeper-slot liberation at 1.01;
- denial by a team at 1.02 against a team at 1.05;
- six positive keeper candidates triggering sell pressure without claiming certainty.

## API contract tests

Normalize league, draft, picks, and empty traded-picks fixtures; tolerate unknown fields; report missing required fields; reconcile duplicates and corrected picks.

## Polling tests

Use fake timers for new-pick detection, unchanged responses, error preservation, backoff, recovery, tab resume, stale state, manual entry, and reconciliation.

## Property tests

- no pick consumed twice;
- resolved pick owned by team;
- resolved round never later than nominal;
- adding an owned nominal pick cannot force an earlier result;
- deterministic inputs produce identical outputs;
- unique selections reduce availability by one.

## Historical backtesting

Replay prior drafts without future information and measure recommendation rank, projected versus actual points, realized keeper surplus, and availability calibration.
