# Keeper League Intelligence Engine

A league-specific fantasy football valuation, keeper optimization, trade analysis, and draft-day decision system built around Sleeper data.

This project is intentionally **not** a generic dynasty calculator. Its purpose is to model the exact economic rules of one keeper league, including:

- up to three keepers per team;
- indefinite keeper duration;
- keeper cost advancing one round per season;
- undrafted free agents becoming tenth-round keepers;
- exact draft-slot and overall-pick opportunity cost;
- the rule that a missing keeper-round pick forces use of the next earlier owned pick;
- a public keeper deadline seven days before the draft;
- tradeable future draft picks;
- dynamic annual draft order;
- a toilet-bowl prize that awards 1.01;
- pre-deadline trades that can remove players from the draft pool;
- keeper-slot scarcity, optionality, denial value, and draft-pool manipulation;
- TE-premium scoring;
- a live draft-day tracker powered by the Sleeper API.

## Guiding principle

The engine should answer:

> What is this player, keeper, pick, or trade worth to this specific team, in this specific league, at this specific moment?

That requires three layers of value:

1. **Intrinsic Value (IV)** — expected fantasy production.
2. **Keeper Surplus Value (KSV)** — intrinsic value minus the opportunity cost of the exact pick consumed.
3. **Team Context Value (TCV)** — KSV adjusted for roster, draft inventory, keeper competition, team direction, market structure, and strategic effects on other teams.

## Suggested reading order

1. `01_LEAGUE_RULES.md`
2. `02_PRODUCT_SPEC.md`
3. `03_DOMAIN_MODEL.md`
4. `04_VALUATION_ENGINE.md`
5. `05_KEEPER_OPTIMIZER.md`
6. `06_MARKET_AND_GAME_THEORY.md`
7. `07_SLEEPER_API_PLAN.md`
8. `08_DRAFT_DAY_TRACKER.md`
9. `09_DATA_MODEL.md`
10. `10_TEST_PLAN.md`
11. `11_IMPLEMENTATION_ROADMAP.md`
12. `12_CODEX_STARTER_PROMPTS.md`

## Initial technical recommendation

Use a monorepo with TypeScript, a React-based web app, a framework-independent valuation package, PostgreSQL, and Vitest. The valuation engine should remain a pure deterministic library and should not know about HTTP, databases, UI state, or Sleeper response shapes.

## First milestone

Build a local command-line prototype that can:

1. load normalized league data from fixture files;
2. reconstruct exact keeper costs;
3. enumerate all legal keeper combinations;
4. calculate IV, KSV, and preliminary TCV;
5. produce a pre-keeper board and a post-keeper board;
6. explain every recommendation in plain English.

Do not begin with a polished UI. Prove the rules and calculations first.
