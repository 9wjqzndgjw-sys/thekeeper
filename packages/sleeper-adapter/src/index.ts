import { z } from 'zod';
import type { Player, PlayerId } from '@keeper/domain';

export const SLEEPER_MAPPER_VERSION = '1';

export interface SleeperAdapterConfig {
  baseUrl: string;
  requestsPerMinuteLimit: number;
  timeoutMs: number;
  retryCount: number;
  retryBaseDelayMs: number;
  /** Fallback cache lifetime for endpoints without their own entry. Set to 0 to disable caching entirely, including per-endpoint defaults. */
  cacheTtlMs: number;
  cacheTtlMsByEndpoint: Partial<Record<SleeperEndpoint, number>>;
  /** Maximum cached URLs retained. Least-recently-used entries are evicted beyond this. */
  maxCacheEntries: number;
  fetch: SleeperFetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  snapshotSink: SleeperRawSnapshotSink | null;
}

export type CreateSleeperAdapterConfig = Partial<SleeperAdapterConfig>;

export interface SleeperFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export type SleeperFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<SleeperFetchResponse>;

export interface SleeperDiagnostic {
  level: 'warning' | 'error';
  endpoint: SleeperEndpoint;
  message: string;
  path?: string;
}

export interface SleeperRawSnapshot {
  mapperVersion: string;
  endpoint: SleeperEndpoint;
  url: string;
  fetchedAt: string;
  raw: unknown;
}

export type SleeperRawSnapshotSink = (snapshot: SleeperRawSnapshot) => void | Promise<void>;

export function createSleeperFixtureFetch(fixtures: readonly SleeperRawSnapshot[]): SleeperFetch {
  const remainingByUrl = new Map<string, SleeperRawSnapshot[]>();

  for (const fixture of fixtures) {
    if (fixture.mapperVersion !== SLEEPER_MAPPER_VERSION) {
      throw new Error(
        `Sleeper fixture mapper version ${fixture.mapperVersion} cannot be replayed by mapper version ${SLEEPER_MAPPER_VERSION}.`,
      );
    }
    const remaining = remainingByUrl.get(fixture.url) ?? [];
    remaining.push(fixture);
    remainingByUrl.set(fixture.url, remaining);
  }

  return async (url, init) => {
    if (init?.signal?.aborted) {
      throw new Error(`Sleeper fixture request was aborted: ${url}`);
    }

    const remaining = remainingByUrl.get(url);
    const fixture = remaining?.shift();
    if (!fixture) {
      throw new Error(`No Sleeper fixture queued for ${url}.`);
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => structuredClone(fixture.raw),
    };
  };
}

/**
 * `miss` fetched fresh, `hit` served from a live cache entry, `stale` served from an
 * expired entry because the refresh failed. Pair `stale` with `snapshot.fetchedAt` to
 * decide whether the data is too old to act on.
 */
export type SleeperCacheStatus = 'miss' | 'hit' | 'stale';

export interface SleeperAdapterResponse<T> {
  data: T;
  snapshot: SleeperRawSnapshot;
  diagnostics: SleeperDiagnostic[];
  cache: SleeperCacheStatus;
}

export type SleeperEndpoint =
  | 'user'
  | 'user_leagues'
  | 'league'
  | 'league_rosters'
  | 'league_users'
  | 'league_drafts'
  | 'league_transactions'
  | 'league_traded_picks'
  | 'draft'
  | 'draft_picks'
  | 'draft_traded_picks'
  | 'players';

export interface NormalizedSleeperUser {
  sleeperUserId: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  metadata: Record<string, unknown>;
  isCommissioner: boolean | null;
}

export interface NormalizedSleeperLeague {
  sleeperLeagueId: string;
  name: string;
  season: string;
  previousSleeperLeagueId: string | null;
  draftId: string | null;
  status: SleeperLeagueStatus;
  totalRosters: number;
  rosterPositions: string[];
  settings: Record<string, unknown>;
  scoringSettings: Record<string, unknown>;
  avatar: string | null;
}

export type SleeperLeagueStatus = 'pre_draft' | 'drafting' | 'in_season' | 'complete';

export interface NormalizedSleeperRoster {
  sleeperLeagueId: string;
  rosterId: number;
  ownerSleeperUserId: string | null;
  playerSleeperIds: string[];
  starterSleeperIds: string[];
  reserveSleeperIds: string[];
  wins: number;
  losses: number;
  ties: number;
  settings: Record<string, unknown>;
}

