// @vitest-environment jsdom
import { act } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import './test-setup.js';
import { createMockDraftAppContext } from './app-state.js';
import { Dashboard } from './App.js';

/**
 * Only the interaction the SSR smoke test cannot reach: expanding a pop-out panel has to
 * make the rest of the dashboard inert, and closing it has to give that back, without
 * disturbing anything else on the page.
 */
describe('Dashboard pop-out panels', () => {
  it('marks the rest of the dashboard inert while the on-the-clock panel is expanded, and clears it on close', async () => {
    const context = createMockDraftAppContext();
    render(<Dashboard context={context} rehearse />);

    const setupHeading = await screen.findByRole('heading', { name: 'Setup' });
    const staticRegion = setupHeading.closest('section')!.parentElement!;
    expect(staticRegion).not.toHaveAttribute('inert');

    const onTheClockHeading = screen.getByRole('heading', { name: /on the clock/i });
    const onTheClockPanel = onTheClockHeading.closest('section')!;
    const expandButton = within(onTheClockPanel).getByRole('button', { name: /expand/i });

    await act(async () => {
      fireEvent.click(expandButton);
    });

    expect(staticRegion).toHaveAttribute('inert');
    expect(onTheClockPanel).not.toHaveAttribute('inert');
    expect(onTheClockPanel).toHaveAttribute('aria-modal', 'true');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    });

    expect(staticRegion).not.toHaveAttribute('inert');
  });
});
