import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  throw new Error(
    "Missing Supabase config. Copy .env.example to .env and fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.",
  );
}

export const supabase = createClient(url, anonKey, {
  // Supabase Auth is not used. Accounts are rows in public.profiles and the
  // password check happens in the sign_in() SQL function.
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
