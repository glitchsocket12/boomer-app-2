-- Two founder asks on Notebooks (2026-08-19), one migration.
--
-- 1. RICH TEXT. Entries are now written in a real editor, so `content` holds HTML. `content_text`
--    is the same thing flattened to words, written alongside it by the client (see
--    src/lib/richText.ts). It is stored rather than derived because both of its readers are unable
--    to derive it: global search would otherwise match "strong" inside every bold word, and
--    `converse` runs on Deno, where there is no DOM to parse HTML with.
--
-- 2. A LOCK for sensitive notebooks. Founder: "just in case I leave my computer tab open, if
--    someone clicks into that, they should be prompted to enter [a] password."
--
--    ⚠ SCOPE, stated plainly because it would be easy to over-trust: this protects the SCREEN
--    against someone who walks up to an already-signed-in tab, which is exactly the case asked
--    for. It is NOT encryption. Anyone able to open devtools can still read `notebook_entries`
--    straight from the API with the session that is already there — no PIN involved — because RLS
--    grants that session the rows. Real protection against that would mean encrypting entry bodies
--    under a key derived from the PIN, which would also make the notebook permanently unreadable
--    to Boomer and permanently lost if the PIN were forgotten. Not built, deliberately.

alter table notebook_entries add column if not exists content_text text;

-- Everything written before the editor existed is plain text already, so it IS its own plain-text
-- form. Without this the existing entries would drop out of search and out of the chat prompt,
-- both of which now read content_text and would see null.
update notebook_entries set content_text = content where content_text is null;

alter table notebooks add column if not exists locked boolean not null default false;

-- --- The PIN ---------------------------------------------------------------------------------
--
-- pgcrypto gives us crypt()/gen_salt() so the PIN is bcrypt-hashed and never stored readable.
create extension if not exists pgcrypto with schema extensions;

-- NOTE the RLS shape here is deliberately unlike every other table in this database. RLS is enabled
-- and NO policy is created, which means PostgREST can neither read nor write this table at all —
-- the only access is through the security-definer functions below, which bypass RLS.
--
-- The alternative, hanging pin_hash off `user_settings`, looked simpler and is worse: that table's
-- policy lets the owner select their own row, so the hash would be one devtools query away and a
-- 4-digit PIN falls to an offline brute force in about a second. A hash nobody can read can only be
-- attacked through verify_notebook_pin() below, which counts failures and locks out.
create table if not exists notebook_pins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table notebook_pins enable row level security;

-- How long a PIN must be. Short enough to type one-handed, long enough that the lockout below
-- makes guessing hopeless.
-- Every function pins `search_path`: a security-definer function that inherits the caller's
-- search_path can be tricked into running an attacker's function of the same name.

create or replace function notebook_pin_status()
returns json
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row notebook_pins%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into v_row from notebook_pins where user_id = auth.uid();
  return json_build_object(
    'has_pin', v_row.user_id is not null,
    'locked_until', v_row.locked_until
  );
end;
$$;

-- Sets or changes the PIN.
--
-- Changing an EXISTING pin requires either the current PIN, or a session whose token was issued in
-- the last 5 minutes — which in practice means the account password was just re-entered, since
-- signInWithPassword mints a fresh token. That second path is the "I forgot my PIN" escape; without
-- it a forgotten PIN would lock the founder out of their own writing permanently.
--
-- Known limit of the freshness check: Supabase also refreshes an access token on its own schedule,
-- so a token can be young without a password having been typed. Closing that would require a
-- re-auth primitive Supabase only exposes via an emailed nonce. Given the threat here is somebody
-- who walked up to an open laptop — not somebody scripting the API, who could read the rows
-- directly anyway (see the header) — a 5-minute window is the right trade, but it IS a trade.
create or replace function set_notebook_pin(p_new_pin text, p_current_pin text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_token_age_seconds numeric;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_new_pin is null or length(trim(p_new_pin)) < 4 then
    raise exception 'PIN must be at least 4 characters';
  end if;

  select pin_hash into v_hash from notebook_pins where user_id = auth.uid();

  if v_hash is not null then
    v_token_age_seconds := extract(epoch from now()) - coalesce((auth.jwt() ->> 'iat')::numeric, 0);
    if not (
      (p_current_pin is not null and v_hash = crypt(p_current_pin, v_hash))
      or v_token_age_seconds < 300
    ) then
      raise exception 'current PIN required';
    end if;
  end if;

  insert into notebook_pins (user_id, pin_hash, failed_attempts, locked_until, updated_at)
  values (auth.uid(), crypt(trim(p_new_pin), gen_salt('bf')), 0, null, now())
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now();
end;
$$;

-- Returns true/false rather than raising, EXCEPT while locked out — the caller needs to tell "wrong
-- PIN" from "stop trying for a minute" to say something useful.
--
-- The lockout is what makes a 4-digit PIN defensible: 10,000 possibilities is nothing to a script,
-- but 5 tries per minute turns an exhaustive search into well over a day of sustained effort
-- against a table nothing else can read.
create or replace function verify_notebook_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row notebook_pins%rowtype;
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from notebook_pins where user_id = auth.uid();
  if v_row.user_id is null then
    return false;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    raise exception 'too many attempts';
  end if;

  v_ok := v_row.pin_hash = crypt(coalesce(p_pin, ''), v_row.pin_hash);

  if v_ok then
    update notebook_pins set failed_attempts = 0, locked_until = null where user_id = auth.uid();
  else
    -- On the 5th miss, start a lockout AND zero the counter in the same statement, so the next
    -- window begins clean instead of locking out on every attempt from then on. Both branches key
    -- off the same expression; Postgres rejects assigning one column twice, so the reset has to
    -- live inside this CASE rather than in a second `set`.
    update notebook_pins
      set failed_attempts = case when v_row.failed_attempts + 1 >= 5 then 0 else v_row.failed_attempts + 1 end,
          locked_until = case when v_row.failed_attempts + 1 >= 5 then now() + interval '1 minute' else null end
      where user_id = auth.uid();
  end if;

  return v_ok;
end;
$$;

-- anon is deliberately NOT granted: every one of these raises without a session anyway, but there
-- is no reason for the unauthenticated role to be able to call them at all.
revoke all on function notebook_pin_status() from public, anon;
revoke all on function set_notebook_pin(text, text) from public, anon;
revoke all on function verify_notebook_pin(text) from public, anon;
grant execute on function notebook_pin_status() to authenticated;
grant execute on function set_notebook_pin(text, text) to authenticated;
grant execute on function verify_notebook_pin(text) to authenticated;
