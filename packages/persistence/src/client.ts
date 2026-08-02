import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type KeeperDatabaseClient = SupabaseClient;

export interface CreateDatabaseClientInput {
  url: string;
  /**
   * Service-role key for writes, or the anon key for reads. The service role bypasses row
   * level security entirely, so it must never reach a browser.
   */
  key: string;
}

export function createDatabaseClient(input: CreateDatabaseClientInput): KeeperDatabaseClient {
  if (!input.url) {
    throw new Error('Supabase URL is required.');
  }
  if (/\/rest\/v1\/?$/.test(input.url)) {
    // The client appends this itself; leaving it on produces /rest/v1/rest/v1/... and a
    // confusing "invalid path" from PostgREST.
    throw new Error('Supabase URL must be the bare project URL, without a /rest/v1 suffix.');
  }
  if (!input.key) {
    throw new Error('Supabase key is required.');
  }

  return createClient(input.url.replace(/\/+$/, ''), input.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Builds a write-capable client from the environment. Throws rather than silently falling
 * back to the anon key, because a write that quietly does nothing is worse than a failure.
 */
export function createServiceClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): KeeperDatabaseClient {
  const url = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Writing needs VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Set them in .env.local.',
    );
  }
  return createDatabaseClient({ url, key });
}
