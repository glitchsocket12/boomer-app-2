# Security — where Boomer actually stands

_Written 2026-08-01, after a full read of the codebase. Plain language on purpose. If a sentence in here needs translating, it failed its job — say so and it gets rewritten._

This is the honest version, not the "we take security seriously" version. It covers what protects your data today, what doesn't, what you personally need to go do, and the real answer on end-to-end encryption.

**Context that shapes everything below:** right now you are the only real user. That single fact changes the priority order completely. Most security advice is written for apps with strangers on them. You don't have strangers — and the highest-value thing you can do is make sure you never accidentally get them.

---

## 1. Do this first: close public signup

Right now, anyone who finds the site can create an account. Nobody has, but nothing stops it.

Two things that fixes:

- **Your AI bill.** Every chat message and voice note costs real money against your Anthropic and OpenAI accounts. A stranger with an account can spend it. There's currently no limit on how fast.
- **Everything on this page about keeping users separate from each other.** If there's only one account, there's nobody to leak to. It doesn't make the isolation work unnecessary — but it turns a live risk into a theoretical one.

**Where:** Supabase Dashboard → **Authentication** → **Sign In / Providers** → Email. Look for a toggle named something like *"Allow new users to sign up"* or *"Enable sign ups"* and turn it off. (Supabase moves this around between versions — in older projects it lives under Authentication → Settings. If you can't find it, it's the setting with "sign up" in the name, not "sign in.")

Your own account keeps working exactly as it does now. You're already signed up; this only blocks *new* ones. When you're ready for beta testers, flip it back on — or better, create their accounts yourself and leave it off.

---

## 2. Then: lock down your own logins

**This is the most likely way Boomer actually gets breached — not a flaw in the code.** Nobody is going to find a clever hole in the app. Somebody might phish your password. Every one of these accounts is a key to some part of the system.

Ordered by how much damage a stolen password does:

| Account | What someone gets if they steal it | Priority |
|---|---|---|
| **Google / Gmail** (`jake.volin@gmail.com`) | Password resets for *everything else on this list*. It's the recovery address, so it's the master key. | **Do first** |
| **GitHub** (`glitchsocket12`) | Pushing code to `main` deploys straight to the live site with no review step — so this is the ability to run any code they want against all your data. | **Do first** |
| **Supabase** | Direct read and write access to every note, person, and event in the database. Also the master key that bypasses all the protections in section 3. | **Do first** |
| **Vercel** | Control over what gets deployed, plus every environment variable. | High |
| **Anthropic Console** | Your API key and billing. Costs money; can't read your data. | Medium |
| **OpenAI Platform** | Same — your voice-transcription key and billing. | Medium |
| **Google Cloud Console** | The Google Photos connection credentials. | Medium |
| **Geoapify** | An address-autocomplete key with a 3,000/day cap. Genuinely minor. | Low |

**Three notes worth more than the table:**

- **Use an authenticator app or a passkey, not text messages.** SMS codes can be stolen by someone convincing your phone carrier to move your number to their phone. It's not exotic; it happens to people with anything worth taking.
- **Don't store your recovery codes in the same Google account** that they're recovery codes *for*. That's a circle. Print them, or put them in a password manager.
- **Check whether any of these still let you log in by emailed link.** If they do, your email account is the only real lock on them, and the second factor you just set up is decorative.

You don't have a domain registrar yet — you're on a `vercel.app` address. When you buy a real domain under the new name, it joins this list. Domain takeover is its own way in, and it's a common one.

---

## 3. What actually protects your data today

### The wall

Every piece of data in Boomer — every person, note, event, group — is stamped with the ID of the account that owns it. Attached to each table is a rule: *only return rows whose owner matches whoever is asking.*

The important part is **where** that rule lives. It's not in the app's code. It's inside the database itself. That means it isn't something a cleverly-crafted web address or a modified browser request can talk its way around — the database checks every single time, for every single query, and there's no path that skips it.

