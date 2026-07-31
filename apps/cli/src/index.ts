import { createSyntheticLeagueSnapshot } from '@keeper/test-fixtures';
import { buildLeagueSummary } from './summary.js';

const snapshot = createSyntheticLeagueSnapshot();
for (const line of buildLeagueSummary(snapshot)) {
  console.log(line);
}
