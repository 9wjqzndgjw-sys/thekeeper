# Implementation Roadmap

## Phase 0 — Repository

Create a TypeScript monorepo, strict typing, formatting, linting, Vitest, CI, architecture decisions, and fixtures.

Suggested packages:

```text
apps/web
apps/cli
packages/domain
packages/valuation
packages/keeper-optimizer
packages/sleeper-adapter
packages/simulation
packages/test-fixtures
```

## Phase 1 — Pure keeper rules

Implement snake math, pick inventory, progression, missing-pick resolution, combination enumeration, and explanations. No live API yet.

## Phase 2 — Sleeper import

Implement API client, validation, raw fixture capture, league/draft import, franchise mapping, pick ownership, and player identity.

## Phase 3 — Baseline valuation

Implement projection interface, scoring translation, replacement levels, exact pick curve, IV, KSV, and initial TCV.

## Phase 4 — Keeper optimizer

Expose all legal sets, best/safest/win-now/future modes, release-and-redraft scenarios, assumptions, and comparisons through a CLI and then UI.

## Phase 5 — Market analysis

Add keeper surplus, demand, sell pressure, buyer/seller matching, and draft removal risk.

## Phase 6 — Draft tracker

Add polling, reconciliation, stale state, live updates, pick horizon, offline entry, replay, and mock-draft testing.

## Phase 7 — Simulation

Add probabilistic keeper decisions, trade simulation, survival probabilities, keeper-slot liberation, optionality, and denial value.

## Phase 8 — Historical intelligence

Add asset timelines, keeper yield, draft ROI, trade ROI, and championship construction analysis.

## First vertical slice

```text
fixture league state
-> user pick inventory
-> eligible keepers
-> exact keeper resolution
-> IV/KSV
-> best keeper set
-> markdown explanation
```

## Avoid

- round-only values;
- Sleeper types in business logic;
- independent keeper calculations;
- hidden assumptions;
- saving only derived data;
- live API tests;
- ML before deterministic rules are stable.
