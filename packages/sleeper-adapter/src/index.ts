import { z } from 'zod';
import type { Player, PlayerId } from '@keeper/domain';

export interface SleeperAdapterConfig {
  baseUrl: string;
  requestsPerMinuteLimit: number;
  timeoutMs: number;
  retryCount: number;
  retryBaseDelayMs: number;
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
  endpoint: SleeperEndpoint;
  url: string;
  fetchedAt: string;
  raw: unknown;
}

export type SleeperRawSnapshotSink = (snapshot: SleeperRawSnapshot) => void | Promise<void>;

export interface SleeperAdapterResponse<T> {
  data: T;
  snapshot: SleeperRawSnapshot;
  diagnostics: SleeperDiagnostic[];
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

const schemaKeys = {
  user: ['user_id', 'username', 'display_name', 'avatar', 'metadata', 'is_owner'],
  league: [
    'total_rosters',
    'status',
    'settings',
    'scoring_settings',
    'roster_positions',
    'previous_league_id',
    'name',
    'league_id',
    'draft_id',
    'avatar',
    'season',
  ],
  roster: ['roster_id', 'league_id', 'owner_id', 'players', 'starters', 'reserve', 'settings'],
  draft: [
    'draft_id',
    'league_id',
    'type',
    'status',
    'season',
    'start_time',
    'settings',
    'draft_order',
    'slot_to_roster_id',
    'metadata',
  ],
  draftPick: [
    'draft_id',
    'pick_no',
    'round',
    'draft_slot',
    'roster_id',
    'player_id',
    'picked_by',
    'is_keeper',
    'metadata',
  ],
  tradedPick: ['season', 'round', 'roster_id', 'previous_owner_id', 'owner_id'],
  transaction: [
    'transaction_id',
    'type',
    'status',
    'roster_ids',
    'adds',
    'drops',
    'draft_picks',
    'created',
    'status_updated',
  ],
} satisfies Record<string, string[]>;

export function createSleeperAdapter(config: CreateSleeperAdapterConfig = {}): SleeperAdapter {
  const resolvedConfig = normalizeConfig(config);
  const client = new SleeperHttpClient(resolvedConfig);

  return {
    getUser(userIdOrUsername) {
      return client.fetchNormalized({
        endpoint: 'user',
        path: `/user/${encodeURIComponent(userIdOrUsername)}`,
        schema: sleeperUserSchema,
        schemaKeys: schemaKeys.user,
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
        schemaKeys: schemaKeys.league,
        normalize: (leagues) => leagues.map(normalizeLeague),
      });
    },
    getLeague(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league',
        path: `/league/${encodeURIComponent(leagueId)}`,
        schema: sleeperLeagueSchema,
        schemaKeys: schemaKeys.league,
        normalize: normalizeLeague,
      });
    },
    getLeagueRosters(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league_rosters',
        path: `/league/${encodeURIComponent(leagueId)}/rosters`,
        schema: z.array(sleeperRosterSchema),
        schemaKeys: schemaKeys.roster,
        normalize: (rosters) => rosters.map(normalizeRoster),
      });
    },
    getLeagueUsers(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league_users',
        path: `/league/${encodeURIComponent(leagueId)}/users`,
        schema: z.array(sleeperUserSchema),
        schemaKeys: schemaKeys.user,
        normalize: (users) => users.map(normalizeUser),
      });
    },
    getLeagueDrafts(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league_drafts',
        path: `/league/${encodeURIComponent(leagueId)}/drafts`,
        schema: z.array(sleeperDraftSchema),
        schemaKeys: schemaKeys.draft,
        normalize: (drafts) => drafts.map(normalizeDraft),
      });
    },
    getLeagueTransactions(leagueId, week) {
      return client.fetchNormalized({
        endpoint: 'league_transactions',
        path: `/league/${encodeURIComponent(leagueId)}/transactions/${week}`,
        schema: z.array(sleeperTransactionSchema),
        schemaKeys: schemaKeys.transaction,
        normalize: (transactions) => transactions.map(normalizeTransaction),
      });
    },
    getLeagueTradedPicks(leagueId) {
      return client.fetchNormalized({
        endpoint: 'league_traded_picks',
        path: `/league/${encodeURIComponent(leagueId)}/traded_picks`,
        schema: z.array(sleeperTradedPickSchema),
        schemaKeys: schemaKeys.tradedPick,
        normalize: (tradedPicks) => tradedPicks.map(normalizeTradedPick),
      });
    },
    getDraft(draftId) {
      return client.fetchNormalized({
        endpoint: 'draft',
        path: `/draft/${encodeURIComponent(draftId)}`,
        schema: sleeperDraftSchema,
        schemaKeys: schemaKeys.draft,
        normalize: normalizeDraft,
      });
    },
    getDraftPicks(draftId) {
      return client.fetchNormalized({
        endpoint: 'draft_picks',
        path: `/draft/${encodeURIComponent(draftId)}/picks`,
        schema: z.array(sleeperDraftPickSchema),
        schemaKeys: schemaKeys.draftPick,
        normalize: (picks) => picks.map(normalizeDraftPick),
      });
    },
    getDraftTradedPicks(draftId) {
      return client.fetchNormalized({
        endpoint: 'draft_traded_picks',
        path: `/draft/${encodeURIComponent(draftId)}/traded_picks`,
        schema: z.array(sleeperTradedPickSchema),
        schemaKeys: schemaKeys.tradedPick,
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
        schemaKeys: null,
        normalize: normalizePlayerCatalog,
      });
    },
  };
}

