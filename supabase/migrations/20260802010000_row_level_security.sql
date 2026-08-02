-- Row level security.
--
-- The anon key is shipped to the browser and is therefore public: anyone who loads the
-- dashboard has it. With RLS disabled that key can read and write every table, so the
-- rule here is simple -- anon and authenticated may read, and nothing else. No write
-- policy exists for them, and with RLS on, an operation without a matching policy is
-- denied by default.
--
-- Writes come from the CLI using the service role, which bypasses RLS entirely and must
-- stay server-side.

alter table leagues              enable row level security;
alter table league_seasons       enable row level security;
alter table franchises           enable row level security;
alter table franchise_seasons    enable row level security;
alter table players              enable row level security;
alter table player_seasons       enable row level security;
alter table draft_pick_assets    enable row level security;
alter table draft_selections     enable row level security;
alter table keeper_rights        enable row level security;
alter table keeper_decisions     enable row level security;
alter table transactions         enable row level security;
alter table trade_assets         enable row level security;
alter table valuation_runs       enable row level security;
alter table asset_valuations     enable row level security;
alter table manual_overrides     enable row level security;
alter table raw_api_snapshots    enable row level security;

-- League data the dashboard renders.
create policy "read league data" on leagues           for select to anon, authenticated using (true);
create policy "read league data" on league_seasons    for select to anon, authenticated using (true);
create policy "read league data" on franchises        for select to anon, authenticated using (true);
create policy "read league data" on franchise_seasons for select to anon, authenticated using (true);
create policy "read league data" on players           for select to anon, authenticated using (true);
create policy "read league data" on player_seasons    for select to anon, authenticated using (true);
create policy "read league data" on draft_pick_assets for select to anon, authenticated using (true);
create policy "read league data" on draft_selections  for select to anon, authenticated using (true);
create policy "read league data" on keeper_rights     for select to anon, authenticated using (true);
create policy "read league data" on keeper_decisions  for select to anon, authenticated using (true);
create policy "read league data" on transactions      for select to anon, authenticated using (true);
create policy "read league data" on trade_assets      for select to anon, authenticated using (true);
create policy "read league data" on valuation_runs    for select to anon, authenticated using (true);
create policy "read league data" on asset_valuations  for select to anon, authenticated using (true);

-- Overrides are readable so the UI can show why a value was corrected, and by whom.
create policy "read overrides" on manual_overrides for select to anon, authenticated using (true);

-- Raw payloads stay server-side. They are large, they are only useful for replay and
-- debugging, and there is no reason to hand them to a browser.
-- No policy is created here, so anon and authenticated read nothing from this table.

-- Views run with the privileges of their owner by default, which would read straight
-- past the policies above. Making them security_invoker means the caller's own
-- permissions apply, so a view cannot become a hole around RLS.
alter view current_pick_inventory set (security_invoker = on);
alter view keeper_decision_detail set (security_invoker = on);
