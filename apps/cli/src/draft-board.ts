import type { LiveDraftBoard, TrackedSelection } from '@keeper/draft-tracker';

export interface RenderLiveBoardInput {
  board: LiveDraftBoard;
  selections: readonly TrackedSelection[];
  lastSuccessfulSyncAt: string | null;
  stale: boolean;
  consecutiveFailureCount: number;
  userNextOverallPick?: number;
  limit?: number;
}

/**
 * Renders the tracker's state as markdown. The sync banner comes first because the draft
 * doc requires the board to say how fresh it is before it says anything else.
 */
export function renderLiveBoard(input: RenderLiveBoardInput): string[] {
  const rows =
    input.limit === undefined ? input.board.rows : input.board.rows.slice(0, input.limit);
  const manualPickCount = input.selections.filter(
    (selection) => selection.source === 'manual',
  ).length;
  const keeperPickCount = input.selections.filter((selection) => selection.isKeeper).length;
  const livePickCount = input.selections.length - keeperPickCount;

  return [
    '## Draft Status',
    `- Last successful sync: ${input.lastSuccessfulSyncAt ?? 'never'}`,
    `- Freshness: ${input.stale ? 'STALE - showing last known good board' : 'current'}`,
    `- Consecutive failures: ${input.consecutiveFailureCount}`,
    `- Pick slots recorded: ${input.selections.length} (${keeperPickCount} keepers, ${livePickCount} live, ${manualPickCount} entered manually)`,
    `- Players available: ${input.board.availablePlayerCount}`,
    ...(input.userNextOverallPick === undefined
      ? []
      : [`- Your next pick: overall ${input.userNextOverallPick}`]),
    ...(input.board.unmatchedDraftedPlayerIds.length === 0
      ? []
      : [`- Unidentified drafted players: ${input.board.unmatchedDraftedPlayerIds.join(', ')}`]),
    '',
    '## Available Board',
    '| Rank | Tier | Player | Pos | Proj | IV | At your pick |',
    '| ---: | ---: | --- | --- | ---: | ---: | ---: |',
    ...rows.map(
      (row) =>
        `| ${row.rank} | ${row.tier} | ${row.fullName} | ${row.position} | ${formatNumber(
          row.projectedPoints,
        )} | ${formatNumber(row.intrinsicValue)} | ${
          row.valueAtUserNextPick === null ? '-' : formatNumber(row.valueAtUserNextPick)
        } |`,
    ),
    '',
    '## Replacement Levels',
    ...Object.entries(input.board.replacementLevels).map(
      ([position, level]) => `- ${position}: ${formatNumber(level)}`,
    ),
  ];
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}
