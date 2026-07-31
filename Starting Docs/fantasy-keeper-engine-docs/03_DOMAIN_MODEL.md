# Domain Model

## Design rule

Sleeper objects are transport shapes. Convert them into stable internal domain objects before valuation logic runs. The valuation package must not import Sleeper-specific types.

## Core entities

### League

Continuing league identity, rules, scoring, lineup, keeper limit, and rules version.

### Season

Season year, Sleeper league ID, previous league ID, status, draft ID, draft-order method, keeper deadline, and draft time.

### Franchise

Stable team identity across seasons, even if roster IDs or users change.

### Roster

Season-specific franchise roster, reserves, record, and playoff result.

### Player / PlayerSeason

Stable player identity plus season-specific projection, age, role, team, injury, and actual performance.

### Draft / DraftPickAsset / DraftSelection

Draft metadata, rights to picks, original/current ownership, exact slot where known, and actual selections.

### KeeperRight

Season, player, franchise, source type, nominal round, effective pick, confidence, and manual override.

### KeeperDecision

Actual or simulated keeper choice, resolved pick, resolution order, and explanation.

### Transaction / Trade

Normalized player and pick movement with source snapshots.

### LeagueStateSnapshot

Immutable input to the valuation engine containing rules, rosters, keeper rights, declarations, pick inventory, draft state, projections, assumptions, user franchise, and evaluation time.

### ValuationResult

IV, KSV, TCV, component breakdown, uncertainty, explanation, and engine version.

## Required invariants

- maximum keeper count enforced;
- one player kept by at most one franchise;
- one pick asset cannot be consumed twice;
- resolved keeper pick must be owned by the franchise;
- displacement moves earlier, never later;
- draft selections have unique overall picks;
- snapshots are immutable;
- valuations include version and timestamp.

## Historical lifecycle

Each player should support drafted, added, dropped, traded, kept, re-drafted, and returned-to-pool events.
