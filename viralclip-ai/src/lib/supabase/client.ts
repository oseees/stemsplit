"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  // Placeholder fallbacks keep static prerender from crashing when env vars are
  // absent at build time; real values are inlined for the browser at runtime.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
  );
}
