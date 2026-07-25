-- Adds the user's IANA time zone (e.g. "America/Denver") to user_settings, same table as
-- chat_tone. Nullable, no default — null means "not yet detected," handled in app code
-- (src/lib/ensureUserTimeZone.ts auto-detects from the browser on next sign-in and never
-- overwrites a value the user later sets themselves in Settings; Edge Functions fall back to
-- UTC when null, matching the old server-time behavior). Fixes moments/reminders logged in the
-- evening (UTC has already rolled to the next calendar day west of Greenwich) from being dated
-- tomorrow instead of today.
alter table user_settings add column if not exists time_zone text;
