-- Keep the browser on the normalized dashboard surface.
--
-- The dashboard is intentionally readable with the public anon key, but that does not make
-- operational source data or audit identities part of the product. RLS previously granted
-- anon every normalized and derived table plus `manual_overrides`, including commissioner
-- names, reasons, before/after values, Sleeper owner ids, and raw-snapshot references.

drop policy if exists "read overrides" on manual_overrides;
drop policy if exists "read league data" on draft_selections;
drop policy if exists "read league data" on transactions;
drop policy if exists "read league data" on trade_assets;
drop policy if exists "read league data" on valuation_runs;
drop policy if exists "read league data" on asset_valuations;

revoke select on table manual_overrides from anon, authenticated;
revoke select on table raw_api_snapshots from anon, authenticated;
revoke select on table draft_selections from anon, authenticated;
revoke select on table transactions from anon, authenticated;
revoke select on table trade_assets from anon, authenticated;
revoke select on table valuation_runs from anon, authenticated;
revoke select on table asset_valuations from anon, authenticated;

-- `franchise_seasons.sleeper_owner_id` is needed by the local importer, not by a visitor.
-- Revoke the table-wide grant before granting only the relationship columns used to load
-- dashboard franchises.
revoke select on table franchise_seasons from anon, authenticated;
grant select (season_id, franchise_id) on table franchise_seasons to anon, authenticated;

-- A corrected keeper cost belongs on the dashboard; the human-entered audit reason does
-- not. Full audit history remains available to the service role in `manual_overrides`.
revoke select on table keeper_rights from anon, authenticated;
grant select (
  id,
  season_id,
  franchise_id,
  player_id,
  source_type,
  nominal_round,
  prior_season_round,
  confidence
) on table keeper_rights to anon, authenticated;