This is the thing that would keep two users' notes apart. It's the right way to build it, and it's how Boomer is built.

### What I verified by reading the code

- **All twelve backend functions check your login before doing anything**, and reject the request outright if it's missing or expired. Then they act *as you*, so the wall above applies to them too.
- **Three of those functions hold a master key** that can bypass the wall (they need it to read your Google Photos token, which is deliberately hidden even from your own browser). Every one of them looks up *who you are from your verified login*, never from whatever the browser claimed. That's the single most common way this kind of thing goes wrong, and it was done correctly here.
- **Your AI keys never reach your browser.** All the Anthropic and OpenAI calls happen on the server. Someone reading the app's code in their browser learns nothing useful.
- **The app has almost nothing to attack.** Three outside code libraries total, zero known vulnerabilities in them, and none of the patterns that let attackers inject their own code into a page.

Read plainly: the foundation is sound. Whoever told you this would be too complex to look at was wrong — it took an afternoon, and it's in better shape than most.

### The isolation wall — VERIFIED 2026-08-01

This was the open question in the first draft of this document: `people`, `moments`, `notes`, `groups`, `person_groups`, `reminders`, `home_suggestions` were created by hand in the Supabase dashboard before the project started recording database changes, so nothing proved they'd been given the rule.

**They had it. All of them.** The founder ran `supabase/migrations_manual/2026-08-01-rls-audit.sql` against the live database:

- **All 23 tables protected**, including `storage.objects` (the photos bucket).
- **Every read rule scoped to the owner** — either `auth.uid() = user_id` directly, or an ownership check through the parent table for the join tables (`person_groups`, `moment_tags`, `moment_groups`, `notes`, `reminders`, `group_associations`).
- **Nothing wide open.** No policy anywhere evaluates to a bare `true`.

**Why the undocumented tables were covered anyway:** the database has an event trigger called `rls_auto_enable`, installed by the original Bolt/StackBlitz scaffold, which automatically switches RLS on for every table created in `public`. It's been catching them the whole time. It's also written correctly — it pins its own `search_path`, which is the right hardening for a `SECURITY DEFINER` function. **Leave it in place.** Re-run the audit script any time to re-confirm; it's read-only and safe to repeat.

This is the single most important line in this document: **the wall is real, and it's verified, not assumed.**

### The gaps, honestly

Ranked by how much they'd actually matter:

