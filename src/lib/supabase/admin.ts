import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS. SERVER ONLY.
 * All game-state writes go through API routes using this client after
 * explicit validation; clients never write game tables directly.
 */
export function supabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
