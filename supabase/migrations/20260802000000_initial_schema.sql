-- Keeper league intelligence engine: durable schema.
--
-- Three layers are kept apart on purpose, per the data model doc: raw API snapshots
-- exactly as fetched, normalized league data, and derived valuations. Raw payloads are
-- never mutated, so a mapper change can be replayed against what the API actually said.
--
-- Several rules the engine states as invariants are enforced here rather than only in
-- code, because a constraint cannot be bypassed by a new caller: one player is kept by at
-- most one franchise per season, a pick asset is consumed at most once, and a draft
-- selection owns its overall pick outright.

-- ---------------------------------------------------------------------------
-- Raw API snapshots: append-only, never rewritten
-- ---------------------------------------------------------------------------

create table raw_api_snapshots (
  id             bigserial   primary key,
  mapper_version text        not null,
  endpoint       text        not null,
  url            text        not null,
  fetched_at     timestamptz not null,
  payload        jsonb       not null,
  created_at     timestamptz not null default now()
);

create index raw_api_snapshots_endpoint_idx on raw_api_snapshots (endpoint, fetched_at desc);

-- ---------------------------------------------------------------------------
-- League identity and seasons
-- ---------------------------------------------------------------------------

create table leagues (
  id            text primary key,
  name          text        not null,
  rules_version text        not null,
  created_at    timestamptz not null default now()
);

create table league_seasons (
  id                         text primary key,
  league_id                  text        not null references leagues (id) on delete cascade,
  season_year                int         not null,
  sleeper_league_id          text        not null unique,
  previous_sleeper_league_id text,
  status                     text        not null
    check (status in ('pre_draft', 'drafting', 'in_season', 'complete')),
  sleeper_draft_id           text,
  keeper_deadline            timestamptz,
  draft_time                 timestamptz,
  team_count                 int         not null check (team_count > 0),
  draft_rounds               int         not null check (draft_rounds > 0),
  -- Kept as sent by Sleeper. The payload carries ~50 scoring keys including full
  -- defensive ladders, and a hand-picked subset silently drops the rest.
  scoring_settings           jsonb       not null default '{}'::jsonb,
  lineup                     jsonb       not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  unique (league_id, season_year)
);

-- ---------------------------------------------------------------------------
-- Franchises
-- ---------------------------------------------------------------------------

-- Franchise ids are league-scoped. An id derived only from a Sleeper user would collide
-- across leagues, and one derived from a roster id would collide across seasons too.
create table franchises (
  id           text primary key,
  league_id    text        not null references leagues (id) on delete cascade,
  display_name text        not null,
  created_at   timestamptz not null default now()
);

create table franchise_seasons (
  season_id            text not null references league_seasons (id) on delete cascade,
  franchise_id         text not null references franchises (id) on delete cascade,
  sleeper_roster_id    int  not null,
  sleeper_owner_id     text,
  identity_source      text not null
    check (identity_source in ('owner', 'roster_fallback', 'manual_override')),
  wins                 int  not null default 0,
  losses               int  not null default 0,
  ties                 int  not null default 0,
  playoff_result       text,
  primary key (season_id, franchise_id),
  -- One franchise per Sleeper roster in a season, and vice versa.
  unique (season_id, sleeper_roster_id)
);

-- ---------------------------------------------------------------------------
-- Players and projections
-- ---------------------------------------------------------------------------

create table players (
  id                text primary key,
  full_name         text not null,
  position          text not null check (position in ('QB', 'RB', 'WR', 'TE', 'DEF')),
  sleeper_player_id text unique
);

create table player_seasons (
  season_id         text not null references league_seasons (id) on delete cascade,
  player_id         text not null references players (id) on delete cascade,
  nfl_team          text,
  age               int,
  -- Scored under this league's own settings, never the projection source's totals.
  projected_points  numeric,
  actual_points     numeric,
  projection_source text,
  primary key (season_id, player_id)
);

-- ---------------------------------------------------------------------------
-- Draft picks
-- ---------------------------------------------------------------------------

create table draft_pick_assets (
  id                     text primary key,
  season_id              text not null references league_seasons (id) on delete cascade,
  round                  int  not null check (round >= 1),
  slot                   int  check (slot >= 1),
  overall_pick           int  check (overall_pick >= 1),
  original_franchise_id  text not null references franchises (id),
  current_franchise_id   text not null references franchises (id),
  ownership_confidence   text not null
    check (ownership_confidence in ('confirmed', 'inferred', 'disputed')),
  -- A season cannot contain two picks at the same coordinates.
  unique (season_id, round, slot),
  unique (season_id, overall_pick)
);

create index draft_pick_assets_current_owner_idx
  on draft_pick_assets (season_id, current_franchise_id);

create table draft_selections (
  sleeper_draft_id text        not null,
  season_id        text        not null references league_seasons (id) on delete cascade,
  overall_pick     int         not null check (overall_pick >= 1),
  round            int         not null check (round >= 1),
  slot             int,
  franchise_id     text        references franchises (id),
  player_id        text        references players (id),
  is_keeper        boolean     not null default false,
  source           text        not null default 'sleeper' check (source in ('sleeper', 'manual')),
  recorded_at      timestamptz not null default now(),
  -- Selections are keyed by draft and overall pick, which is what makes reconciliation
  -- idempotent: replaying a payload updates in place instead of appending a duplicate.
  primary key (sleeper_draft_id, overall_pick)
);

-- ---------------------------------------------------------------------------
-- Keeper rights and decisions
-- ---------------------------------------------------------------------------