export interface NormalizedSleeperDraft {
  sleeperDraftId: string;
  sleeperLeagueId: string | null;
  type: SleeperDraftType;
  status: SleeperDraftStatus;
  season: string | null;
  rounds: number | null;
  teamCount: number | null;
  startTime: number | null;
  draftOrder: Record<string, number>;
  slotToRosterId: Record<number, number>;
  metadata: Record<string, unknown>;
}

export type SleeperDraftType = 'snake' | 'linear' | 'auction' | 'unknown';
export type SleeperDraftStatus = 'pre_draft' | 'drafting' | 'complete' | 'unknown';

export interface NormalizedSleeperDraftPick {
  sleeperDraftId: string;
  pickNo: number;
  round: number;
  draftSlot: number | null;
  rosterId: number | null;
  sleeperPlayerId: string | null;
  pickedBySleeperUserId: string | null;
  isKeeper: boolean;
  metadata: Record<string, unknown>;
}

export interface NormalizedSleeperTradedPick {
  season: string;
  round: number;
  originalRosterId: number;
  previousOwnerRosterId: number;
  currentOwnerRosterId: number;
}

export interface NormalizedSleeperTransaction {
  sleeperTransactionId: string;
  type: string;
  status: string;
  rosterIds: number[];
  adds: Record<string, number>;
  drops: Record<string, number>;
  draftPicks: NormalizedSleeperTradedPick[];
  createdAt: number | null;
  statusUpdatedAt: number | null;
}

export interface NormalizedSleeperPlayerCatalog {
  players: Player[];
  skippedSleeperPlayerIds: string[];
}

export interface SleeperAdapter {
  getUser(userIdOrUsername: string): Promise<SleeperAdapterResponse<NormalizedSleeperUser>>;
  getLeaguesForUser(
    userId: string,
    sport: string,
    season: string,
  ): Promise<SleeperAdapterResponse<NormalizedSleeperLeague[]>>;
  getLeague(leagueId: string): Promise<SleeperAdapterResponse<NormalizedSleeperLeague>>;
  getLeagueRosters(leagueId: string): Promise<SleeperAdapterResponse<NormalizedSleeperRoster[]>>;
  getLeagueUsers(leagueId: string): Promise<SleeperAdapterResponse<NormalizedSleeperUser[]>>;
  getLeagueDrafts(leagueId: string): Promise<SleeperAdapterResponse<NormalizedSleeperDraft[]>>;
  getLeagueTransactions(
    leagueId: string,
    week: number,
  ): Promise<SleeperAdapterResponse<NormalizedSleeperTransaction[]>>;
  getLeagueTradedPicks(
    leagueId: string,
  ): Promise<SleeperAdapterResponse<NormalizedSleeperTradedPick[]>>;
  getDraft(draftId: string): Promise<SleeperAdapterResponse<NormalizedSleeperDraft>>;
  getDraftPicks(draftId: string): Promise<SleeperAdapterResponse<NormalizedSleeperDraftPick[]>>;
  getDraftTradedPicks(
    draftId: string,
  ): Promise<SleeperAdapterResponse<NormalizedSleeperTradedPick[]>>;
  getPlayers(
    sport: string,
    query?: { position?: string; active?: boolean },
  ): Promise<SleeperAdapterResponse<NormalizedSleeperPlayerCatalog>>;
}

export const DEFAULT_SLEEPER_ADAPTER_CONFIG: SleeperAdapterConfig = {
  baseUrl: 'https://api.sleeper.app/v1',
  requestsPerMinuteLimit: 1000,
  timeoutMs: 10_000,
  retryCount: 2,
  retryBaseDelayMs: 250,
  cacheTtlMs: 5_000,
  cacheTtlMsByEndpoint: {
    draft_picks: 2_000,
    players: 24 * 60 * 60 * 1_000,
  },
  maxCacheEntries: 256,
  fetch: defaultFetch,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  snapshotSink: null,
};

const stringRecordSchema = z.record(z.string(), z.unknown());
const nullableStringArraySchema = z.array(z.string()).nullable().optional();
const rosterIdSchema = z
  .union([z.number().int(), z.string().regex(/^\d+$/).transform(Number)])
  .nullable()
  .optional();

