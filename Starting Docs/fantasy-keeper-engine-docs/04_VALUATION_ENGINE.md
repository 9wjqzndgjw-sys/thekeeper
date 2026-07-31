# Valuation Engine

## Objective

Produce team-specific and league-specific values while exposing a complete component breakdown. Start deterministic and interpretable.

## Intrinsic Value (IV)

Represents expected fantasy contribution independent of acquisition cost.

```text
IV = projected starter points above position-adjusted replacement
   + lineup flexibility
   + scarcity adjustment
   + risk-adjusted future value
```

## Keeper Surplus Value (KSV)

```text
KSV(player, team, season)
  = IV(player)
  - opportunityCost(exactPickConsumed)
  - keeperSlotOpportunityCost
```

The consumed pick is the exact resolved asset after missing-pick and multi-keeper interactions.

## Team Context Value (TCV)

```text
TCV
  = KSV
  + rosterFit
  + positionalNeed
  + windowAdjustment
  + pickInventoryAdjustment
  + futureKeeperOptionValue
  + draftPoolControlValue
  + marketLiquidityAdjustment
  - concentrationRisk
  - uncertaintyPenalty
```

TCV is not globally unique. The same player should differ by team.

## Replacement level

Reflect the actual 12-team lineup, six bench spots, up to 36 keepers, TE premium, and actual post-keeper pool.

Maintain:

- pre-keeper replacement weighted by expected keeper probabilities;
- post-keeper replacement from the confirmed draft pool.

## Positional rules

TE valuation must reflect full PPR, required starter, flex eligibility, and actual tier gaps. QB valuation must reflect six-point passing TDs. Return yards and custom defense require league-specific inputs.

## Exact pick-value curve

Generate value by overall pick, not round. Update the curve pre-keeper, post-keeper, and during the draft.

## Future keeper option value

```text
FutureKeeperOptionValue =
  probability(player remains keep-worthy next year)
  × expected next-year surplus
  × discount factor
```

Use a practical multi-year horizon and discount for injury, role, age, keeper competition, and escalating cost.

## Keeper-slot opportunity cost

Calculate at the combination level as the value of the best excluded legal alternative.

## Team direction

Support contender, balanced, retool, and rebuild modes, with user override.

## Explanation example

```text
Projected contribution             +42
TE-premium scarcity                 +18
Exact pick cost: 7.05              -11
Future keeper option                +9
Competing keeper opportunity cost   -4
Roster fit                           +6
Uncertainty penalty                 -3
---------------------------------------
Team Context Value                  57
```

## Versioning

Every output includes projection source version, league-rules version, engine version, and snapshot timestamp.
