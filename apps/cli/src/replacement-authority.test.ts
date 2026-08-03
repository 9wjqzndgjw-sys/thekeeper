import { describe, expect, it } from 'vitest';
import {
  canReplaceKeeperState,
  canReplacePickInventory,
  canReplaceProjections,
} from './replacement-authority.js';

describe('canReplaceProjections', () => {
  it('accepts a nonempty, successfully matched import', () => {
    expect(
      canReplaceProjections({
        loadErrorCount: 0,
        loadedPlayerCount: 572,
        matchedPlayerCount: 568,
      }),
    ).toBe(true);
  });

  it('rejects parsed rows when none match the catalog', () => {
    expect(
      canReplaceProjections({
        loadErrorCount: 0,
        loadedPlayerCount: 572,
        matchedPlayerCount: 0,
      }),
    ).toBe(false);
  });

  it('rejects a parse that only partially matches the catalog', () => {
    expect(
      canReplaceProjections({
        loadErrorCount: 0,
        loadedPlayerCount: 572,
        matchedPlayerCount: 400,
      }),
    ).toBe(false);
  });

  it('rejects parser errors and empty exports', () => {
    expect(
      canReplaceProjections({
        loadErrorCount: 1,
        loadedPlayerCount: 20,
        matchedPlayerCount: 20,
      }),
    ).toBe(false);
    expect(
      canReplaceProjections({
        loadErrorCount: 0,
        loadedPlayerCount: 0,
        matchedPlayerCount: 0,
      }),
    ).toBe(false);
  });
});

describe('canReplaceKeeperState', () => {
  it('accepts a complete reconstruction whose players all exist in the catalog', () => {
    expect(
      canReplaceKeeperState({
        reconstructionErrorCount: 0,
        reconstructedRightCount: 192,
        persistableRightCount: 192,
        missingPlayerCount: 0,
      }),
    ).toBe(true);
  });

  it('rejects a nonempty reconstruction that omitted catalog players', () => {
    expect(
      canReplaceKeeperState({
        reconstructionErrorCount: 0,
        reconstructedRightCount: 192,
        persistableRightCount: 191,
        missingPlayerCount: 1,
      }),
    ).toBe(false);
  });

  it('rejects reconstruction errors and an empty reconstruction', () => {
    expect(
      canReplaceKeeperState({
        reconstructionErrorCount: 1,
        reconstructedRightCount: 180,
        persistableRightCount: 180,
        missingPlayerCount: 0,
      }),
    ).toBe(false);
    expect(
      canReplaceKeeperState({
        reconstructionErrorCount: 0,
        reconstructedRightCount: 0,
        persistableRightCount: 0,
        missingPlayerCount: 0,
      }),
    ).toBe(false);
  });
});

describe('canReplacePickInventory', () => {
  it('requires a nonempty inventory without import errors', () => {
    expect(canReplacePickInventory({ importErrorCount: 0, pickCount: 180 })).toBe(true);
    expect(canReplacePickInventory({ importErrorCount: 0, pickCount: 0 })).toBe(false);
    expect(canReplacePickInventory({ importErrorCount: 1, pickCount: 179 })).toBe(false);
  });
});