const sleeperUserSchema = z.object({
  user_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  metadata: stringRecordSchema.nullable().optional(),
  is_owner: z.boolean().nullable().optional(),
});

const sleeperLeagueSchema = z.object({
  total_rosters: z.number().int(),
  status: z.enum(['pre_draft', 'drafting', 'in_season', 'complete']),
  settings: stringRecordSchema,
  scoring_settings: stringRecordSchema,
  roster_positions: z.array(z.string()),
  previous_league_id: z.string().nullable().optional(),
  name: z.string(),
  league_id: z.string(),
  draft_id: z.string().nullable().optional(),
  avatar: z.string().nullable().optional(),
  season: z.string(),
});

const sleeperRosterSchema = z.object({
  roster_id: z.number().int(),
  league_id: z.string(),
  owner_id: z.string().nullable().optional(),
  players: nullableStringArraySchema,
  starters: nullableStringArraySchema,
  reserve: nullableStringArraySchema,
  settings: stringRecordSchema.optional(),
});

const sleeperDraftSchema = z.object({
  draft_id: z.string(),
  league_id: z.string().nullable().optional(),
  type: z.string(),
  status: z.string(),
  season: z.string().nullable().optional(),
  start_time: z.number().nullable().optional(),
  settings: stringRecordSchema.optional(),
  draft_order: z.record(z.string(), z.number()).nullable().optional(),
  slot_to_roster_id: z.record(z.string(), z.number()).nullable().optional(),
  metadata: stringRecordSchema.nullable().optional(),
});

const sleeperDraftPickSchema = z.object({
  draft_id: z.string(),
  pick_no: z.number().int(),
  round: z.number().int(),
  draft_slot: z.number().int().nullable().optional(),
  roster_id: rosterIdSchema,
  player_id: z.string().nullable().optional(),
  picked_by: z.string().nullable().optional(),
  is_keeper: z.boolean().nullable().optional(),
  metadata: stringRecordSchema.nullable().optional(),
});

const sleeperTradedPickSchema = z.object({
  season: z.string(),
  round: z.number().int(),
  roster_id: z.number().int(),
  previous_owner_id: z.number().int(),
  owner_id: z.number().int(),
});

const sleeperTransactionSchema = z.object({
  transaction_id: z.string(),
  type: z.string(),
  status: z.string(),
  roster_ids: z.array(z.number().int()).nullable().optional(),
  adds: z.record(z.string(), z.number().int()).nullable().optional(),
  drops: z.record(z.string(), z.number().int()).nullable().optional(),
  draft_picks: z.array(sleeperTradedPickSchema).nullable().optional(),
  created: z.number().nullable().optional(),
  status_updated: z.number().nullable().optional(),
});

const sleeperPlayerSchema = z.object({
  player_id: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  full_name: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
});

const sleeperPlayerCatalogSchema = z.record(z.string(), sleeperPlayerSchema);

type UnknownFieldShape =
  | {
      kind: 'object';
      keys: ReadonlySet<string>;
      children: Readonly<Record<string, UnknownFieldShape>>;
    }
  | { kind: 'array'; item: UnknownFieldShape }
  | { kind: 'record'; value: UnknownFieldShape };

function objectFieldShape(
  schema: z.ZodObject<z.ZodRawShape>,
  children: Readonly<Record<string, UnknownFieldShape>> = {},
): UnknownFieldShape {
  return { kind: 'object', keys: new Set(Object.keys(schema.shape)), children };
}

function arrayFieldShape(item: UnknownFieldShape): UnknownFieldShape {
  return { kind: 'array', item };
}

function recordFieldShape(value: UnknownFieldShape): UnknownFieldShape {
  return { kind: 'record', value };
}

const userFieldShape = objectFieldShape(sleeperUserSchema);
const leagueFieldShape = objectFieldShape(sleeperLeagueSchema);
const rosterFieldShape = objectFieldShape(sleeperRosterSchema);
const draftFieldShape = objectFieldShape(sleeperDraftSchema);
const draftPickFieldShape = objectFieldShape(sleeperDraftPickSchema);
const tradedPickFieldShape = objectFieldShape(sleeperTradedPickSchema);
const transactionFieldShape = objectFieldShape(sleeperTransactionSchema, {
  draft_picks: arrayFieldShape(tradedPickFieldShape),
});
const playerFieldShape = objectFieldShape(sleeperPlayerSchema);

