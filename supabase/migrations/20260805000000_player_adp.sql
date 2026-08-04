-- Average draft position, as the projection source reports it.
--
-- Kept beside the projection rather than derived from league history, because the two
-- answer different questions. The projection says what a player is worth; ADP says where
-- the wider market takes him, which is the only per-player read available for a rookie or
-- for anyone whose price moved over a season. League history supports positional timing,
-- not per-player draft position -- a 2021 pick says very little about 2026.
--
-- Nullable throughout: a defence export carries no ADP, and a player the source did not
-- rank has none either. An absent ADP is reported as absent rather than filled in, since a
-- guessed draft position reads exactly like a measured one.
alter table player_seasons add column if not exists adp numeric;

comment on column player_seasons.adp is
  'Average draft position from the projection source. Null where the source gave none.';
