import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

/**
 * Renders the real component tree to markup. Server rendering skips effects, so this does
 * not exercise polling, but it does prove every panel builds its view model and renders
 * without throwing -- which a passing `vite build` alone does not show.
 */
describe('App', () => {
  const markup = renderToStaticMarkup(createElement(App));

  it('renders each required panel', () => {
    for (const heading of ['Setup', 'Pick horizon', 'Recommendation', 'Keeper combinations']) {
      expect(markup).toContain(heading);
    }
  });

  it('shows sync status before the board', () => {
    expect(markup).toContain('No successful sync yet');
    expect(markup.indexOf('No successful sync yet')).toBeLessThan(markup.indexOf('Pick horizon'));
  });

  it('offers all three boards and renders one of them', () => {
    expect(markup).toContain('Pre-keeper board');
    expect(markup).toContain('Post-keeper board');
    expect(markup).toContain('Live board');
    expect(markup).toContain('At your pick');
  });

  it('surfaces the league setup the engine actually loaded', () => {
    expect(markup).toContain('Synthetic Keeper League');
    expect(markup).toContain('180 assets');
  });

  it('names the user next pick and who drafts before them', () => {
    expect(markup).toContain('Your next pick');
    expect(markup).toContain('Team 1');
  });
});