export function createSleeperAdapter(config: CreateSleeperAdapterConfig = {}): SleeperAdapter {
  const resolvedConfig = normalizeConfig(config);
  const client = new SleeperHttpClient(resolvedConfig);

  return {
    getUser(userIdOrUsername) {
      return client.fetchNormalized({
        endpoint: 'user',
        path: `/user/${encodeURIComponent(userIdOrUsername)}`,
        schema: sleeperUserSchema,
        fieldShape: userFieldShape,
        normalize: normalizeUser,
      });
    },
    getLeaguesForUser(userId, sport, season) {
      return client.fetchNormalized({
        endpoint: 'user_leagues',
        path: `/user/${encodeURIComponent(userId)}/leagues/${encodeURIComponent(sport)}/${encodeURIComponent(
          season,
        )}`,
        schema: z.array(sleeperLeagueSchema),
        fieldShape: arrayFieldShape(leagueFieldShape),
        normalize: (leagues) => leagues.map(normalizeLeague),
      });
    },
    getLeague(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league',
        path: `/league/${encodeURIComponent(leagueId)}`,
        schema: sleeperLeagueSchema,
        fieldShape: leagueFieldShape,
        normalize: normalizeLeague,
      });
    },
    getLeagueRosters(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league_rosters',
        path: `/league/${encodeURIComponent(leagueId)}/rosters`,
        schema: z.array(sleeperRosterSchema),
        fieldShape: arrayFieldShape(rosterFieldShape),
        normalize: (rosters) => rosters.map(normalizeRoster),
      });
    },
    getLeagueUsers(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league_users',
        path: `/league/${encodeURIComponent(leagueId)}/users`,
        schema: z.array(sleeperUserSchema),
        fieldShape: arrayFieldShape(userFieldShape),
        normalize: (users) => users.map(normalizeUser),
      });
    },
    getLeagueDrafts(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league_drafts',
        path: `/league/${encodeURIComponent(leagueId)}/drafts`,
        schema: z.array(sleeperDraftSchema),
        fieldShape: arrayFieldShape(draftFieldShape),
        normalize: (drafts) => drafts.map(normalizeDraft),
      });
    },
    getLeagueTransactions(leagueId, week) {
      return client.fetchNormalized({
        endpoint: 'league_transactions',
        path: `/league/${encodeURIComponent(leagueId)}/transactions/${week}`,
        schema: z.array(sleeperTransactionSchema),
        fieldShape: arrayFieldShape(transactionFieldShape),
        normalize: (transactions) => transactions.map(normalizeTransaction),
      });
    },
    getLeagueTradedPicks(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league_traded_picks',
        path: `/league/${encodeURIComponent(leagueId)}/traded_picks`,
        schema: z.array(sleeperTradedPickSchema),
        fieldShape: arrayFieldShape(tradedPickFieldShape),
        normalize: (tradedPicks) => tradedPicks.map(normalizeTradedPick),
      });
    },
    getDraft(draftId) {
      return client.fetchNormalized({
        endpoint: 'draft',
        path: `/draft/${encodeURIComponent(draftId)}`,
        schema: sleeperDraftSchema,
        fieldShape: draftFieldShape,
        normalize: normalizeDraft,
      });
    },
    getDraftPicks(draftId) {
      return client.fetchNormalized({
        endpoint: 'draft_picks',
        path: `/draft/${encodeURIComponent(draftId)}/picks`,
        schema: z.array(sleeperDraftPickSchema),
        fieldShape: arrayFieldShape(draftPickFieldShape),
        normalize: (picks) => picks.map(normalizeDraftPick),
      });
    },
    getDraftTradedPicks(draftId) {
      return client.fetchNormalized({
        endpoint: 'draft_traded_picks',
        path: `/draft/${encodeURIComponent(draftId)}/traded_picks`,
        schema: z.array(sleeperTradedPickSchema),
        fieldShape: arrayFieldShape(tradedPickFieldShape),
        normalize: (tradedPicks) => tradedPicks.map(normalizeTradedPick),
      });
    },
    getPlayers(sport, query) {
      const queryParams = new URLSearchParams();
      if (query?.position) {
        queryParams.set('position', query.position);
      }
      if (query?.active) {
        queryParams.set('active', 'true');
      }
      const suffix = queryParams.size > 0 ? `?${queryParams.toString()}` : '';
      return client.fetchNormalized({
        endpoint: 'players',
        path: `/players/${encodeURIComponent(sport)}${suffix}`,
        schema: sleeperPlayerCatalogSchema,
        fieldShape: recordFieldShape(playerFieldShape),
        normalize: normalizePlayerCatalog,
      });
    },
  };
}

