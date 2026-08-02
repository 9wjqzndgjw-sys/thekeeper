# Keeper League Intelligence Engine

A valuation, keeper-optimization, and draft-day decision system built for the exact
economic rules of one Sleeper keeper league.

This is deliberately **not** a generic dynasty trade calculator. It exists to answer one
question precisely:

> What is this player, keeper, pick, or trade worth **to this specific team, in this
> specific league, at this specific moment**?

## Why it is league-specific

Generic tools price players. This league's decisions are priced by its rules:

- three keepers a team, retained indefinitely
- a keeper's cost climbs one round every season, and **holds at the first round** once it
  gets there
- a keeper consumes an **exact draft pick**, not a round label — and if the nominal round
  is gone, the next earlier owned pick is taken instead
- picks are tradeable, so the same nominal round costs different teams different picks
- the toilet-bowl winner receives 1.01, which lets a team decline to keep an elite player,
  spend all three keeper slots elsewhere, and re-draft him first overall
- TE-premium scoring (0.5 PPR base, full PPR for tight ends) and six-point passing
  touchdowns, which reorder any board computed for standard scoring

## Architecture

A TypeScript monorepo. Valuation is a pure, deterministic library that knows nothing about
HTTP, databases, or UI state.

| Package                     | Responsibility                                                             |
| --------------------------- | -------------------------------------------------------------------------- |
| `packages/domain`           | Entities, ids, and draft-order maths (snake, third-round reversal)         |
| `packages/valuation`        | Scoring translation, replacement levels, IV / KSV / TCV                    |
| `packages/keeper-optimizer` | Exhaustive keeper-set search, pick resolution, release-vs-redraft          |
| `packages/sleeper-adapter`  | Read-only Sleeper client, franchise mapping, pick-ownership reconstruction |
| `packages/projections`      | Projection imports rescored under the league's own settings                |
| `packages/draft-tracker`    | Live polling, idempotent reconciliation, live board                        |
| `packages/market`           | Keeper surplus, sell pressure, buyer fit, denial value                     |
| `packages/history`          | Player asset timelines and league keeper history                           |
| `apps/cli`                  | Board, import, keeper reconstruction, draft replay                         |
| `apps/web`                  | React dashboard over pure view models                                      |

### Three layers of value

1. **Intrinsic Value** — expected production above a replacement level computed from the
   _actual_ roster shape, including bench depth.
2. **Keeper Surplus Value** — intrinsic value minus the opportunity cost of the exact pick
   consumed.
3. **Team Context Value** — surplus adjusted for roster fit, pick inventory, and
   competition for keeper slots. Deliberately not globally unique: the same player is
   worth different amounts to different teams.

## Running it

Create `.env.local` at the repository root. It is git-ignored, and a league id identifies a
real group of people even though it is not itself a secret.

```bash
SLEEPER_LEAGUE_ID=<numeric league id>

# Supabase. The anon key is published to every visitor by design -- row level security is
# what protects the data. The service-role key bypasses RLS entirely and must stay local.
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Which season the dashboard displays.
VITE_KEEPER_SEASON_ID=season:<numeric league id>

# Projection exports, rescored under this league's settings before anything uses them.
KEEPER_SKILL_PROJECTIONS_CSV=<path to skill positions csv>
KEEPER_DEFENSE_PROJECTIONS_CSV=<path to defence csv>
```

Then, in order — each step depends on the one above it:

```bash
npm install

# 1. Pull the Sleeper player catalog (~5MB; Sleeper asks for at most one fetch per day)
npm run catalog -w @keeper/cli

# 2. Import the league: franchises, pick ownership, traded picks, declared keepers, rules
npm run sync -w @keeper/cli

# 3. Score the projection exports and store them, so the browser can read them too
npm run project -w @keeper/cli
```

With that in place:

```bash
# Every declared keeper in the league, priced against the exact pick it consumes
npm run keeper-values -w @keeper/cli

# Ranked draft board straight from projection exports, no database needed
npm run board -w @keeper/cli -- <skill.csv> [defense.csv] --top=40

# Replay a scripted draft through the live tracker
npm run draft -w @keeper/cli

# Dashboard, reading the same league from the database
npm run dev -w @keeper/web
```

Quality gates:

```bash
npm run typecheck && npm run lint && npm test
```

## Deploying the dashboard

`vercel.json` builds only the web workspace and serves `apps/web/dist`. Import the
repository in Vercel and set three environment variables on the project:

| Variable                 | Value                                           |
| ------------------------ | ----------------------------------------------- |
| `VITE_SUPABASE_URL`      | the bare project URL, with no `/rest/v1` suffix |
| `VITE_SUPABASE_ANON_KEY` | the anon key                                    |
| `VITE_KEEPER_SEASON_ID`  | `season:<numeric league id>`                    |

Only these three. **Never set `SUPABASE_SERVICE_ROLE_KEY` on the Vercel project**: anything
prefixed `VITE_` is compiled into a file every visitor downloads, and the service role
bypasses row level security entirely. The anon key is published by design and RLS is what
protects the data.

Two things worth knowing before the first deploy:

- The build does not fail when these are missing. It succeeds and the page explains what is
  unset, which is more useful than a red build for a variable someone forgot.
- `VITE_KEEPER_SEASON_ID` contains the league id, so it is readable by anyone who loads the
  page. That is unavoidable for a hosted league dashboard; Vercel's deployment protection is
  the answer if the league would rather not be identifiable.

The data pipeline stays local. `catalog`, `sync` and `project` write to Supabase with the
service-role key from your machine, and the deployed page only ever reads.

## Design commitments

**Every number is explainable.** Valuations carry a component breakdown, the engine
version, and the projection version. A total that cannot be traced to its parts is a bug.

**Assumptions are stated, not buried.** Components that are not yet modelled return an
explicit zero with a label rather than a plausible-looking guess. Where the engine cannot
know something — whether a rival will trade, whether a player lasts until your pick — it
takes the probability as an input and says so.

**Incentive is not intent.** Market analysis reports that a manager has _reason_ to move a
player. It never claims they will.

**Unknowns fail loudly.** Ambiguous pick ownership, unresolvable keeper costs, stale API
data, and unmatched players surface as diagnostics instead of silently becoming zero.

## Known limitations

- Several Team Context Value components (future keeper option value, market liquidity,
  concentration risk, uncertainty) are labelled zeros awaiting simulation.
- Keeper entry probabilities are not modelled, so the pre-keeper board weights every
  player as available and says so on screen.
- Defence scoring omits the per-game yards-allowed ladder, which no season-total
  projection can supply; defence ordering is a takeaway-weighted proxy.
- The durable schema exists but nothing writes to it yet.
- Trade ROI, championship-roster construction, and draft simulation are unimplemented.

The specification this was built from lives in `Starting Docs/`.
