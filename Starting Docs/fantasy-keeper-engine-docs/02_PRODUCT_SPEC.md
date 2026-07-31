# Product Specification

## Product vision

Build a decision-support application that models the complete keeper-league economy rather than returning a context-free trade number.

The system should answer:

- Which three players should I keep?
- What exact picks will those keepers consume?
- How much surplus does each keeper create?
- Which players are likely to be traded before keeper lock?
- Which teams are natural buyers and sellers?
- How likely is a target to reach my pick?
- What is a pick worth before and after keepers are declared?
- Which live draft choice maximizes current and future value?
- Why did a manager succeed historically?

## Product modes

### League setup

Import seasons, drafts, rosters, traded picks, and transactions; confirm custom rules; map Sleeper roster IDs to stable franchise identities; validate scoring and lineup settings.

### Historical reconstruction

Rebuild acquisition history, keeper progression, exact pick costs, trades, ownership changes, and manual overrides.

### Keeper planning

Show all legal combinations, resolve missing-pick displacement, compare keep versus release-and-redraft, and explain every recommendation.

### Market intelligence

Identify keeper surplus, keeper demand, sell pressure, trade matches, draft removal risk, and likely market effects.

### Draft preparation

Maintain two boards:

- **Pre-keeper board:** expected keeper decisions, entry probabilities, keeper-adjusted pick values, and market effects.
- **Post-keeper board:** confirmed player pool, actual replacement levels, actual pick inventories, and updated tiers.

### Live draft tracker

Poll Sleeper, detect new picks idempotently, update recommendations, show upcoming teams, and tolerate stale or temporarily unavailable responses.

### League history

Show player asset timelines, cumulative keeper surplus, keeper yield, draft ROI, trade ROI, and championship roster construction.

## Non-goals for the first release

- submitting picks or trades to Sleeper;
- replacing all projection sources;
- generic public-league support;
- opaque ML recommendations;
- false precision about opponent psychology.

## Core UX principle

Every value must be explainable through projection, exact pick cost, replacement value, future keeper path, keeper competition, roster fit, draft-pool effects, and uncertainty.

## MVP acceptance criteria

The MVP can normalize one league, compute exact keeper costs, detect forced earlier picks, enumerate keeper sets, generate pre/post boards, ingest mock-draft picks, recalculate after each pick, and explain every output.
