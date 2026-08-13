// `defineConfig` comes from `vitest/config`, not `vite` — same function, but it also types the
// `test` block below. `vite build` ignores `test` entirely, so this changes nothing about the
// production build.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  test: {
    // `src/lib/supabase.ts` calls `createClient(url, key)` at module scope, so ANY test that
    // imports a `src/lib/*` module builds a real Supabase client just by loading the file — and
    // supabase-js throws "supabaseUrl is required" when the value is undefined. Locally that never
    // happens, because the gitignored `.env` supplies both. CI has no `.env`, so 10 test files
    // died on import there while passing on every developer machine (2026-08-12).
    //
    // These are throwaway placeholders, deliberately not real credentials: no test makes a network
    // call, they only have to be present and syntactically valid enough for the constructor. Real
    // values still come from `.env` locally and from Vercel's env vars in production; anything set
    // in the environment already takes precedence over what's here.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key-not-a-real-credential',
    },
  },
})