-- A right is eligibility: this player could be kept, at this cost.
create table keeper_rights (
  id                     text not null primary key,
  season_id              text not null references league_seasons (id) on delete cascade,
  franchise_id           text not null references franchises (id),
  player_id              text not null references players (id),
  source_type            text not null
    check (source_type in ('drafted', 'kept', 'undrafted_free_agent', 'traded', 'manual_override')),
  nominal_round          int  not null check (nominal_round >= 1),
  prior_season_round     int  check (prior_season_round >= 1),
  confidence             text not null
    check (confidence in ('confirmed', 'inferred', 'disputed')),
  manual_override_reason text,
  unique (season_id, franchise_id, player_id)
);

-- A decision is what a manager actually declared, which is a different thing.
create table keeper_decisions (
  season_id             text        not null references league_seasons (id) on delete cascade,
  franchise_id          text        not null references franchises (id),
  player_id             text        not null references players (id),
  keeper_right_id       text        references keeper_rights (id),
  resolved_pick_asset_id text       references draft_pick_assets (id),
  source                text        not null check (source in ('sleeper', 'manual')),
  declared_at           timestamptz,
  recorded_at           timestamptz not null default now(),
  -- Invariant: a player is kept by at most one franchise in a season. Enforced here
  -- because the optimizer only checks within a single franchise's own combination.
  primary key (season_id, player_id),
  -- Invariant: a pick asset is consumed at most once.
  unique (season_id, resolved_pick_asset_id)
);

create index keeper_decisions_franchise_idx on keeper_decisions (season_id, franchise_id);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

create table transactions (
  id                     text        primary key,
  season_id              text        not null references league_seasons (id) on delete cascade,
  type                   text        not null,
  status                 text        not null,
  occurred_at            timestamptz,
  raw_api_snapshot_id    bigint      references raw_api_snapshots (id),
  created_at             timestamptz not null default now()
);

create table trade_assets (
  id                   bigserial primary key,
  transaction_id       text not null references transactions (id) on delete cascade,
  from_franchise_id    text references franchises (id),
  to_franchise_id      text references franchises (id),
  player_id            text references players (id),
  pick_asset_id        text references draft_pick_assets (id),
  -- A movement is a player or a pick, never neither.
  check (player_id is not null or pick_asset_id is not null)
);

-- ---------------------------------------------------------------------------
-- Manual overrides: every correction carries who, when, and why
-- ---------------------------------------------------------------------------

create table manual_overrides (
  id             bigserial   primary key,
  scope          text        not null check (scope in (
                   'franchise_identity',
                   'pick_ownership',
                   'keeper_cost',
                   'keeper_decision',
                   'draft_order',
                   'commissioner_ruling'
                 )),
  season_id      text        references league_seasons (id) on delete cascade,
  target_key     text        not null,
  prior_value    jsonb,
  new_value      jsonb       not null,
  -- An override without a stated reason and author is not auditable, so the schema
  -- refuses one rather than trusting every caller to remember.
  reason         text        not null check (length(btrim(reason)) > 0),
  overridden_by  text        not null check (length(btrim(overridden_by)) > 0),
  overridden_at  timestamptz not null,
  created_at     timestamptz not null default now()
);

create index manual_overrides_scope_idx on manual_overrides (scope, season_id);

-- ---------------------------------------------------------------------------
-- Derived valuations, versioned so any number can be traced to the run that made it
-- ---------------------------------------------------------------------------

create table valuation_runs (
  id                 text        primary key,
  season_id          text        not null references league_seasons (id) on delete cascade,
  engine_version     text        not null,
  projection_version text        not null,
  rules_version      text        not null,
  evaluated_at       timestamptz not null,
  assumptions        jsonb       not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create table asset_valuations (
  id                   bigserial primary key,
  run_id               text      not null references valuation_runs (id) on delete cascade,
  franchise_id         text      references franchises (id),
  player_id            text      references players (id),
  pick_asset_id        text      references draft_pick_assets (id),
  intrinsic_value      numeric,
  keeper_surplus_value numeric,
  team_context_value   numeric,
  components           jsonb     not null default '{}'::jsonb,
  uncertainty_low      numeric,
  uncertainty_high     numeric,
  explanation          text,
  check (player_id is not null or pick_asset_id is not null)
);

create index asset_valuations_run_idx on asset_valuations (run_id, franchise_id);

-- ---------------------------------------------------------------------------
-- Derived views
-- ---------------------------------------------------------------------------

-- What each franchise actually holds right now, after trades.
create view current_pick_inventory as
select
  a.season_id,
  a.current_franchise_id as franchise_id,
  f.display_name,
  a.round,
  a.slot,
  a.overall_pick,
  a.original_franchise_id,
  a.ownership_confidence,
  a.original_franchise_id <> a.current_franchise_id as acquired_by_trade
from draft_pick_assets a
join franchises f on f.id = a.current_franchise_id;

-- Declared keepers with what they cost and which exact pick they consume.
create view keeper_decision_detail as
select
  d.season_id,
  d.franchise_id,
  f.display_name,
  p.full_name,
  p.position,
  r.nominal_round,
  r.prior_season_round,
  r.source_type,
  a.round        as resolved_round,
  a.overall_pick as resolved_overall_pick,
  d.source,
  d.declared_at
from keeper_decisions d
join franchises f on f.id = d.franchise_id
join players p on p.id = d.player_id
left join keeper_rights r on r.id = d.keeper_right_id
left join draft_pick_assets a on a.id = d.resolved_pick_asset_id;
