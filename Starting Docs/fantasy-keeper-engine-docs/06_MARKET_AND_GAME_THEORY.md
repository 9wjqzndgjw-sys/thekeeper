# Market and Game-Theory Model

## Core observation

The pre-keeper market trades not only production but keeper access, scarce slots, optionality, draft-pool control, and denial of access to later teams.

## Keeper surplus and demand

```text
valuableKeeperCount = count of positive-value keeper candidates
keeperSurplus = max(0, valuableKeeperCount - keeperLimit)
keeperDemand = max(0, keeperLimit - valuableKeeperCount)
```

Combination-level optimization remains the source of truth.

## Sell pressure

Potential components:

```text
SellPressure =
  excessKeeperValue
  × expirationUrgency
  × buyerDepth
  × marketability
```

High pressure means incentive, not certainty.

## Buyer value by draft position

A team drafting before 1.05 that acquires an elite player may keep him, release and draft him before 1.05, preserve the choice until lock, and remove him from the later team's opportunity set.

A later team can still gain access to a player it likely could not draft naturally, but the denial effect differs.

## Optionality value

```text
OptionalityValue =
  value(best future decision)
  - value(decision required today)
```

Model through a decision tree when possible.

## Denial value

```text
DenialValue(buyer, player) =
  sum over rivals of
  P(player reaches rival without acquisition)
  × rival incremental gain
  × rivalry weight
```

Expose this separately in early versions to avoid double counting.

## Draft removal risk

Estimate the probability a player is kept, traded and kept, released and drafted earlier, or available at the user's pick. These events are dependent, so simulation is preferred later.

## Pre-deadline simulation

Iteratively optimize keeper sets, identify excess players, generate buyer/seller pairs, evaluate plausible trades, update rosters/picks, and repeat across many simulations.

Outputs should include trade probability, likely buyer, draft-pool entry probability, and availability by pick.

## Guardrails

Show confidence and assumptions. Distinguish modeled incentives from predictions of human behavior.
