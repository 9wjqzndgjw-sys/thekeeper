# Sleeper API Plan

## API constraints

Sleeper documents its public API as read-only and unauthenticated. Its official documentation advises keeping usage below roughly 1,000 calls per minute to avoid IP blocking.

Official documentation: `https://docs.sleeper.com/`

The adapter should be read-only, rate-limited, cached, resilient to incomplete fields, and isolated from the domain model.

## Endpoint groups

Plan for:

- user and league discovery;
- specific league, users, and rosters;
- drafts for a league;
- draft metadata;
- draft picks;
- traded draft picks;
- transactions by week;
- previous-league chain;
- playoff brackets and standings where useful;
- player catalog and identity mapping.

Do not include copied JSON payloads in the project specification. Capture real payloads as versioned fixtures during implementation.

## Adapter responsibilities

1. fetch raw responses;
2. validate with runtime schemas;
3. persist raw snapshots;
4. transform to normalized domain objects;
5. report malformed or unknown fields;
6. preserve source timestamps;
7. replay from fixtures without network access.

## League continuity

Map seasonal Sleeper league IDs into one stable internal league identity by following the previous-league chain.

## Franchise mapping

Map `season + Sleeper roster ID` to a stable franchise identity and support manual correction.

## Draft ownership reconstruction

Reconstruct from base draft order, original ownership, traded-pick records, draft metadata, and actual selections. Store original and current owner.

## Keeper history

Use historical selections, keeper flags, exact picks, roster ownership, transactions, and manual rules. Provide manual overrides for gaps.

## Mock drafts

Support importing mock metadata, existing keeper selections, pre-draft/drafting/complete states, slot mapping validation, and empty traded-picks responses.

## Polling and freshness

The official documentation does not promise a real-time latency SLA. Design for polling, not guaranteed push events.

- configurable interval;
- start around 2–5 seconds during active drafting;
- slower refresh outside active drafting;
- display last successful sync;
- manual refresh;
- recover from missing or reordered responses.

At a 3-second interval, draft-pick polling uses about 20 requests per minute for one draft, well within the general documented guidance, but a limiter is still required.

## Schema validation

Use Zod or equivalent. Tolerate unknown fields, require only needed fields, log failures, retain raw payloads, and version mappers.

## Failure handling

Survive timeout, transient 5xx, malformed payload, duplicate picks, corrections, pauses, tab sleep, network loss, and API lag. Never erase the last known good state because one request failed.
