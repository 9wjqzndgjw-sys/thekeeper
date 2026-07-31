# Data Model

## Storage strategy

Use PostgreSQL for durable history and fixture files for early development. Separate raw API snapshots, normalized league data, and derived valuations.

## Suggested tables

- `leagues`
- `league_seasons`
- `franchises`
- `franchise_seasons`
- `players`
- `player_seasons`
- `roster_memberships`
- `drafts`
- `draft_pick_assets`
- `draft_selections`
- `keeper_rights`
- `keeper_decisions`
- `transactions`
- `trade_assets`
- `raw_api_snapshots`
- `valuation_runs`
- `asset_valuations`

## Important fields

### draft_pick_assets

Season, round, original franchise, current franchise, slot, overall pick, and ownership confidence.

### keeper_rights

Season, franchise, player, nominal round, source type, source season, confidence, and override reason.

### valuation_runs

Snapshot time, engine version, projection version, rules version, and assumptions.

### asset_valuations

Franchise, asset, IV, KSV, TCV, components, and uncertainty bounds.

## Manual overrides

Support keeper origin, nominal cost, franchise continuity, historical ownership, commissioner rulings, and draft-order corrections. Record reason, user, time, prior value, and new value.

## Derived views

- current pick inventory;
- player asset timeline;
- keeper cost history;
- manager keeper surplus;
- keeper-surplus inventory;
- historical draft ROI;
- championship roster construction.

## Fixtures

Check in a synthetic league, a historical league fixture, an active mock-draft fixture, and malformed-response fixtures. Tests must not depend on the live API.
