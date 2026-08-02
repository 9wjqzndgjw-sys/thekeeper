-- League rules, stored alongside the season they govern.
--
-- The engine needs a handful of numbers no other column carries -- how many players may be
-- kept, how fast a keeper's cost escalates, which round an undrafted keeper costs -- and
-- until now they existed only as constants compiled into the command line app. That made
-- the browser unable to answer questions the terminal could, and left two copies of the
-- league's policy to drift apart.
--
-- Stored as jsonb rather than columns because these are league policy rather than engine
-- structure: a league that adds a rule should not require a migration to describe it.
alter table league_seasons
  add column rules jsonb not null default '{}'::jsonb;

comment on column league_seasons.rules is
  'LeagueRules as the engine models them. Populated by the importer from Sleeper settings '
  'where Sleeper expresses the rule, and from recorded league policy where it does not.';
