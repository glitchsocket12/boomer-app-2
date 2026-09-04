# Putting Grove on your phone

_Written 2026-08-01, still current. This replaced the native-iPhone-app plan at the time; **that call was reversed on 2026-08-22** — a real App Store app is back on, via Capacitor and a rented cloud Mac (`NATIVE.md`). Everything below still stands: the home-screen version is what you use today, and it stays after a store listing exists._

Grove is now installable on your iPhone home screen. No App Store, no Mac, no $99/year, no Apple review. It gets an icon, opens full screen with no browser bar, and behaves like an app.

---

## How to install it (on your iPhone)

**This only works in Safari.** Chrome on iOS can't install home-screen apps — Apple doesn't let it. If you normally use Chrome on your phone, you'll need Safari just for this one step.

1. Open **Safari** and go to `https://boomer-app-2-eight.vercel.app/`
2. Log in (worth doing before installing — it'll remember you)
3. Tap the **Share** button — the square with an arrow pointing up, in the bottom bar
4. Scroll down the list and tap **Add to Home Screen**
5. The name will show as **Grove** — change it here if you like, this is just the label under the icon
6. Tap **Add**

You'll get a dark green icon with a cream "B" on your home screen. Tapping it opens Grove full screen — no address bar, no Safari tabs.

**One thing that surprises people:** the installed app has its own separate login from Safari. If it asks you to log in again the first time, that's expected, and it should be the only time.

---

## What you get, and what you don't

**You get:**

- An icon on your home screen, opening full screen
- Voice entry — this already works well on iPhone because Whisper was chosen over the browser's built-in speech recognition specifically for this reason (PROJECT_CONTEXT §2, decided long before this)
- Everything else the app does, exactly as it does on your laptop
- Instant updates — when you push to `main`, the phone gets it on next open. No app store review, no waiting

**You don't get:**

- Direct camera-roll access (the Google Photos import is the workaround, and it already works)
- Push notifications — technically possible for installed apps on iOS 16.4+, but nothing is wired up for it yet
- Face ID lock on the app itself
- An App Store listing (decided 2026-08-22 that you do want one — not built yet, see `NATIVE.md`)

If the camera roll ever becomes the thing you actually need, that's the trigger to revisit a real native app — and the note in PROJECT_CONTEXT §9 has the measured cost of doing it.

---

## Known: it isn't designed for a phone yet

Opening the installed app on a real iPhone (2026-08-01) surfaced three things. Two were outright bugs and are fixed; the third is the redesign and is deliberately untouched.

**Fixed — hover-only controls were unreachable.** Thirteen controls across five screens only appeared on mouse-hover: the "×" to remove a group member, an event attendee, a tag or an associated group, the relationship remove on the family tree, and edit/delete on note cards. A touchscreen can't hover, so those features existed but could not be used at all from a phone. `src/lib/touch.ts` now detects a no-hover device once (`matchMedia('(hover: none)')`, so a touchscreen laptop keeps the tidy hover behaviour) and every one of those renders on `hovered || IS_TOUCH`.

**Fixed — iOS zoomed the page whenever you tapped a text box.** Safari force-zooms any input under 16px and doesn't zoom back out; seven inputs sat between 0.85rem and 0.95rem. `index.css` now floors input/textarea/select at 16px on touch devices only.

**Safety, because of the first fix:** those delete buttons are 18px with a 10px icon, sized for a mouse, and note deletion is permanent with no confirmation. Always-visible + tiny + irreversible is how you lose a note to a stray thumb. They now get a 32px minimum target on touch (`.touch-action`), and deleting a note asks first. Apple's guideline is 44px — 32px is a compromise because these sit inside chips, and it's the redesign's job to do better.

**NOT fixed — everything is still too small.** Body text is mostly 0.85–0.9rem and the layout is built for a mouse. That's a real redesign, not a patch, and doing it piecemeal would mean doing it twice. Left alone on purpose.

---

## What the backlog loses by not going native

Checked against §8's open items on 2026-08-01, so it doesn't get re-derived later.

| Backlog item | Status on a PWA |
|---|---|
| **18. Real-time voice transcription** | **The one genuine loss.** Apple's live speech recognition is native-only, and the item's own note already rules out the web option on iPhone. Recording-then-transcribing (today's Whisper flow) stays the only option. |
| **27 / 69. Camera-roll sync + photo rollups** | Already documented as native-only. Google Photos import is the existing workaround and is unaffected. |
| **65. iPhone Contacts import** | Native could read Contacts directly; the shipped vCard export-and-upload path already sidesteps this. No new loss. |
| Face ID lock on the app | Native-only. Face ID *login* is achievable in a PWA via passkeys, if that was the actual goal. |
| On-device AI (→ real E2EE, `SECURITY.md` §4) | Native-only. Long-term, not near-term. |
| **17. Long story/voice-note handling** | Works, with one catch: iOS stops the recording if you switch apps mid-way. Fine for talking directly into it, not for background capture. |
| 14/30 search, 20 data viz, 21 internet lookup, 26 ratings, 31 memory lane, 58–60 UI fixes | Unaffected — all web or server-side. |
| 15's background group-connection scanning, calendar sync | Unaffected — these run server-side (`pg_cron` + Edge Functions), not on the device. |

**One thing better than §9 assumes:** §9 records "email over push (scope)", which reads like a platform limit. It isn't — Apple added Web Push for home-screen-installed web apps in iOS 16.4 (2023). Push is available to this PWA whenever it's worth building; nothing about it requires going native.

---

## When you change the app name

**This section used to claim the name lived in "exactly four places" and called it a five-minute job. That was wrong, and the Boomer → Grove rename on 2026-08-22 is what proved it: the real spread was 85 occurrences across 34 files.** Four places is the app's *identity*; the name is also a word the product and its AI say constantly. Corrected inventory:

| Where | What to change |
|---|---|
| `index.html` | The `<title>` and the `apple-mobile-web-app-title` meta tag (the home-screen label) |
| `public/manifest.webmanifest` | `name` and `short_name` |
| `scripts/generate-icons.py` | The `LETTER` constant, then re-run it (see below) |
| `public/favicon.svg` | The letterform in the tab icon |
| `src/` — 22 files, ~60 hits | Visible copy. `Landing.tsx` is heaviest (11), then `GenderFill.tsx` (9), `Onboarding.tsx` (8), `demo/DemoIntro.tsx` (7), `NotebookDetail.tsx` (6). Read each one — some are the product's name and some are the assistant's name mid-sentence, and they don't all survive the same replacement |
| `supabase/functions/` — 10 files | **The AI's name for itself**, inside the prompts. Each one has to be redeployed; a rename that skips this leaves the chat introducing itself by the old name |
| `PROJECT_CONTEXT.md`, `PWA.md`, `SECURITY.md` | Current-state docs follow the name. `PROJECT_HISTORY.md` deliberately does NOT — its dated entries keep whatever the product was called at the time |

**What must NOT be renamed:** lowercase `boomer` is never the product name in this repo. It is the `boomer-nav` session-storage key, the Google Photos OAuth state key, the live Vercel hostname, memory-file references in comments, and one test fixture. Renaming those breaks things and renames nothing.

**One-time cost worth expecting:** the prompt strings sit in the *stable* prefix of the system prompts, so the first AI call after deploy pays a full uncached prompt (CLAUDE.md rule 3). That's one call, not a regression.

To regenerate the icons after changing the letter:

```
pip install pillow
python3 scripts/generate-icons.py
```

That rewrites all four PNGs in `public/`. Commit them — they're inputs, not build output.

**If that script fails on Windows:** it did, until 2026-08-22 — its font list held only Linux paths, so it died on "No serif font found," and there is no `python` on this machine either. Windows paths (Georgia Bold, which is the app's own type face) are now first in `FONT_CANDIDATES`. The Grove icons were generated a different way entirely, which is worth knowing as a fallback: a throwaway HTML page rendered the same geometry on a `<canvas>` in the browser preview and POSTed the PNGs to a tiny local Node server that wrote them to `public/`. No Python, no image library.

**Anyone who already installed the old icon will need to remove it and re-add it.** Right now that's just you, which is a good reason to not agonise over the name before installing it.

---

## Why there's no service worker (a deliberate choice)

A "service worker" is the piece that lets a web app work offline. Grove doesn't have one, on purpose.

The reasoning: Grove can't do anything useful offline anyway — every screen reads from the database and the AI runs on a server, so an offline Grove would be an empty shell. Meanwhile a service worker's main practical effect here would be **caching an old version of the app and serving it to you after a deploy**, which is a genuinely nasty thing to debug and would land on the one person who can't debug it.

So the trade is: near-zero benefit against a real footgun. Skipping it costs nothing for home-screen installation on iOS, which works without one.

Worth adding later if either of these becomes true: you want the app to open instantly on a bad connection, or you want it installable on Android (Chrome requires a service worker for its install prompt; Safari doesn't).

---

## Why not a real native app

> **Superseded 2026-08-22 — kept for the reasoning, which is still sound.** The founder decided to go native after all, via **Capacitor + a rented cloud Mac**: renting a Mac removes the one constraint this section is built on. See `NATIVE.md` for the pre-flight audit and PROJECT_CONTEXT §9 / item 105 for where it sits in the build order. The PWA below stays either way.

Short version: **Xcode only runs on macOS.** Building and signing an iPhone app requires a Mac, not once but for every single update. You work on a PC and have occasional access to your wife's Mac — that's a favour you'd have to keep asking, not a workflow.

The measured cost, if that ever changes: the backend is 100% reusable no matter which path you take — all 5,306 lines of Edge Functions, the database, auth, every AI prompt. Only the ~20,100 lines of screen code are in question. **Capacitor** would wrap the existing React app essentially as-is (days of work, and a redesign done once in React would flow to both web and phone). **React Native or Swift** would mean rewriting every screen, because all 46 of them are built from web building blocks.

Capacitor is the one to reach for if the day comes. Not before.
