# League Rules and Economic Consequences

## League format

- 12 teams
- 15-round snake draft
- no third-round reversal
- up to 3 keepers per team
- keepers may be retained indefinitely
- keeper cost advances one round each season
- undrafted acquisitions become tenth-round keepers
- future draft picks may be traded
- keeper rights cannot be traded separately from players
- trades process immediately
- keepers lock seven days before the draft
- declared keepers are visible to the league before the draft
- annual draft order is dynamic
- the toilet-bowl losers-bracket winner receives 1.01

## Starting lineup

QB, RB, RB, WR, WR, TE, FLEX, FLEX, DEF, 6 bench, 2 IR.

## Scoring

- Passing: 1 point per 25 yards, 6 per touchdown, -2 per interception.
- Rushing/receiving: 1 per 10 yards, 6 per touchdown.
- RB/WR: 0.5 PPR.
- TE: 1.0 PPR.
- Return yards count.
- Defense uses custom scoring.

## Keeper-cost progression

A player normally costs one round earlier than the prior season.

| Season | Event | Cost |
|---|---|---:|
| 2021 | drafted | 8th |
| 2022 | kept | 7th |
| 2023 | kept | 6th |
| 2024 | kept | 5th |
| 2025 | kept | 4th |

This creates long-lived asset histories. A successful late-round pick can generate multiple seasons of surplus.

## Missing-pick rule

If a manager does not own the nominal keeper-round pick, the keeper consumes the next earlier pick that manager still owns.

Example:

- nominal keeper cost: 5th;
- manager traded away the 5th;
- manager owns a 4th;
- effective keeper cost: that manager's 4th-round pick.

The engine must distinguish nominal round, nominal overall pick, effective round, effective overall pick, displacement reason, and which keeper or trade interaction caused the displacement.

A player should never be represented only as “a fifth-round keeper.”

## Exact overall-pick cost

Round labels are insufficient. The same nominal keeper round can cost different overall picks for different teams. Annual draft order and traded picks change opportunity cost. All keeper calculations must resolve to an exact draft asset.

## Keeper-slot scarcity

Each team may keep at most three players. A player's keeper value depends on whether the team has an available slot, which players compete for it, whether the player can be re-acquired in the draft, and what flexibility the decision creates elsewhere.

## Public keeper deadline

Support three states:

1. **pre-deadline** — keeper choices and trades are uncertain;
2. **post-deadline / pre-draft** — keeper pool is known;
3. **live draft** — the available pool changes pick by pick.

## Dynamic draft order and 1.01

The toilet-bowl winner receives 1.01. That pick can let a team decline to keep its own elite first-round-cost player, use all three keeper slots elsewhere, and re-draft the elite player at 1.01. This creates **keeper-slot liberation value**.

## Pre-deadline trade market

Teams with more than three attractive keepers have excess inventory. An excess player's value to the current owner may be low because the player would otherwise return to the draft, while another team may value the player for keeper access, optionality, or draft-pool control.