interface SleeperCacheEntry {
  expiresAt: number;
  data: unknown;
  snapshot: SleeperRawSnapshot;
  diagnostics: readonly SleeperDiagnostic[];
}

class SleeperHttpClient {
  private lastRequestAt: number | null = null;
  private rateLimitQueue: Promise<void> = Promise.resolve();
  private readonly cache = new Map<string, SleeperCacheEntry>();

  constructor(private readonly config: SleeperAdapterConfig) {}

  async fetchNormalized<TParsed, TNormalized>(input: {
    endpoint: SleeperEndpoint;
    path: string;
    schema: z.ZodType<TParsed>;
    fieldShape: UnknownFieldShape;
    normalize: (parsed: TParsed) => TNormalized;
  }): Promise<SleeperAdapterResponse<TNormalized>> {
    const url = buildUrl(this.config.baseUrl, input.path);

    const cached = this.readFreshCache(url);
    if (cached) {
      return {
        data: cached.data as TNormalized,
        snapshot: cached.snapshot,
        diagnostics: [...cached.diagnostics],
        cache: 'hit',
      };
    }

    let raw: unknown;
    try {
      raw = await this.fetchJsonWithPolicy(url);
    } catch (error) {
      return this.serveStaleOrThrow(url, input.endpoint, error);
    }

    const fetchedAt = new Date(this.config.now()).toISOString();
    const snapshot: SleeperRawSnapshot = {
      mapperVersion: SLEEPER_MAPPER_VERSION,
      endpoint: input.endpoint,
      url,
      fetchedAt,
      raw,
    };
    await this.config.snapshotSink?.(snapshot);

    const diagnostics = collectUnknownKeyDiagnostics(input.endpoint, raw, input.fieldShape);
    const parsed = input.schema.safeParse(raw);
    if (!parsed.success) {
      return this.serveStaleOrThrow(
        url,
        input.endpoint,
        new SleeperValidationError(input.endpoint, parsed.error, diagnostics),
      );
    }

    // Frozen whether or not it is cached, so a caller cannot mutate shared state on a
    // later cache hit and cannot observe different mutability between miss and hit.
    const data = deepFreeze(input.normalize(parsed.data));
    deepFreeze(snapshot);
    this.writeCache(url, input.endpoint, { data, snapshot, diagnostics });

    return { data, snapshot, diagnostics: [...diagnostics], cache: 'miss' };
  }

  private readFreshCache(url: string): SleeperCacheEntry | null {
    const entry = this.cache.get(url);
    if (!entry || entry.expiresAt <= this.config.now()) {
      return null;
    }

    // Re-insert so Map iteration order tracks recency for LRU eviction.
    this.cache.delete(url);
    this.cache.set(url, entry);
    return entry;
  }

  private writeCache(
    url: string,
    endpoint: SleeperEndpoint,
    entry: Omit<SleeperCacheEntry, 'expiresAt'>,
  ): void {
    const cacheTtlMs = this.cacheTtlMsFor(endpoint);
    if (cacheTtlMs <= 0) {
      this.cache.delete(url);
      return;
    }

    this.cache.delete(url);
    this.cache.set(url, { ...entry, expiresAt: this.config.now() + cacheTtlMs });

    while (this.cache.size > this.config.maxCacheEntries) {
      const oldest = this.cache.keys().next();
      if (oldest.done) {
        break;
      }
      this.cache.delete(oldest.value);
    }
  }

  private cacheTtlMsFor(endpoint: SleeperEndpoint): number {
    return this.config.cacheTtlMsByEndpoint[endpoint] ?? this.config.cacheTtlMs;
  }

  private serveStaleOrThrow<TNormalized>(
    url: string,
    endpoint: SleeperEndpoint,
    error: unknown,
  ): SleeperAdapterResponse<TNormalized> {
    const stale = this.cache.get(url);
    if (!stale || !canServeStaleFor(error)) {
      throw error;
    }

    return {
      data: stale.data as TNormalized,
      snapshot: stale.snapshot,
      diagnostics: [
        ...stale.diagnostics,
        {
          level: 'warning',
          endpoint,
          message: `Sleeper refresh failed; serving stale cached data. ${errorMessage(error)}`,
        },
      ],
      cache: 'stale',
    };
  }

