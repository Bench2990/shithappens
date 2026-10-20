import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { fetchWithTimeout } from "./fetch";

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

let client: SupabaseClient<Database> | undefined;
let authentication: Promise<void> | undefined;

export function getSupabase(): SupabaseClient<Database> {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Hiányzik a Supabase beállítása.");
    client = createClient<Database>(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: fetchWithTimeout },
    });
  }
  return client;
}

// A React Strict Mode és az egyszerre induló lekérések se hozzanak létre két identitást.
export function ensureAnonymousSession(): Promise<void> {
  if (!authentication) {
    authentication = (async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) throw signInError;
      }
    })().catch((error: unknown) => {
      authentication = undefined;
      throw error;
    });
  }
  return authentication;
}