class SleeperHttpClient {
  private lastRequestAt: number | null = null;

  constructor(private readonly config: SleeperAdapterConfig) {}

  async fetchNormalized<TParsed, TNormalized>(input: {
    endpoint: SleeperEndpoint;
    path: string;
    schema: z.ZodType<TParsed>;
    schemaKeys: readonly string[] | null;
    normalize: (parsed: TParsed) => TNormalized;
  }): Promise<SleeperAdapterResponse<TNormalized>> {
    const url = buildUrl(this.config.baseUrl, input.path);
    const raw = await this.fetchJsonWithPolicy(url);
    const fetchedAt = new Date(this.config.now()).toISOString();
    const snapshot: SleeperRawSnapshot = {
      endpoint: input.endpoint,
      url,
      fetchedAt,
      raw,
    };
    await this.config.snapshotSink?.(snapshot);

    const diagnostics = collectUnknownKeyDiagnostics(input.endpoint, raw, input.schemaKeys);
    const parsed = input.schema.safeParse(raw);
    if (!parsed.success) {
      throw new SleeperValidationError(input.endpoint, parsed.error, diagnostics);
    }

    return {
      data: input.normalize(parsed.data),
      snapshot,
      diagnostics,
    };
  }

  private async fetchJsonWithPolicy(url: string): Promise<unknown> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.config.retryCount; attempt += 1) {
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
        lastError = error;
        if (error instanceof SleeperHttpError || attempt >= this.config.retryCount) {
          throw error;
        }
        await this.config.sleep(this.retryDelay(attempt));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async waitForRateLimit(): Promise<void> {
    const now = this.config.now();
    if (this.lastRequestAt === null) {
      this.lastRequestAt = now;
      return;
    }

    const minimumIntervalMs = Math.ceil(60_000 / this.config.requestsPerMinuteLimit);
    const elapsed = now - this.lastRequestAt;
    if (elapsed < minimumIntervalMs) {
      await this.config.sleep(minimumIntervalMs - elapsed);
    }

    this.lastRequestAt = this.config.now();
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
    rounds: numberSetting(draft.settings ?? {}, 'rounds') || null,
    teamCount: numberSetting(draft.settings ?? {}, 'teams') || null,
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
  const value = settings[key];
  return typeof value === 'number' ? value : 0;
}

function collectUnknownKeyDiagnostics(
  endpoint: SleeperEndpoint,
  raw: unknown,
  keys: readonly string[] | null,
): SleeperDiagnostic[] {
  if (!keys) {
    return [];
  }

  const allowedKeys = new Set(keys);
  const objects = Array.isArray(raw) ? raw : [raw];
  const diagnostics: SleeperDiagnostic[] = [];

  objects.forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }
    for (const key of Object.keys(item)) {
      if (!allowedKeys.has(key)) {
        diagnostics.push({
          level: 'warning',
          endpoint,
          message: `Unknown Sleeper field '${key}' was ignored.`,
          path: Array.isArray(raw) ? `[${index}].${key}` : key,
        });
      }
    }
  });

  return diagnostics;
}

function normalizeConfig(config: CreateSleeperAdapterConfig): SleeperAdapterConfig {
  const resolved = { ...DEFAULT_SLEEPER_ADAPTER_CONFIG, ...config };
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
  return resolved;
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}${path}`;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