  private async fetchJsonWithPolicy(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      await this.waitForRateLimit();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      try {
        const response = await this.config.fetch(url, { signal: controller.signal });
        if (!response.ok) {
          if (shouldRetryStatus(response.status) && attempt < this.config.retryCount) {
            await this.config.sleep(this.retryDelay(attempt));
            continue;
          }
          throw new SleeperHttpError(url, response.status, response.statusText);
        }
        return await response.json();
      } catch (error) {
        if (error instanceof SleeperHttpError || attempt >= this.config.retryCount) {
          throw error;
        }
        await this.config.sleep(this.retryDelay(attempt));
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private waitForRateLimit(): Promise<void> {
    const reservation = this.rateLimitQueue.then(async () => {
      const now = this.config.now();
      if (this.lastRequestAt !== null) {
        const minimumIntervalMs = Math.ceil(60_000 / this.config.requestsPerMinuteLimit);
        const elapsed = now - this.lastRequestAt;
        if (elapsed < minimumIntervalMs) {
          await this.config.sleep(minimumIntervalMs - elapsed);
        }
      }

      this.lastRequestAt = this.config.now();
    });

    this.rateLimitQueue = reservation.catch(() => undefined);
    return reservation;
  }

  private retryDelay(attempt: number): number {
    return this.config.retryBaseDelayMs * 2 ** attempt;
  }
}

export class SleeperHttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly statusText: string,
  ) {
    super(`Sleeper request failed with ${status} ${statusText}: ${url}`);
  }
}

export class SleeperValidationError extends Error {
  constructor(
    public readonly endpoint: SleeperEndpoint,
    public readonly zodError: z.ZodError,
    public readonly diagnostics: SleeperDiagnostic[],
  ) {
    super(`Sleeper ${endpoint} response failed schema validation: ${zodError.message}`);
  }
}

type SleeperUser = z.infer<typeof sleeperUserSchema>;
type SleeperLeague = z.infer<typeof sleeperLeagueSchema>;
type SleeperRoster = z.infer<typeof sleeperRosterSchema>;
type SleeperDraft = z.infer<typeof sleeperDraftSchema>;
type SleeperDraftPick = z.infer<typeof sleeperDraftPickSchema>;
type SleeperTradedPick = z.infer<typeof sleeperTradedPickSchema>;
type SleeperTransaction = z.infer<typeof sleeperTransactionSchema>;
type SleeperPlayerCatalog = z.infer<typeof sleeperPlayerCatalogSchema>;

function normalizeUser(user: SleeperUser): NormalizedSleeperUser {
  return {
    sleeperUserId: user.user_id,
    username: user.username ?? null,
    displayName: user.display_name ?? null,
    avatar: user.avatar ?? null,
    metadata: user.metadata ?? {},
    isCommissioner: user.is_owner ?? null,
  };
}

function normalizeLeague(league: SleeperLeague): NormalizedSleeperLeague {
  return {
    sleeperLeagueId: league.league_id,
    name: league.name,
    season: league.season,
    previousSleeperLeagueId: league.previous_league_id ?? null,
    draftId: league.draft_id ?? null,
    status: league.status,
    totalRosters: league.total_rosters,
    rosterPositions: league.roster_positions,
    settings: league.settings,
    scoringSettings: league.scoring_settings,
    avatar: league.avatar ?? null,
  };
}

function normalizeRoster(roster: SleeperRoster): NormalizedSleeperRoster {
  const settings = roster.settings ?? {};
  return {
    sleeperLeagueId: roster.league_id,
    rosterId: roster.roster_id,
    ownerSleeperUserId: roster.owner_id ?? null,
    playerSleeperIds: roster.players ?? [],
    starterSleeperIds: roster.starters ?? [],
    reserveSleeperIds: roster.reserve ?? [],
    wins: numberSetting(settings, 'wins'),
    losses: numberSetting(settings, 'losses'),
    ties: numberSetting(settings, 'ties'),
    settings,
  };
}