0. **Two small loose ends from the 2026-08-01 audit**, both low severity, neither a read leak. (a) `group_associations`' rule only checks `group_id_a` belongs to you, not `group_id_b` — so a hand-crafted API call could link your group to a stranger's. Nothing leaks (reading the other group is still blocked by `groups`' own rule), it just allows junk rows; the app itself never writes that shape. (b) Four INSERT policies (`home_suggestions`, `notes_group_insert`, `photo_connections`, `relationships_insert_own`) showed blank in the audit's read column, because INSERT rules only have a *write* condition. Two of them (`photo_connections`, `relationships_insert_own`) are confirmed correct from their checked-in migration files; the other two have no migration file, so they're **still unverified**. Section 3 of the audit script now prints these — re-run it to close this out. Worst case if one is wrong: someone could create rows owned by another account, which is data being pushed in rather than pulled out. Also worth knowing: `notes` carries six overlapping rules because a note can hang off a person, a moment, or a group. It's correct today, but it's the most intricate rule set in the database — **if a fourth kind of note is ever added, re-run the audit and re-read that group specifically.**
1. **No limit on how fast anyone can use the AI.** Section 1 mostly handles this by removing the strangers. Real rate limiting is still worth adding before beta testers.
2. **Anyone with your Supabase dashboard login can read every note.** That's you today. It stays true for any employee or contractor you ever add. Only real end-to-end encryption changes it — see section 4.
3. **Email confirmation is switched off**, so accounts can be made with addresses that don't exist. Needs turning back on before real users, along with a working confirmation email.
4. **No "delete my account" button and no data export.** The Privacy page already admits both. These stop being a nicety and become a legal requirement (GDPR/CCPA) the moment you have users in Europe or California.
5. **Missing browser security headers.** Standard hardening the site doesn't have yet — protects against a few categories of attack that mostly need one of the above to go wrong first.
6. **The backend accepts requests from any website.** Lower risk than it sounds, because Boomer authenticates with a token rather than a cookie, so a hostile site can't ride your logged-in session. Worth tightening anyway.
7. **Text other people wrote reaches an AI that can write to your database.** Calendar invites and imported contact notes were authored by other people, and they get fed to Claude, which then saves records based on them. Someone could in principle word a calendar invite to manipulate what gets recorded. This corrupts data rather than leaking it, and it's the subtlest thing on this list.

### The one deliberate hole

The Landing page shows total counts across all accounts ("X people, Y events"). That needs a function that can see past the wall, and there is exactly one, called `platform_stats`. It returns four numbers and nothing else, which is what makes it safe to expose publicly.

**It must stay that way.** If it ever gets extended to return actual rows instead of counts, it becomes a public data leak. Query 4 of the audit script exists to confirm it's still the only one of its kind.

---

## 4. End-to-end encryption — the real answer

You asked how apps like Day One do it, and whether Boomer could.

**How they do it:** Day One is a filing cabinet it doesn't have a key to. Your phone scrambles the entry using a key derived from your password, uploads the scrambled version, and the server genuinely cannot read it. Search and "on this day" still work because they run on *your device*, on the readable copy that never leaves it.

**Why Boomer can't, today:** Boomer's whole value is the opposite arrangement. A server-side AI *reads* your notes — that's how you get Key Facts, summaries, and answers to "what's going on with Clare's kids." **Claude cannot read scrambled text.** So full end-to-end encryption and the app you have now are mutually exclusive. It isn't a matter of difficulty. Any app advertising both is either doing its AI on the phone, or the marketing is ahead of the architecture.

Three real options, for when it matters:

**(a) Encrypt the sensitive columns, with a key held outside the database.** The AI still works, because the server unscrambles the text just long enough to use it. Protects you if someone steals a copy of the database — they get gibberish. Does *not* stop you, or anyone with server access, from reading it. Moderate work. **This is the honest middle ground, and it's the one to reach for first.**

**(b) On-device AI in a native iPhone app.** Apple's phone-resident models could do some of this work without the notes ever leaving the device. This is the only path to *genuine* end-to-end encryption that doesn't gut the product — and it only exists on native, which is a real project, not a setting.

**(c) Full end-to-end encryption now.** Technically straightforward. It deletes the app: no chat, no Key Facts, no summaries, no calendar import.

**My recommendation:** don't buy encryption theater. While you're the only person whose notes are in there, this is close to moot. The four things that actually prevent a breach, in order, are: closed signups, two-factor on your own accounts, verified isolation, and backups you've actually tested restoring. Option (a) is worth doing before you let real users in — but after those four, not instead of them.

And keep the Privacy page as honest as it currently is. It explicitly declines to claim end-to-end encryption and explains why. That's already better than most of the market, and it's the kind of thing that's very expensive to walk back later.

---

## 5. The order to do things in

**You, in a browser, this week:**

1. Close public signup (section 1) — five minutes
2. Run the audit script and read the output (section 3) — five minutes
3. Two-factor on Google, GitHub, Supabase (section 2) — one evening
4. Two-factor on the rest (section 2) — whenever

**In code, later, roughly this order:**

5. Whatever the audit turns up, if anything — jumps to the front
6. Browser security headers
7. Rate limiting on the AI endpoints
8. Email confirmation back on, with a working confirmation email
9. "Delete my account" and "download my data"
10. Encryption option (a), before real users
11. Lock the backend down to only accept requests from your own site

Items 6 through 11 are all deferred on purpose, not forgotten. None of them is urgent while you're the only user. All of them should be done before anyone else's memories are in here.
