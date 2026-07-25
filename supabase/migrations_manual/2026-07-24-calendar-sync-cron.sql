-- Daily automatic calendar sync (gameplan phase 3 — founder chose "both": automatic daily +
-- manual "Sync now" button). Uses pg_cron + pg_net to call the scan-calendar-sources Edge
-- Function once a day for every account with a connected calendar.
--
-- Authentication: the cron job and the Edge Function share a secret (x-cron-secret header vs.
-- the CRON_SCAN_SECRET Edge Function secret) so the function can tell "the scheduler is calling
-- me, scan every account" apart from "a logged-in user clicked Sync now, scan just them" — without
-- ever putting the actual secret value in this file (or anywhere in git). It's stored once via
-- Supabase Vault (`select vault.create_secret(...)`, run directly against the project, not
-- checked in) and looked up by name here at run time.
--
-- Requires pg_cron and pg_net (already enabled on this project) and supabase_vault (already
-- enabled). If ever re-run against a fresh project, the vault secret named 'cron_scan_secret'
-- must be created first and its value set as the CRON_SCAN_SECRET Edge Function secret.

select cron.schedule(
  'daily-calendar-scan',
  '0 13 * * *', -- 13:00 UTC daily (~6-9am US timezones)
  $$
  select net.http_post(
    url := 'https://dedtnytxhzzjimkozncc.functions.supabase.co/scan-calendar-sources',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_scan_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
