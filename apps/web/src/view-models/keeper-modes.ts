import type {
  KeeperOptimizationMode,
  KeeperOptimizationResult,
  ValuedKeeperCombination,
} from '@keeper/keeper-optimizer';
import { KEEPER_OPTIMIZATION_MODES } from '@keeper/keeper-optimizer';

export interface KeeperModeRow {
  mode: KeeperOptimizationMode;
  /** The quantity this mode maximises, named so a score can be read in its own units. */
  optimises: string;
  score: number;
  retainedIntrinsicValue: number;
  consumedPickValue: number;
  keeperSurplusValue: number;
  teamContextValue: number;
  keepers: string;
  /** Other modes that chose exactly this set of keepers. */
  agreesWith: KeeperOptimizationMode[];
}

export interface KeeperModesViewModel {
  rows: KeeperModeRow[];
  /**
   * What a reader would otherwise have to infer from the numbers: which modes cannot
   * currently tell themselves apart, and why.
   */
  notes: string[];
}

const OPTIMISES: Record<KeeperOptimizationMode, string> = {
  expected: 'Team context value',
  safest: 'Keeper surplus value',
  win_now: 'Retained intrinsic value',
  future: 'Team context value + future option',
};

/**
 * Presents the four optimization modes so their scores can be compared honestly.
 *
 * The scores are not on one scale and must not be read as though they were. `win_now`
 * maximises retained intrinsic value and deliberately ignores what the keeper cost, so its
 * number is arithmetically always the largest -- surplus is intrinsic value minus a
 * non-negative pick cost. Printing all four under a single "Score" heading invites the
 * reader to conclude that win-now is two-and-a-half times better, when it is a different
 * unit.
 *
 * The modes are also not all distinguishable yet. Several team context components and the
 * future keeper option value are labelled zeros awaiting simulation, and while they are
 * zero, `expected` reduces to `safest` and `future` reduces to `expected`. Four identical
 * rows read as four strategies agreeing; they are one calculation printed four times, and
 * this says so rather than leaving it to be noticed.
 */
export function buildKeeperModes(optimization: KeeperOptimizationResult): KeeperModesViewModel {
  const rows: KeeperModeRow[] = KEEPER_OPTIMIZATION_MODES.flatMap((mode) => {
    const combination = optimization.bestByMode[mode];
    if (!combination) {
      return [];
    }
    return [
      {
        mode,
        optimises: OPTIMISES[mode],
        score: combination.modeScores[mode],
        retainedIntrinsicValue: combination.retainedIntrinsicValue,
        consumedPickValue: combination.consumedPickValue,
        keeperSurplusValue: combination.keeperSurplusValue,
        teamContextValue: combination.teamContextValue,
        keepers: describeKeepers(combination),
        agreesWith: KEEPER_OPTIMIZATION_MODES.filter(
          (other) =>
            other !== mode &&
            optimization.bestByMode[other] !== null &&
            sameSelection(combination, optimization.bestByMode[other]!),
        ),
      },
    ];
  });

  return { rows, notes: buildNotes(optimization, rows) };
}

/**
 * Notes are derived from the numbers actually present, not asserted. A component that
 * starts being modelled should make its note disappear on its own.
 */
function buildNotes(
  optimization: KeeperOptimizationResult,
  rows: readonly KeeperModeRow[],
): string[] {
  const notes: string[] = [];
  const combinations = optimization.combinations;

  if (combinations.length > 0) {
    if (combinations.every((combination) => combination.futureKeeperOptionValue === 0)) {
      notes.push(
        'Future keeper option value is not modelled yet, so "future" cannot differ from "expected".',
      );
    }
    if (
      combinations.every(
        (combination) => combination.teamContextValue === combination.keeperSurplusValue,
      )
    ) {
      notes.push(
        'Team context components are not modelled yet, so "expected" cannot differ from "safest".',
      );
    }
  }

  const winNow = rows.find((row) => row.mode === 'win_now');
  if (winNow && winNow.consumedPickValue > 0) {
    notes.push(
      'Win-now maximises production and ignores pick cost, so its score is on a different scale ' +
        'from the others and is always the largest. Compare the sets, not the numbers.',
    );
  }

  return notes;
}

function sameSelection(left: ValuedKeeperCombination, right: ValuedKeeperCombination): boolean {
  const a = [...left.selectedKeeperRightIds].sort();
  const b = [...right.selectedKeeperRightIds].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function describeKeepers(combination: ValuedKeeperCombination): string {
  if (combination.playerValuations.length === 0) {
    return 'Keep nobody';
  }
  return combination.playerValuations
    .map((player) => `${player.fullName} (r${player.nominalRound} → ${player.resolvedOverallPick})`)
    .join(', ');
}
