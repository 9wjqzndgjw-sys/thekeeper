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
 * Builds a read-only client from a set of environment values.
 *
 * Takes the environment as an argument rather than reading `process.env`, because the
 * browser has no such object: Vite substitutes `import.meta.env` at build time, and the
 * caller passes it in.
 *
 * The key here is the anon key, which is published to every visitor by design. What keeps
 * the data safe is row level security on the tables, not the secrecy of this key -- so the
 * service-role key must never be used in place of it.
 */
export function createAnonClient(env: Record<string, string | undefined>): KeeperDatabaseClient {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Reading needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Set them in .env.local for ' +
        'local development, and in the deployment environment for a hosted build.',
    );
  }
  if (key.length > 0 && env.SUPABASE_SERVICE_ROLE_KEY === key) {
    throw new Error(
      'VITE_SUPABASE_ANON_KEY is set to the service-role key; it would be published.',
    );
  }
  return createDatabaseClient({ url, key });
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
