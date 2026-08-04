// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../test-setup.js';
import { PanelShell } from './panel-shell.js';

/**
 * A thin harness that owns `expanded` the way App.tsx does, so these tests exercise the same
 * expand/collapse cycle a real caller drives rather than a PanelShell frozen at one prop value.
 */
function Harness({ initiallyExpanded = false }: { initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <PanelShell
      title="Player board"
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      onClose={() => setExpanded(false)}
    >
      <p>panel body</p>
    </PanelShell>
  );
}

describe('PanelShell', () => {
  it('renders collapsed with an expand control and no dialog role', () => {
    render(<Harness />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
  });

  it('expands into an accessible, labelled dialog when the expand control is activated', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /expand/i }));

    const dialog = screen.getByRole('dialog', { name: 'Player board' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('moves focus into the panel on expand and back to the expand control on close', () => {
    render(<Harness />);
    const expandButton = screen.getByRole('button', { name: /expand/i });

    fireEvent.click(expandButton);
    expect(screen.getByRole('heading', { name: 'Player board' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: /expand/i })).toHaveFocus();
  });

  it('closes on Escape and restores focus to the expand control', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /expand/i })).toHaveFocus();
  });

  it('locks page scroll while expanded and restores it on close', () => {
    render(<Harness />);
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.body.style.overflow).toBe('');
  });

  it('never mounts the panel body twice', () => {
    render(<Harness />);
    expect(screen.getAllByText('panel body')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(screen.getAllByText('panel body')).toHaveLength(1);
  });
});
