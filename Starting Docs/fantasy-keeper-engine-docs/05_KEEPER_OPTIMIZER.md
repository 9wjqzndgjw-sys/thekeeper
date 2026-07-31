# Keeper Optimizer

## Purpose

Find the best legal set of zero to three keepers while correctly resolving exact pick consumption and keeper interactions.

## Why independent ranking fails

- only three slots exist;
- multiple keepers may collide in a round;
- missing picks force earlier picks;
- one keeper can change another's resolved cost;
- release-and-redraft may beat keeping;
- draft position changes re-acquisition probability.

## Combination enumeration

Exhaustively evaluate every subset of size 0 through 3. The search space is small enough for exact evaluation.

## Pick-resolution algorithm

The ordering policy must be configurable and validated against history.

Candidate default:

1. sort selected keepers by nominal round from earliest to latest;
2. attempt to assign an owned unused pick in the nominal round;
3. if unavailable, search earlier rounds;
4. fail if no legal pick exists;
5. record each displacement.

Do not silently assume Sleeper's internal resolution order.

## Preferred scoring contract

- calculate player IV independently;
- resolve all picks at combination level;
- subtract consumed-pick values once;
- add combination-level effects;
- attribute results back to players for explanation.

## Release-and-redraft

Compare:

- keeping the player and consuming a slot/pick;
- releasing, freeing the slot, estimating re-acquisition, and using a fallback if missed.

```text
ExpectedReleaseValue =
  P(reacquire) × player value
  + P(miss) × fallback value
  + extra keeper-slot value
```

## Output

For every legal combination return selected players, nominal costs, resolved picks, displacement events, IV, pick cost, KSV, TCV, released players, re-draft targets, explanation, and confidence.

Provide best expected, safest, win-now, future-value, and user-selected comparison views.