function normalizeDraft(draft: SleeperDraft): NormalizedSleeperDraft {
  return {
    sleeperDraftId: draft.draft_id,
    sleeperLeagueId: draft.league_id ?? null,
    type: normalizeDraftType(draft.type),
    status: normalizeDraftStatus(draft.status),
    season: draft.season ?? null,
    rounds: nullableNumberSetting(draft.settings ?? {}, 'rounds'),
    teamCount: nullableNumberSetting(draft.settings ?? {}, 'teams'),
    startTime: draft.start_time ?? null,
    draftOrder: draft.draft_order ?? {},
    slotToRosterId: normalizeSlotToRosterId(draft.slot_to_roster_id ?? {}),
    metadata: draft.metadata ?? {},
  };
}

function normalizeDraftPick(pick: SleeperDraftPick): NormalizedSleeperDraftPick {
  return {
    sleeperDraftId: pick.draft_id,
    pickNo: pick.pick_no,
    round: pick.round,
    draftSlot: pick.draft_slot ?? null,
    rosterId: pick.roster_id ?? null,
    sleeperPlayerId: pick.player_id ?? null,
    pickedBySleeperUserId: pick.picked_by ?? null,
    isKeeper: pick.is_keeper ?? false,
    metadata: pick.metadata ?? {},
  };
}

function normalizeTradedPick(pick: SleeperTradedPick): NormalizedSleeperTradedPick {
  return {
    season: pick.season,
    round: pick.round,
    originalRosterId: pick.roster_id,
    previousOwnerRosterId: pick.previous_owner_id,
    currentOwnerRosterId: pick.owner_id,
  };
}

function normalizeTransaction(transaction: SleeperTransaction): NormalizedSleeperTransaction {
  return {
    sleeperTransactionId: transaction.transaction_id,
    type: transaction.type,
    status: transaction.status,
    rosterIds: transaction.roster_ids ?? [],
    adds: transaction.adds ?? {},
    drops: transaction.drops ?? {},
    draftPicks: (transaction.draft_picks ?? []).map(normalizeTradedPick),
    createdAt: transaction.created ?? null,
    statusUpdatedAt: transaction.status_updated ?? null,
  };
}

function normalizePlayerCatalog(catalog: SleeperPlayerCatalog): NormalizedSleeperPlayerCatalog {
  const players: Player[] = [];
  const skippedSleeperPlayerIds: string[] = [];

  for (const [sleeperPlayerId, player] of Object.entries(catalog)) {
    const position = normalizePlayerPosition(player.position);
    if (!position) {
      skippedSleeperPlayerIds.push(sleeperPlayerId);
      continue;
    }

    players.push({
      id: `sleeper-player-${player.player_id}` as PlayerId,
      sleeperPlayerId: player.player_id,
      fullName: player.full_name ?? [player.first_name, player.last_name].filter(Boolean).join(' '),
      position,
    });
  }

  return { players, skippedSleeperPlayerIds };
}

function normalizePlayerPosition(position: string | null | undefined): Player['position'] | null {
  if (position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE') {
    return position;
  }
  if (position === 'DEF') {
    return 'DEF';
  }
  return null;
}

function normalizeDraftType(type: string): SleeperDraftType {
  if (type === 'snake' || type === 'linear' || type === 'auction') {
    return type;
  }
  return 'unknown';
}

function normalizeDraftStatus(status: string): SleeperDraftStatus {
  if (status === 'pre_draft' || status === 'drafting' || status === 'complete') {
    return status;
  }
  return 'unknown';
}

function normalizeSlotToRosterId(value: Record<string, number>): Record<number, number> {
  return Object.fromEntries(
    Object.entries(value).map(([slot, rosterId]) => [Number(slot), rosterId]),
  );
}

function numberSetting(settings: Record<string, unknown>, key: string): number {
  return nullableNumberSetting(settings, key) ?? 0;
}

function nullableNumberSetting(settings: Record<string, unknown>, key: string): number | null {
  const value = settings[key];
  return typeof value === 'number' ? value : null;
}

function collectUnknownKeyDiagnostics(
  endpoint: SleeperEndpoint,
  raw: unknown,
  shape: UnknownFieldShape,
): SleeperDiagnostic[] {
  const diagnostics: SleeperDiagnostic[] = [];
  const reportedShapePaths = new Set<string>();

  visitUnknownFields(raw, shape, '', '', (key, path, shapePath) => {
    if (reportedShapePaths.has(shapePath)) {
      return;
    }
    reportedShapePaths.add(shapePath);
    diagnostics.push({
      level: 'warning',
      endpoint,
      message: `Unknown Sleeper field '${key}' was ignored.`,
      path,
    });
  });

  return diagnostics;
}

