# Putting Boomer on your phone

_Written 2026-08-01. This replaces the native-iPhone-app plan for now — see the "Why not a real app" section at the bottom for the reasoning._

Boomer is now installable on your iPhone home screen. No App Store, no Mac, no $99/year, no Apple review. It gets an icon, opens full screen with no browser bar, and behaves like an app.

---

## How to install it (on your iPhone)

**This only works in Safari.** Chrome on iOS can't install home-screen apps — Apple doesn't let it. If you normally use Chrome on your phone, you'll need Safari just for this one step.

1. Open **Safari** and go to `https://boomer-app-2-eight.vercel.app/`
2. Log in (worth doing before installing — it'll remember you)
3. Tap the **Share** button — the square with an arrow pointing up, in the bottom bar
4. Scroll down the list and tap **Add to Home Screen**
5. The name will show as **Boomer** — change it here if you like, this is just the label under the icon
6. Tap **Add**

You'll get a dark green icon with a cream "B" on your home screen. Tapping it opens Boomer full screen — no address bar, no Safari tabs.

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
- An App Store listing (you don't want one yet)

If the camera roll ever becomes the thing you actually need, that's the trigger to revisit a real native app — and the note in PROJECT_CONTEXT §9 has the measured cost of doing it.

---

## When you change the app name

The name lives in exactly four places. It's a five-minute job — deliberately, so the pending rename doesn't become a reason to delay.

| File | What to change |
|---|---|
| `index.html` | The `<title>` and the `apple-mobile-web-app-title` meta tag (the home-screen label) |
| `public/manifest.webmanifest` | `name` and `short_name` |
| `scripts/generate-icons.py` | The `LETTER` constant, then re-run it (see below) |
| `src/pages/Landing.tsx` | The visible wordmark in the nav and body copy |

To regenerate the icons after changing the letter:

```
pip install pillow
python3 scripts/generate-icons.py
```

That rewrites all four PNGs in `public/`. Commit them — they're inputs, not build output.

**Anyone who already installed the old icon will need to remove it and re-add it.** Right now that's just you, which is a good reason to not agonise over the name before installing it.

---

## Why there's no service worker (a deliberate choice)

A "service worker" is the piece that lets a web app work offline. Boomer doesn't have one, on purpose.

The reasoning: Boomer can't do anything useful offline anyway — every screen reads from the database and the AI runs on a server, so an offline Boomer would be an empty shell. Meanwhile a service worker's main practical effect here would be **caching an old version of the app and serving it to you after a deploy**, which is a genuinely nasty thing to debug and would land on the one person who can't debug it.

So the trade is: near-zero benefit against a real footgun. Skipping it costs nothing for home-screen installation on iOS, which works without one.

Worth adding later if either of these becomes true: you want the app to open instantly on a bad connection, or you want it installable on Android (Chrome requires a service worker for its install prompt; Safari doesn't).

---

## Why not a real native app

Short version: **Xcode only runs on macOS.** Building and signing an iPhone app requires a Mac, not once but for every single update. You work on a PC and have occasional access to your wife's Mac — that's a favour you'd have to keep asking, not a workflow.

The measured cost, if that ever changes: the backend is 100% reusable no matter which path you take — all 5,306 lines of Edge Functions, the database, auth, every AI prompt. Only the ~20,100 lines of screen code are in question. **Capacitor** would wrap the existing React app essentially as-is (days of work, and a redesign done once in React would flow to both web and phone). **React Native or Swift** would mean rewriting every screen, because all 46 of them are built from web building blocks.

Capacitor is the one to reach for if the day comes. Not before.
