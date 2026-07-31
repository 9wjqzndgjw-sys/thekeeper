export interface SleeperAdapterConfig {
  baseUrl: string;
  requestsPerMinuteLimit: number;
}

export const DEFAULT_SLEEPER_ADAPTER_CONFIG: SleeperAdapterConfig = {
  baseUrl: 'https://api.sleeper.app/v1',
  requestsPerMinuteLimit: 1000,
};

// Placeholder until Phase 2 implements the read-only, rate-limited, Zod-validated HTTP client.
export function createSleeperAdapter(
  _config: SleeperAdapterConfig = DEFAULT_SLEEPER_ADAPTER_CONFIG,
): never {
  throw new Error('sleeper-adapter not yet implemented (Phase 2)');
}
