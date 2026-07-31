import { describe, expect, it } from 'vitest';
import { createSleeperAdapter, DEFAULT_SLEEPER_ADAPTER_CONFIG } from './index.js';

describe('sleeper-adapter (Phase 2 placeholder)', () => {
  it('exposes a default config', () => {
    expect(DEFAULT_SLEEPER_ADAPTER_CONFIG.requestsPerMinuteLimit).toBeLessThanOrEqual(1000);
  });

  it('throws until the real adapter is implemented', () => {
    expect(() => createSleeperAdapter()).toThrow(/not yet implemented/);
  });
});
