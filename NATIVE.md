# Putting Grove in the App Store

_Written 2026-09-03. This is the pre-flight audit for the Capacitor plan (PROJECT_CONTEXT §9, backlog item 105) — what would break, what it costs, and what to test first. **Nothing here has been built.** No Capacitor dependency, no `ios/` folder, no Apple account. This is the list you'd want in hand before spending anything._

Companion to `PWA.md`, which covers the home-screen version you already have. The PWA stays either way — a store listing adds a way in, it doesn't replace one.

---

## Where this sits

Item 105 is "the calmer mobile shape **and then** App Store," in that order, and it's third in the agreed build order behind 103 and 104. So this audit is not the start of the work — it's the free part, done early, so the redesign knows what it's designing around.

Two things are already cleared and worth remembering: the name is settled (**Grove**, item 102), which mattered because the iOS bundle ID is permanent once a build is uploaded; and the design tokens are extracted into `src/lib/theme.ts` (item 72 step 1), which is what makes a redesign affordable at all.

---

## What a real app actually buys you

Worth being honest about, because it's the reason to spend the money:

| | |
|---|---|
| **Camera roll** | Items 27 and 69. The Google Photos import is today's workaround and it works, but reading the phone's own photos is native-only. This has always been the strongest single argument for going native. |
| **Real-time transcription** | Item 18, and the one genuine loss the PWA takes (`PWA.md`). Apple's live speech recognition is native-only. Today you record, then it transcribes. |
| **Push notifications** | Not actually a native-only feature — iOS 16.4+ gives them to home-screen web apps too. Listed here so it doesn't get counted as a reason to go native when it isn't one. |
| **Face ID on the app itself** | Native-only. Face ID *login* is achievable on the web via passkeys, if that was the real goal. |
| **Not asking people to "add to home screen"** | Your own stated driver: that flow "is not user friendly." A store listing is the fix. |

---

## What breaks, and what fixing it costs

Two things break outright. Both are the same root cause and have the same well-trodden fix.

### 1. "Sign in with Google" stops working

`src/pages/Login.tsx` sends Google a return address of `window.location.origin`. On the web that's `https://boomer-app-2-eight.vercel.app`, which Google accepts. Inside a native wrapper the app is served from **`capacitor://localhost`** — and this can't be configured away: Capacitor won't let the scheme be `http` or `https`, because iOS reserves `https` for real remote websites. Google won't accept a made-up scheme as a return address, so the button fails.

**Not fatal.** Email and password sign-in is in the same file and is completely unaffected, so there's still a working way into the app.

### 2. Google Photos import stops working

`src/lib/googlePhotosAuth.ts` has the same return-address problem, plus a second one: after you approve access, Google sends the phone to `/oauth/google-photos/callback` — a real web address. A bundled app has no web server to answer it, so nothing catches the return.

### The fix for both

Open Google's approval screen in a proper in-app browser, and take the answer back on a **registered custom scheme or a Universal Link** rather than a web address. This is the standard way every native app does Google sign-in; it is not exotic. It is a real piece of work though — a day or two, and it touches Google Cloud settings as well as code, so it wants to be scheduled rather than discovered.

---

## One trap to not walk into

Your `index.html` deliberately leaves out a setting called `viewport-fit=cover`, with a comment explaining why: without it, iOS automatically keeps the web view clear of the bar at the bottom of the screen, which is what stops the chat bar colliding with it. That comment is doing real work — leave it there.

Capacitor does **not** force this setting back on; you'd have to add it yourself to get an edge-to-edge look. So nothing breaks by default. But if the redesign ever wants that full-bleed look, know the bill first: there are **12** pinned-to-the-screen elements in the app and **zero** places that currently account for the phone's rounded corners and home bar. Recent Capacitor makes each one roughly a one-line CSS fix, so it's cheap — it's just not free, and it's not currently budgeted anywhere.

---

## The good news nobody expects

**Every server function already accepts calls from anywhere** (`Access-Control-Allow-Origin: *`, checked across all of `supabase/functions/`). This is normally the thing that breaks first when an app changes address, and it simply won't here. The AI, the transcription, all the imports — none of it notices.

---

## What to test first, on a real device, in this order

Ordered by "how badly does it hurt if this is broken." All three need a Mac, which is the point of writing them down now.

**1. Voice entry.** This is the app's main way in, so if it doesn't work the app doesn't work. The code is already shaped correctly — it prefers one audio format and falls back to the one iPhones use, which is the right call and is already written. What's unproven is whether the wrapper grants microphone permission at all; that needs a line of native configuration, and it either works or it very obviously doesn't.

**2. Does it keep you logged in overnight?** The app uses the default way of remembering your session, which is fine. One specific warning: that memory is tied to the app's address, so **if the address setting is ever changed after launch, everyone gets silently logged out.** Pick it once, write it down, never touch it.

**3. Uploading a contacts file.** The contacts import asks for `.vcf` files specifically. iPhone's file picker is historically unreliable about that kind of filter — the risk is the file you want appears greyed out. Cheap to check, annoying to discover late.

Lower priority: the app's back-button handling is hand-rolled. It works fine inside a session. Opening the app directly to a deep link from a cold start would need work — not urgent while iPhone is the only target.

---

## The two risks no amount of auditing removes

**Apple can reject it for being a website in a wrapper.** This is Guideline 4.2, and it was flagged back on 2026-08-01 — then set aside, because the plan at the time was a PWA and nothing was being submitted. Choosing Capacitor puts it back. Submitting 46 screens built for a mouse, wrapped as-is, is close to the textbook example of what gets rejected. **This is a second, independent reason the redesign comes first** — and shipping at least one genuinely native thing (the camera roll being the obvious one) makes the case much stronger.

**A store listing is public; the plan is not.** §9 says signups stay closed or invite-only, friends and family first, and item 110 (cost metering and a capped free tier) explicitly gates opening signups at all. An App Store listing is public distribution by definition, and App Review will need a working account to test with. That may quietly make item 110 a prerequisite too. It's a decision to make deliberately rather than discover at submission time.

---

## What it costs to run

| | |
|---|---|
| Apple Developer Program | **$99/year**, required before anything can be uploaded |
| Cloud Mac | A monthly rental, for builds and submissions |
| App Review | Days per submission, including updates — a change to the web app is live in minutes; a change to the store version is not |

Worth flagging against your stated **$10–20/month** ceiling: that ceiling was set for other people's AI usage, and this is a separate line. The web app stays free to deploy either way.

---

## Order of operations, when the time comes

1. Items 103 → 104, as agreed.
2. Item 72 step 2 — live on the phone for a week or two, note what actually annoys you. Costs nothing and can happen in parallel.
3. Item 105 / item 72 step 4 — the mobile redesign. This is the expensive step, and the one Apple actually cares about.
4. Apple setup — $99 account, pick a cloud Mac, claim the bundle ID.
5. Fix the two Google sign-in paths above.
6. Capacitor wrap, then test the three things listed above on a real phone.
7. Submit — screenshots, privacy labels (see `SECURITY.md` §4 for what can honestly be claimed), and a demo account for review.

Steps 4 through 7 are days. Step 3 is weeks. The paperwork is not the hard part.
