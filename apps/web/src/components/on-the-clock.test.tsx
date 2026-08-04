// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../test-setup.js';
import type { FranchiseId } from '@keeper/domain';
import { createMockDraftAppContext } from '../app-state.js';
import { createRehearsal, readRehearsal, submitPick, type Rehearsal, type RehearsalView } from '../rehearsal.js';
import { OnTheClockPanel } from './on-the-clock.js';

function startRehearsal(): Rehearsal {
  const rehearsal = createRehearsal({ context: createMockDraftAppContext() });
  if ('error' in rehearsal) {
    throw new Error(`fixture league is not rehearsable: ${rehearsal.error}`);
  }
  return rehearsal;
}

function buildView(): RehearsalView {
  return readRehearsal(startRehearsal());
}

describe('OnTheClockPanel', () => {
  it('gives every recommendation Draft button a player-specific accessible name', () => {
    render(
      <OnTheClockPanel
        view={buildView()}
        franchiseName="Test Team"
        busy={false}
        onPick={() => {}}
        onUndo={() => {}}
      />,
    );

    const draftButtons = screen.getAllByRole('button', { name: /^Draft / });
    expect(draftButtons.length).toBeGreaterThan(0);
    for (const button of draftButtons) {
      expect(button.getAttribute('aria-label')).toMatch(/^Draft .+/);
    }
  });

  it('renders one recommendation card per table row, carrying every desktop column', () => {
    render(
      <OnTheClockPanel
        view={buildView()}
        franchiseName="Test Team"
        busy={false}
        onPick={() => {}}
        onUndo={() => {}}
      />,
    );

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // drop the header row
    const cards = document.querySelectorAll('.recommendation-card');
    expect(cards.length).toBe(rows.length);

    const firstCard = cards[0]!;
    expect(within(firstCard as HTMLElement).getByText('Proj')).toBeInTheDocument();
    expect(within(firstCard as HTMLElement).getByText('Value')).toBeInTheDocument();
    expect(within(firstCard as HTMLElement).getByText('ADP')).toBeInTheDocument();
    expect(within(firstCard as HTMLElement).getByText('Need')).toBeInTheDocument();
    expect(within(firstCard as HTMLElement).getByRole('button')).toBeInTheDocument();
  });

  it('does not clear the "draft someone else" search when the panel is expanded and restored', () => {
    const view = buildView();
    let expanded = false;

    const renderPanel = () =>
      renderResult.rerender(
        <OnTheClockPanel
          view={view}
          franchiseName="Test Team"
          busy={false}
          onPick={() => {}}
          onUndo={() => {}}
          expanded={expanded}
          onExpand={() => {
            expanded = true;
            renderPanel();
          }}
          onClose={() => {
            expanded = false;
            renderPanel();
          }}
        />,
      );

    const renderResult = render(
      <OnTheClockPanel
        view={view}
        franchiseName="Test Team"
        busy={false}
        onPick={() => {}}
        onUndo={() => {}}
        expanded={expanded}
        onExpand={() => {
          expanded = true;
          renderPanel();
        }}
        onClose={() => {
          expanded = false;
          renderPanel();
        }}
      />,
    );

    const search = screen.getByLabelText('Search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'a player search that should survive' } });
    expect(search.value).toBe('a player search that should survive');

    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe(
      'a player search that should survive',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe(
      'a player search that should survive',
    );
  });

  it('shows a draft log naming who took each player and why the algorithm ranked him', async () => {
    const rehearsal = startRehearsal();
    const opening = readRehearsal(rehearsal);
    await submitPick(rehearsal, opening.recommendations[0]!.player.playerId);
    const view = readRehearsal(rehearsal);

    // Picking off the algorithm's own top recommendation, so the bot pick(s) that follow are
    // the ones worth reading a reason for.
    const botPick = view.selections.find((selection) => !selection.byUser && !selection.isKeeper)!;
    const franchiseNames = new Map<FranchiseId, string>([
      [botPick.franchiseId, 'The Rival Franchise'],
    ]);

    render(
      <OnTheClockPanel
        view={view}
        franchiseName="Test Team"
        franchiseNames={franchiseNames}
        busy={false}
        onPick={() => {}}
        onUndo={() => {}}
      />,
    );

    expect(screen.getByText(/Draft log/)).toBeInTheDocument();
    expect(screen.getAllByText('The Rival Franchise').length).toBeGreaterThan(0);

    const reasonText = botPick.pickReason
      ? botPick.pickReason.rank === 1
        ? /Algorithm’s top-ranked candidate/
        : /Ranked #\d+ of \d+ candidates/
      : /Not among the algorithm’s ranked candidates/;
    expect(screen.getAllByText(reasonText).length).toBeGreaterThan(0);
  });
});