function visitUnknownFields(
  value: unknown,
  shape: UnknownFieldShape,
  path: string,
  shapePath: string,
  onUnknown: (key: string, path: string, shapePath: string) => void,
): void {
  if (shape.kind === 'array') {
    if (Array.isArray(value)) {
      value.forEach((item, index) =>
        visitUnknownFields(item, shape.item, `${path}[${index}]`, `${shapePath}[]`, onUnknown),
      );
    }
    return;
  }

  if (shape.kind === 'record') {
    if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        visitUnknownFields(
          item,
          shape.value,
          `${path}[${JSON.stringify(key)}]`,
          `${shapePath}[]`,
          onUnknown,
        );
      }
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const key of Object.keys(value)) {
    if (!shape.keys.has(key)) {
      onUnknown(key, path ? `${path}.${key}` : key, shapePath ? `${shapePath}.${key}` : key);
    }
  }

  for (const [key, childShape] of Object.entries(shape.children)) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      visitUnknownFields(
        value[key],
        childShape,
        path ? `${path}.${key}` : key,
        shapePath ? `${shapePath}.${key}` : key,
        onUnknown,
      );
    }
  }
}

function normalizeConfig(config: CreateSleeperAdapterConfig): SleeperAdapterConfig {
  // cacheTtlMs is only a fallback for endpoints without their own entry, so raising
  // it must not silently discard the per-endpoint defaults (notably the 24h players
  // TTL guarding a ~5MB payload). Only an explicit 0 clears the table, so it still
  // works as a global kill switch.
  const cacheTtlMsByEndpoint =
    config.cacheTtlMs === 0
      ? { ...config.cacheTtlMsByEndpoint }
      : {
          ...DEFAULT_SLEEPER_ADAPTER_CONFIG.cacheTtlMsByEndpoint,
          ...config.cacheTtlMsByEndpoint,
        };
  const resolved: SleeperAdapterConfig = {
    ...DEFAULT_SLEEPER_ADAPTER_CONFIG,
    ...config,
    cacheTtlMsByEndpoint,
  };
  if (!Number.isInteger(resolved.requestsPerMinuteLimit) || resolved.requestsPerMinuteLimit <= 0) {
    throw new Error('requestsPerMinuteLimit must be a positive integer.');
  }
  if (resolved.requestsPerMinuteLimit > 1000) {
    throw new Error('requestsPerMinuteLimit must stay at or below Sleeper guidance of 1000.');
  }
  if (!Number.isInteger(resolved.timeoutMs) || resolved.timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive integer.');
  }
  if (!Number.isInteger(resolved.retryCount) || resolved.retryCount < 0) {
    throw new Error('retryCount must be a non-negative integer.');
  }
  if (!Number.isInteger(resolved.retryBaseDelayMs) || resolved.retryBaseDelayMs < 0) {
    throw new Error('retryBaseDelayMs must be a non-negative integer.');
  }
  if (!Number.isInteger(resolved.cacheTtlMs) || resolved.cacheTtlMs < 0) {
    throw new Error('cacheTtlMs must be a non-negative integer.');
  }
  for (const [endpoint, cacheTtlMs] of Object.entries(resolved.cacheTtlMsByEndpoint)) {
    if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0) {
      throw new Error(`cacheTtlMsByEndpoint.${endpoint} must be a non-negative integer.`);
    }
  }
  if (!Number.isInteger(resolved.maxCacheEntries) || resolved.maxCacheEntries <= 0) {
    throw new Error('maxCacheEntries must be a positive integer.');
  }
  return resolved;
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function canServeStaleFor(error: unknown): boolean {
  return !(error instanceof SleeperHttpError) || shouldRetryStatus(error.status);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Freezing before recursing also terminates on circular references.
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

async function defaultFetch(
  url: string,
  init?: { signal?: AbortSignal },
): Promise<SleeperFetchResponse> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    json: () => response.json() as Promise<unknown>,
  };
}

export * from './pick-ownership.js';
export * from './franchise-mapping.js';
export * from './import-season.js';
