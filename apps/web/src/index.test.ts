import { describe, expect, it } from 'vitest';
import { loadPlaceholderSnapshot } from './index.js';

describe('loadPlaceholderSnapshot', () => {
  it('loads the synthetic league snapshot', () => {
    expect(loadPlaceholderSnapshot().league.name).toBe('Synthetic Keeper League');
  });
});
