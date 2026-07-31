# Codex Starter Prompts

Use these prompts sequentially after placing all markdown files in the repository.

## 1. Bootstrap

```text
Read every markdown file before making changes.

Create a TypeScript monorepo for the keeper-league intelligence engine. Use strict TypeScript, ESLint, Prettier, Vitest, and CI.

Create:
- packages/domain
- packages/keeper-optimizer
- packages/valuation
- packages/sleeper-adapter
- packages/test-fixtures
- apps/cli
- apps/web

Do not build a polished UI yet. Add a synthetic fixture. Keep domain and valuation free of framework and HTTP dependencies. Run typecheck and tests and summarize open questions.
```

## 2. Draft-pick math

```text
Read 01_LEAGUE_RULES.md, 03_DOMAIN_MODEL.md, and 10_TEST_PLAN.md.

Implement typed round/slot/overall-pick conversion and pick inventory for a configurable draft. Use 12 teams and 15 snake rounds initially. Test all 180 picks. Isolate draft-order strategy behind an interface.
```

## 3. Keeper resolution

```text
Read the league rules and keeper optimizer docs.

Implement keeper progression, undrafted tenth-round cost, maximum three keepers, next-earlier-pick displacement, structured explanations, invalid combinations, and exhaustive enumeration of sets of size 0 through 3. Make keeper ordering configurable. Add unit and property tests.
```

## 4. Known user fixture

```text
Create a 2026 fixture with picks 1.05, 2.08, 3.05, 4.08, 6.08, 7.05, 9.05, 10.08, 11.05, 12.08, 13.05, 14.08, and 15.05; no 5th or 8th.

Include Jayden Daniels at nominal round 5, Trey McBride at 7, Caleb Williams at 11, and the other documented candidates. Assert Daniels resolves to 4.08 when available and test collisions.
```

## 5. Baseline valuation

```text
Implement pluggable projections, replacement levels, exact-pick values, IV, KSV, TCV components, uncertainty, and structured explanations. Use fixture projections. Prove the same player can differ by franchise and that pick cost is subtracted once.
```

## 6. Keeper optimizer integration

```text
For every legal keeper set return players, nominal costs, resolved picks, displacement, retained IV, consumed pick value, KSV, TCV, total score, and explanation. Add expected, safest, win-now, and future modes. Expose a CLI that prints markdown.
```

## 7. Sleeper adapter

```text
Read 07_SLEEPER_API_PLAN.md and the official Sleeper docs. Implement a read-only adapter with timeouts, rate limiting, retries, Zod validation, unknown-field tolerance, raw fixture capture, and normalized mappers for league, users, rosters, drafts, picks, and traded picks. Tests use fixtures only.
```

## 8. Pick ownership reconstruction

```text
Reconstruct pick inventory from draft order, original ownership, traded picks, metadata, and selections. Return original/current owner, round, slot, and overall pick. Add ambiguity diagnostics and manual overrides.
```

## 9. Live tracker service

```text
Implement configurable polling with a 3-second default, aborts, backoff, jitter, idempotent reconciliation, correction/removal detection, sync timestamp, stale state, manual pick injection, API reconciliation, immutable snapshots, and replay. Use fake timers.
```

## 10. Minimal web dashboard

```text
Build functional views for setup, keeper combinations, pre-keeper board, post-keeper board, and live tracker. Show sync status, current pick, user next pick, available board, recommendation breakdown, teams before the user, and stale warnings. Keep logic outside React.
```

## 11. Market intelligence

```text
Implement transparent first-pass keeper surplus, demand, excess value, sell pressure, buyer fit, and draft-removal inputs. Never claim a manager will trade. Add a roster fixture with more than three elite keeper candidates.
```

## 12. Release versus re-draft

```text
Implement decision-tree comparison for keeping, releasing, freeing a slot, re-drafting, and fallback outcomes. Support keeper-slot liberation and user-supplied re-acquisition probabilities. Add 1.01, 1.02, 1.05, and 1.08 scenarios. Report denial value separately.
```

## 13. Historical timelines

```text
Implement drafted, traded, added, dropped, kept, re-drafted, and returned-to-pool lifecycle events. Add cumulative keeper surplus, keeper yield, draft ROI, and years retained. Include an eighth-round rookie kept in rounds 7, 6, 5, and 4.
```

## 14. Audit

```text
Audit the repository against every markdown requirement. Report implemented items, gaps, ambiguities, untested assumptions, architecture risks, and prioritized next steps. Run tests, type checks, and linting. Do not invent league rules.
```
