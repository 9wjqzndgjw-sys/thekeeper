// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../test-setup.js';
import type { BoardViewModel } from '../view-models/boards.js';
import { BoardPanel } from './panels.js';

function buildBoard(): BoardViewModel {
  return {
    mode: 'as_declared',
    title: 'As declared',
    poolDescription: 'Test pool',
    caveats: [],
    board: {
      rows: [],
      replacementLevels: { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 },
      draftedPlayerCount: 0,
      availablePlayerCount: 0,
      availableCountByPosition: {},
      unmatchedDraftedPlayerIds: [],
    },
  };
}

function Harness() {
  const [expanded, setExpanded] = useState(false);
  return (
    <BoardPanel
      board={buildBoard()}
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onClose={() => setExpanded(false)}
    />
  );
}

describe('BoardPanel', () => {
  it('expands into an accessible dialog without remounting the panel', () => {
    render(<Harness />);

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /expand/i }));

    const dialog = screen.getByRole('dialog', { name: 'As declared' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Test pool')).toBeInTheDocument();
  });
});
