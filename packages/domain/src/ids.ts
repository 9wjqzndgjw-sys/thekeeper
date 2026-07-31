export type Brand<T, B extends string> = T & { readonly __brand: B };

export type LeagueId = Brand<string, 'LeagueId'>;
export type SeasonId = Brand<string, 'SeasonId'>;
export type FranchiseId = Brand<string, 'FranchiseId'>;
export type PlayerId = Brand<string, 'PlayerId'>;
export type DraftId = Brand<string, 'DraftId'>;
export type DraftPickAssetId = Brand<string, 'DraftPickAssetId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type KeeperRightId = Brand<string, 'KeeperRightId'>;
export type ValuationRunId = Brand<string, 'ValuationRunId'>;
