import { describe, expect, it } from 'vitest';
import { enumerateKeeperCombinations } from './index.js';

describe('enumerateKeeperCombinations', () => {
  it('returns the empty combination when there are no keeper rights', () => {
    expect(enumerateKeeperCombinations([])).toEqual([{ selectedKeeperRightIds: [] }]);
  });
});
