import { Suspense, lazy, useEffect, useRef, useState, type ReactElement } from 'react'
import { HomeIcon, PeopleIcon, EventsIcon, CalendarIcon, GroupsIcon, SearchIcon } from './components/NavIcons'
import { supabase } from './lib/supabase'
import GlobalSearch from './components/GlobalSearch'
import { cachedSearchCorpus, clearSearchCorpus, isSearchCorpusStale, loadSearchCorpus } from './lib/searchCorpus'
import type { SearchDoc, SearchTarget } from './lib/globalSearch'
import Landing from './pages/Landing'
import Login from './pages/Login'
import { ensureSelfPersonFromSignupMetadata } from './lib/ensureSelfFromSignup'
import { ensureStarterTags } from './lib/ensureStarterTags'
import { ensureUserTimeZone } from './lib/ensureUserTimeZone'
import { DEFAULT_EVENT_FILTERS, type EventFilters } from './lib/eventFilters'
import ErrorBoundary from './components/ErrorBoundary'
import Breadcrumb from './components/Breadcrumb'
import FeedbackWidget from './components/FeedbackWidget'
import ChoiceSheet from './components/ChoiceSheet'
import { border, colors, fontFamily, fontSize, radius, shadow, space } from './lib/theme'

// --- Code splitting ------------------------------------------------------------------------------
//
// Every page used to be a static import, so the whole app — all 41 screens, the demo's fixture data,
// the family-tree renderer — shipped as ONE 1.12MB JavaScript file that a phone had to download and
// parse before it could paint anything (founder report 2026-08-17). Each page is now its own chunk,
// fetched the first time it's actually opened.
//
// Landing and Login stay STATIC on purpose: they're the logged-out first paint, so lazy-loading them
// would just add a round trip to the exact moment being optimized. Home is lazy but prefetched as
// soon as the app knows there's a session (see the prefetch effect below), so it overlaps with the
// auth round trip rather than queueing behind it.
//
// Chunks are content-hashed and immutable, so this costs a fetch only on a cold cache, and a page
// the founder never opens is never downloaded at all.
const DemoShell = lazy(() => import('./pages/demo/DemoShell'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const Home = lazy(() => import('./pages/Home'))
const People = lazy(() => import('./pages/People'))
const Events = lazy(() => import('./pages/Events'))
const Calendar = lazy(() => import('./pages/Calendar'))
const Groups = lazy(() => import('./pages/Groups'))
const GroupDetail = lazy(() => import('./pages/GroupDetail'))
const PetDetail = lazy(() => import('./pages/PetDetail'))
const EventDetail = lazy(() => import('./pages/EventDetail'))
const PersonDetail = lazy(() => import('./pages/PersonDetail'))
const DunbarDetail = lazy(() => import('./pages/DunbarDetail'))
const DueForUpdate = lazy(() => import('./pages/DueForUpdate'))
const ManageTags = lazy(() => import('./pages/ManageTags'))
const ManageLocations = lazy(() => import('./pages/ManageLocations'))
const GenderFill = lazy(() => import('./pages/GenderFill'))
const ManageGroupTypes = lazy(() => import('./pages/ManageGroupTypes'))
const Circle = lazy(() => import('./pages/Circle'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const CalendarSettings = lazy(() => import('./pages/CalendarSettings'))
const PhotoImportReview = lazy(() => import('./pages/PhotoImportReview'))
const GooglePhotosOAuthCallback = lazy(() => import('./pages/GooglePhotosOAuthCallback'))
const ImportReview = lazy(() => import('./pages/ImportReview'))
const BirthdayImportReview = lazy(() => import('./pages/BirthdayImportReview'))
const ContactsImport = lazy(() => import('./pages/ContactsImport'))
const ContactSelection = lazy(() => import('./pages/ContactSelection'))
const ContactImportReview = lazy(() => import('./pages/ContactImportReview'))
const About = lazy(() => import('./pages/About'))
const Privacy = lazy(() => import('./pages/Privacy'))
const FamilyTree = lazy(() => import('./pages/FamilyTree'))

// Shown while a lazily-loaded page's chunk is in flight. Deliberately the exact "Loading…" the app
// already shows while resolving the session, so a cold-cache page open reads as the same kind of
// wait the app has always had rather than a new kind of flash.
const pageFallback = <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>

type Tab = 'home' | 'people' | 'events' | 'calendar' | 'groups'
type AuthView = 'landing' | 'login' | 'signup' | 'demo'
type Crumb =
  | { type: 'person'; id: string; label: string }
  // displayLabel is what breadcrumbs and "← Back to …" SHOW; label stays the record's real name.
  // Only groups set it, so a subgroup reads "Parent / Child" in the trail without that qualified
  // string ever feeding back into GroupDetail's heading or rename field (which read `label`).
  | { type: 'group'; id: string; label: string; displayLabel?: string }
  | { type: 'event'; id: string; label: string }
  | { type: 'pet'; id: string; label: string }
  | { type: 'dunbar'; id: string; label: string }
  | { type: 'nudges'; id: string; label: string }
  | { type: 'manageTags'; id: string; label: string }
  | { type: 'manageLocations'; id: string; label: string }
  | { type: 'manageGroupTypes'; id: string; label: string }
  | { type: 'genderFill'; id: string; label: string }
  | { type: 'circle'; id: string; label: string }
  | { type: 'familyTree'; id: string; label: string; memberIds?: string[] }
  | { type: 'settings'; id: string; label: string }
  | { type: 'calendarSettings'; id: string; label: string }
  | { type: 'photoImport'; id: string; label: string }
  | { type: 'importReview'; id: string; label: string }
  | { type: 'birthdayReview'; id: string; label: string }
  | { type: 'contactsImport'; id: string; label: string }
  | { type: 'contactSelection'; id: string; label: string }
  | { type: 'contactImportReview'; id: string; label: string }
  | { type: 'about'; id: string; label: string }
  | { type: 'privacy'; id: string; label: string }

const TAB_LABELS: Record<Tab, string> = { home: 'Home', people: 'People', events: 'Events', calendar: 'Calendar', groups: 'Groups' }

const CRUMB_TYPES = [
  'person',
  'group',
  'event',
  'pet',
  'dunbar',
  'nudges',
  'manageTags',
  'manageLocations',
  'manageGroupTypes',
  'genderFill',
  'circle',
  'familyTree',
  'settings',
  'calendarSettings',
  'photoImport',
  'importReview',
  'birthdayReview',
  'contactsImport',
  'contactSelection',
  'contactImportReview',
  'about',
  'privacy',
]

// Crumb types that are single fixed pages rather than records with a real id (their `id` is
// just a copy of `type`, e.g. `{ type: 'circle', id: 'circle' }`) — the URL only needs one
// segment for these, not a `/type/id` pair.
const SINGLETON_CRUMB_TYPES = new Set(['dunbar', 'nudges', 'manageTags', 'manageLocations', 'manageGroupTypes', 'genderFill', 'circle', 'settings', 'calendarSettings', 'photoImport', 'about', 'privacy'])

const AUTH_VIEWS = new Set<AuthView>(['landing', 'login', 'signup', 'demo'])

// Logged-out screens (Landing/Login/Signup/Demo) live at their own /:authView path, parsed the
// same lossy way as buildPath/parseNavFromPath below — real state restore comes from
// history.state where available (see popstate handling), this is just the fallback for a fresh
// direct load/link.
function parseAuthViewFromPath(pathname: string): AuthView | null {
  const first = pathname.split('/').filter(Boolean)[0]
  return first && AUTH_VIEWS.has(first as AuthView) ? (first as AuthView) : null
}

// Where-you-are is plain React state, so a browser refresh used to reset to Home.
// Persist it per browser tab (sessionStorage) so refreshing stays on the current page.
const NAV_STORAGE_KEY = 'boomer-nav'

// Address bar mirror of {view, navStack} — /:tab, or /:crumbType/:crumbId chained per crumb
// (crumbs replace the tab entirely while any are pushed, matching how `content` already ignores
// `view` whenever navStack is non-empty). This is a DISPLAY/back-button aid, not the source of
// truth for a same-tab refresh — sessionStorage (full crumb objects, real labels) still owns
// that. Real full-fidelity restore for browser Back/Forward comes from history.state (see
// popstate handling below); this function only reconstructs the lossy fallback for a case with
// no history.state to read — a freshly pasted/shared link, or sessionStorage cleared mid-session.
function buildPath(view: Tab, navStack: Crumb[]): string {
  if (navStack.length === 0) return `/${view}`
  return navStack
    .map((c) => (SINGLETON_CRUMB_TYPES.has(c.type) ? `/${c.type}` : `/${c.type}/${encodeURIComponent(c.id)}`))
    .join('')
}

function parseNavFromPath(pathname: string): { view: Tab; navStack: Crumb[] } | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return { view: 'home', navStack: [] }
  if (segments.length === 1 && segments[0] in TAB_LABELS) {
    return { view: segments[0] as Tab, navStack: [] }
  }
  const navStack: Crumb[] = []
  let i = 0
  while (i < segments.length) {
    const type = segments[i]
    if (!CRUMB_TYPES.includes(type)) return null
    if (SINGLETON_CRUMB_TYPES.has(type)) {
      // Labels can't be recovered from a bare URL (see below) — singleton pages don't have a
      // separate id segment to fall back on either, so reuse the type as both.
      navStack.push({ type, id: type, label: type } as unknown as Crumb)
      i += 1
      continue
    }
    if (i + 1 >= segments.length) return null
    const id = decodeURIComponent(segments[i + 1])
    // Labels can't be recovered from a bare URL — every detail page already re-fetches its own
    // data by id, so this only affects the breadcrumb/back-button TEXT in this fallback path,
    // not whether the page itself loads correctly.
    navStack.push({ type, id, label: id } as unknown as Crumb)
    i += 2
  }
  return navStack.length > 0 ? { view: 'home', navStack } : null
}

function restoreNav(): { view: Tab; navStack: Crumb[] } {
  const fallback = { view: 'home' as Tab, navStack: [] as Crumb[] }
  try {
    const raw = sessionStorage.getItem(NAV_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.view in TAB_LABELS) {
        const stack = Array.isArray(parsed.navStack)
          ? parsed.navStack.filter(
              (c: Crumb) => c && CRUMB_TYPES.includes(c.type) && typeof c.id === 'string' && typeof c.label === 'string'
            )
          : []
        return { view: parsed.view, navStack: stack }
      }
    }
  } catch {
    // fall through to the URL-based fallback below
  }
  return parseNavFromPath(window.location.pathname) ?? fallback
}

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  // Avatar initials/label for the account menu — prefers the real self person's name (kept in
  // sync with however they've actually set it up, e.g. via PersonDetail), falling back to the
  // auth email for an account that hasn't finished onboarding yet.
  const [accountLabel, setAccountLabel] = useState<{ initials: string; name: string } | null>(null)
  const [authView, setAuthView] = useState<AuthView>(() => parseAuthViewFromPath(window.location.pathname) ?? 'landing')
  // null = still checking, true = show the standalone onboarding experience instead of the app
  // shell. Gated on two signals together: the account hasn't already finished/skipped onboarding
  // (auth user_metadata, set by Onboarding.tsx on completion) AND it doesn't already have real
  // data (people beyond the self profile) — the second check keeps every pre-existing account
  // (no metadata flag at all) from suddenly being routed into onboarding.
  const [onboardingPending, setOnboardingPending] = useState<boolean | null>(null)
  const [view, setView] = useState<Tab>(() => restoreNav().view)
  const [navStack, setNavStack] = useState<Crumb[]>(() => restoreNav().navStack)
  // Groups' own search/type-filter state, lifted up here instead of living inside Groups.tsx —
  // Groups unmounts whenever a crumb is pushed (e.g. clicking into a group), so state that lived
  // only inside it reset every time the in-page back arrow returned you to the list.
  const [groupsSearch, setGroupsSearch] = useState('')
  const [groupsTypeFilter, setGroupsTypeFilter] = useState('all')
  // Events' own filter state, lifted up here for the same reason as Groups' search/type-filter
  // above — Events unmounts whenever a crumb is pushed (e.g. clicking into an event), so filters
  // that lived only inside it would reset every time the in-page back arrow returned to the list.
  const [eventsFilters, setEventsFilters] = useState<EventFilters>(DEFAULT_EVENT_FILTERS)
  // Scroll position the Groups list was at right before navigating into a group — null except in
  // the brief window between leaving the list and returning to it via its own back arrow. Cleared
  // on a direct tab click (goToTab) so only that back-arrow round trip restores scroll, not every
  // way of landing on the Groups tab.
  const groupsScrollRef = useRef<number | null>(null)
  // Global search (backlog item 14). The corpus lives in lib/searchCorpus.ts' module cache; this is
  // just the copy the panel renders, so opening the panel never waits on a round trip once a
  // session has loaded it once.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchDocs, setSearchDocs] = useState<SearchDoc[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  // A question typed into search and handed off to Home chat. Held here rather than passed through
  // a crumb because it's a one-shot instruction, not a place you can navigate back to.
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)
  // Guards against re-pushing a history entry for a state change that itself came FROM a
  // popstate (browser Back/Forward) — otherwise every Back press would immediately push a
  // matching Forward entry right back on top of it.
  const skipNextHistoryPush = useRef(false)

  useEffect(() => {
    // Still resolving auth — we don't yet know whether to treat this as logged-out (authView)
    // or logged-in (view/navStack) routing, so leave whatever path a direct load/refresh arrived
    // on untouched rather than guessing and clobbering a legitimate deep link.
    if (checkingSession) return

    if (skipNextHistoryPush.current) {
      skipNextHistoryPush.current = false
      return
    }

    let path: string
    if (!session) {
      path = `/${authView}`
    } else if (onboardingPending) {
      path = '/onboarding'
    } else {
      sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ view, navStack }))
      path = buildPath(view, navStack)
    }
    if (path !== window.location.pathname) {
      window.history.pushState({ authView, view, navStack }, '', path)
    }
  }, [checkingSession, session, authView, onboardingPending, view, navStack])

  useEffect(() => {
    // Sync the CURRENT history entry's state on mount (a plain replace of STATE only, not the
    // path) so Back/Forward has full-fidelity state to restore from immediately, not just
    // whatever the effect above would otherwise push once auth resolves. Deliberately leaves
    // window.location.pathname exactly as loaded — session hasn't resolved yet at mount time, so
    // rewriting the path here could clobber a legitimate authenticated deep link before we know
    // whether the visitor is actually logged in.
    const authFromPath = parseAuthViewFromPath(window.location.pathname)
    const parsedApp = parseNavFromPath(window.location.pathname)
    const state = authFromPath
      ? { authView: authFromPath }
      : { view: parsedApp?.view ?? view, navStack: parsedApp?.navStack ?? navStack }
    // No url argument — replaces STATE only, truly leaving the current URL untouched (including
    // its query string). Passing `window.location.pathname` here used to silently strip any
    // `?...` search params on mount (e.g. Google's `?code=...&state=...` on the OAuth callback
    // redirect), even though the comment above already says "not the path" — this now actually
    // does that.
    window.history.replaceState(state, '')

    function handlePopState(e: PopStateEvent) {
      skipNextHistoryPush.current = true
      const state = e.state as { authView?: AuthView; view?: Tab; navStack?: Crumb[] } | null
      if (state?.authView) {
        setAuthView(state.authView)
        return
      }
      if (state?.view) {
        setView(state.view)
        setNavStack(Array.isArray(state.navStack) ? state.navStack : [])
        return
      }
      const authFromPathNow = parseAuthViewFromPath(window.location.pathname)
      if (authFromPathNow) {
        setAuthView(authFromPathNow)
        return
      }
      const parsed = parseNavFromPath(window.location.pathname)
      setView(parsed?.view ?? 'home')
      setNavStack(parsed?.navStack ?? [])
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Start pulling Home's chunk NOW, before the session round trip below has answered. A returning
    // founder lands on Home essentially every time, so this overlaps the download with the auth
    // wait instead of starting it once the shell is already on screen. `import()` de-dupes, so the
    // real render below reuses this exact request rather than issuing a second one; a logged-out
    // visitor wastes one background fetch, which is why only Home gets this and not every page.
    import('./pages/Home')

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setCheckingSession(false)
      checkOnboarding(session)
      // Also covers a restored session, not just a fresh sign-in — onAuthStateChange's SIGNED_IN
      // event never re-fires for a persisted session, so an account that stayed logged in across
      // this feature's rollout would otherwise never get its time zone detected (own internal
      // `timezone_detected` flag makes this a no-op after the first successful run either way).
      if (session?.user) ensureUserTimeZone(session.user.id, session.user.user_metadata ?? {})
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_IN' && session?.user) {
        ensureSelfPersonFromSignupMetadata(session.user.id, session.user.user_metadata ?? {})
        ensureStarterTags(session.user.id, session.user.user_metadata ?? {})
        ensureUserTimeZone(session.user.id, session.user.user_metadata ?? {})
      }
      if (event === 'SIGNED_OUT') {
        // Drop the stale authenticated route so a later login (possibly a different account on
        // a shared device) starts fresh instead of resuming wherever this session left off.
        setView('home')
        setNavStack([])
        setAuthView('landing')
        setGroupsSearch('')
        setGroupsTypeFilter('all')
        groupsScrollRef.current = null
        // One account's memories must never be searchable from the next one's session on a shared
        // device — this cache holds names and note text, not just ids.
        clearSearchCorpus()
        setSearchDocs(null)
        setSearchOpen(false)
        sessionStorage.removeItem(NAV_STORAGE_KEY)
        // Replace (not push) so Back doesn't return to the authenticated trail post-logout.
        skipNextHistoryPush.current = true
        window.history.replaceState({ authView: 'landing' }, '', '/landing')
      }
      checkOnboarding(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // The app's first keyboard shortcut. `/` is the one people reach for, Cmd/Ctrl-K the one they
  // bring from other tools.
  useEffect(() => {
    if (!session) return
    function onKeyDown(e: KeyboardEvent) {
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (!cmdK && e.key !== '/') return
      // Bare `/` is a real character. Without this guard, typing a date or a URL into any note box
      // in the app would yank focus out of it and open search instead. Cmd-K isn't ambiguous, so
      // it works from anywhere. Same activeElement check FloatingActionBubble uses for Escape.
      if (!cmdK) {
        const el = document.activeElement
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable) return
      }
      e.preventDefault()
      openSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Isolated from the main session effect above on purpose — same "don't take the whole shell
  // down over one field" reasoning as PersonDetail.tsx's gender/contact-info queries (see
  // project_boomer_infra.md): the avatar is cosmetic, so a missing self person or a slow query
  // just leaves it on the email-initials fallback rather than blocking anything.
  useEffect(() => {
    if (!session?.user) {
      setAccountLabel(null)
      return
    }
    let cancelled = false
    supabase
      .from('people')
      .select('name, last_name')
      .eq('is_self', true)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data?.name) {
          const initials = `${data.name[0] ?? ''}${data.last_name?.[0] ?? ''}`.toUpperCase() || '?'
          setAccountLabel({ initials, name: [data.name, data.last_name].filter(Boolean).join(' ') })
        } else {
          const email = session.user.email ?? ''
          setAccountLabel({ initials: email.slice(0, 2).toUpperCase() || '?', name: email })
        }
      })
    return () => {
      cancelled = true
    }
  }, [session?.user?.id])

  async function checkOnboarding(session: any) {
    if (!session?.user) {
      setOnboardingPending(false)
      return
    }
    const meta = session.user.user_metadata ?? {}
    if (meta.onboarding_complete) {
      setOnboardingPending(false)
      return
    }
    // Once onboarding has actually started, trust that sticky server-side flag instead of
    // re-deriving from the people count below — Stage 2 (the tree) writes real people rows
    // partway through, so "zero non-self people" stops being a valid signal the moment the
    // user adds their first relative, well before they've finished or skipped onboarding.
    // Without this, a tab getting backgrounded and remounted mid-onboarding would silently and
    // permanently boot the user to Home instead of resuming onboarding.
    if (meta.onboarding_started) {
      setOnboardingPending(true)
      return
    }
    const { count } = await supabase.from('people').select('id', { count: 'exact', head: true }).eq('is_self', false)
    const shouldStart = (count ?? 0) === 0
    setOnboardingPending(shouldStart)
    if (shouldStart) {
      // Silent-failure house bug (see PROJECT_CONTEXT §12): this write is the whole reason the
      // sticky flag works at all — if it silently fails, the next load falls right back through
      // to this same "zero people" re-derivation, which is exactly what it exists to avoid.
      const { error } = await supabase.auth.updateUser({ data: { onboarding_started: true } })
      if (error) console.error('Failed to persist onboarding_started', error)
    }
  }

  function goToTab(tab: Tab) {
    groupsScrollRef.current = null
    setView(tab)
    setNavStack([])
  }

  /**
   * Stale-while-revalidate: hand over whatever is already cached so the panel renders instantly,
   * and re-read in the background. That's what makes "add a person, search for them straight away"
   * work without an invalidate() call at every write site in the app.
   *
   * `always` is the difference between opening the panel and merely hovering the button. Opening
   * revalidates unconditionally — a 30-second grace period sounds harmless until someone adds a
   * person and searches for them twenty seconds later, which is exactly the case this cache exists
   * to get right. Hovering respects the floor, so sweeping the mouse across the nav can't spam the
   * network. Concurrent calls collapse onto one request inside loadSearchCorpus.
   *
   * If the full re-read ever turns out to be slow on a real phone, the cheap fix is a head-only
   * count check per table before committing to it — not a longer grace period.
   */
  function refreshSearchCorpus(always: boolean) {
    const cached = cachedSearchCorpus()
    if (cached) setSearchDocs(cached)
    if (!always && !isSearchCorpusStale()) return
    setSearchLoading(true)
    loadSearchCorpus()
      .then(({ docs, error }) => {
        if (error) console.error('Search corpus load failed', error)
        setSearchDocs(docs)
      })
      .finally(() => setSearchLoading(false))
  }

  function openSearch() {
    setSearchOpen(true)
    refreshSearchCorpus(true)
  }

  function handleSearchSelect(target: SearchTarget) {
    switch (target.kind) {
      case 'person':
        return pushCrumb({ type: 'person', id: target.id, label: target.label })
      case 'pet':
        return pushCrumb({ type: 'pet', id: target.id, label: target.label })
      case 'event':
        return pushCrumb({ type: 'event', id: target.id, label: target.label })
      case 'group':
        return pushCrumb({ type: 'group', id: target.id, label: target.label })
      // A tag isn't a page of its own — it's a filter on the Events list, which is where someone
      // searching for one actually wants to end up. tagFilter matches on the tag's NAME.
      case 'tag':
        setEventsFilters({ ...DEFAULT_EVENT_FILTERS, tagFilter: target.label })
        return goToTab('events')
    }
  }

  function handleAsk(question: string) {
    setPendingAsk(question)
    goToTab('home')
  }

  function pushCrumb(crumb: Crumb) {
    setNavStack((s) => {
      const existingIndex = s.findIndex((c) => c.type === crumb.type && c.id === crumb.id)
      if (existingIndex !== -1) {
        return [...s.slice(0, existingIndex), crumb]
      }
      return [...s, crumb]
    })
  }

  function popCrumb() {
    setNavStack((s) => s.slice(0, -1))
  }

  function jumpTo(index: number) {
    setNavStack((s) => s.slice(0, index + 1))
  }

  // After a merge, the current crumb's id points at a now-deleted record — replace it in
  // place with the surviving one so the breadcrumb and back button land somewhere real,
  // instead of pushing a new crumb on top of a dead one.
  function replaceCurrentCrumb(crumb: Crumb) {
    setNavStack((s) => (s.length === 0 ? s : [...s.slice(0, -1), crumb]))
  }

  function renameCurrentCrumb(newLabel: string) {
    setNavStack((s) => (s.length === 0 ? s : [...s.slice(0, -1), { ...s[s.length - 1], label: newLabel }]))
  }

  // A detail page reporting the label it wants SHOWN, which can differ from the record's own name
  // (a subgroup shows "Parent / Child"). Kept separate from renameCurrentCrumb so the crumb's
  // `label` — the string that comes back down as the page's own name — is never overwritten.
  // Bails when unchanged so the reporting effect can't loop.
  function setCurrentCrumbDisplayLabel(displayLabel: string) {
    setNavStack((s) => {
      const last = s[s.length - 1]
      if (!last || last.type !== 'group' || last.displayLabel === displayLabel) return s
      return [...s.slice(0, -1), { ...last, displayLabel }]
    })
  }

  if (checkingSession) {
    return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>
  }

  // Google's OAuth consent screen redirects back here — handled before the normal view/crumb
  // routing since it isn't a real app page, just a one-time round trip (see
  // GooglePhotosOAuthCallback.tsx for why a plain reload-to-"/" on success is enough to land the
  // user back where they started).
  if (window.location.pathname === '/oauth/google-photos/callback') {
    return <Suspense fallback={pageFallback}>{<GooglePhotosOAuthCallback />}</Suspense>
  }

  if (!session) {
    if (authView === 'landing') {
      return <Landing onAuthClick={(mode) => setAuthView(mode)} />
    }
    if (authView === 'demo') {
      return (
        <Suspense fallback={pageFallback}>
          <DemoShell onExit={() => setAuthView('landing')} onSignUp={() => setAuthView('signup')} />
        </Suspense>
      )
    }
    return (
      <Login
        isSignUp={authView === 'signup'}
        onToggleMode={() => setAuthView(authView === 'signup' ? 'login' : 'signup')}
        onBack={() => setAuthView('landing')}
      />
    )
  }

  if (onboardingPending === null) {
    return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>
  }
  if (onboardingPending) {
    return (
      <Suspense fallback={pageFallback}>
        <Onboarding onComplete={() => setOnboardingPending(false)} />
      </Suspense>
    )
  }

  const current = navStack[navStack.length - 1] ?? null
  // Everything the founder READS (breadcrumb trail, "← Back to …", the feedback widget's page
  // name) goes through this; anything a page consumes as a record's own name uses `label`.
  const shownLabel = (crumb: Crumb) => ('displayLabel' in crumb && crumb.displayLabel) || crumb.label
  const parentLabel = navStack.length >= 2 ? shownLabel(navStack[navStack.length - 2]) : TAB_LABELS[view]
  const feedbackPageLabel = current ? shownLabel(current) : TAB_LABELS[view]

  const breadcrumbItems =
    navStack.length > 0
      ? [
          { label: 'Home', onClick: () => goToTab('home') },
          ...(view !== 'home' ? [{ label: TAB_LABELS[view], onClick: () => setNavStack([]) }] : []),
          ...navStack.map((crumb, i) =>
            i === navStack.length - 1 ? { label: shownLabel(crumb) } : { label: shownLabel(crumb), onClick: () => jumpTo(i) }
          ),
        ]
      : null

  let content
  if (current?.type === 'person') {
    content = (
      <PersonDetail
        personId={current.id}
        personName={current.label}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
        onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
        onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
        onSelectPet={(p) => pushCrumb({ type: 'pet', id: p.id, label: p.name })}
        onMerged={(p) => replaceCurrentCrumb({ type: 'person', id: p.id, label: p.name })}
        onRenamed={renameCurrentCrumb}
        onOpenFamilyTree={(personId, label, memberIds) => pushCrumb({ type: 'familyTree', id: personId, label, memberIds })}
      />
    )
  } else if (current?.type === 'group') {
    content = (
      <GroupDetail
        groupId={current.id}
        groupName={current.label}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
        onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
        onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
        onRenamed={renameCurrentCrumb}
        onDisplayLabel={setCurrentCrumbDisplayLabel}
        onMerged={(g) => replaceCurrentCrumb({ type: 'group', id: g.id, label: g.name })}
        onOpenFamilyTree={(personId, label, memberIds) => pushCrumb({ type: 'familyTree', id: personId, label, memberIds })}
      />
    )
  } else if (current?.type === 'event') {
    content = (
      <EventDetail
        eventId={current.id}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
        onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
        onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
        onRenamed={renameCurrentCrumb}
        onMerged={(e) => replaceCurrentCrumb({ type: 'event', id: e.id, label: e.summary })}
      />
    )
  } else if (current?.type === 'pet') {
    content = (
      <PetDetail
        petId={current.id}
        petName={current.label}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
        onRenamed={renameCurrentCrumb}
        onDeleted={popCrumb}
      />
    )
  } else if (current?.type === 'dunbar') {
    content = <DunbarDetail onBack={popCrumb} backLabel={parentLabel} />
  } else if (current?.type === 'nudges') {
    content = (
      <DueForUpdate
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
      />
    )
  } else if (current?.type === 'manageTags') {
    content = <ManageTags onBack={popCrumb} backLabel={parentLabel} />
  } else if (current?.type === 'manageLocations') {
    content = <ManageLocations onBack={popCrumb} backLabel={parentLabel} />
  } else if (current?.type === 'manageGroupTypes') {
    content = <ManageGroupTypes onBack={popCrumb} backLabel={parentLabel} />
  } else if (current?.type === 'genderFill') {
    content = <GenderFill onBack={popCrumb} backLabel={parentLabel} />
  } else if (current?.type === 'circle') {
    content = (
      <Circle
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
        onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
        onOpenFamilyTree={(personId, label, memberIds) => pushCrumb({ type: 'familyTree', id: personId, label, memberIds })}
      />
    )
  } else if (current?.type === 'familyTree') {
    content = (
      <FamilyTree
        personId={current.id}
        memberIds={current.memberIds}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectTree={(id, label) => pushCrumb({ type: 'familyTree', id, label })}
        onSelectPerson={(id, name) => pushCrumb({ type: 'person', id, label: name })}
      />
    )
  } else if (current?.type === 'settings') {
    content = (
      <SettingsPage
        onBack={popCrumb}
        backLabel={parentLabel}
        onOpenAbout={() => pushCrumb({ type: 'about', id: 'about', label: 'About' })}
        onOpenPrivacy={() => pushCrumb({ type: 'privacy', id: 'privacy', label: 'Privacy' })}
        onOpenCalendarSettings={() => pushCrumb({ type: 'calendarSettings', id: 'calendarSettings', label: 'Calendar settings' })}
        onOpenContactsImport={() => pushCrumb({ type: 'contactsImport', id: 'contactsImport', label: 'Import contacts' })}
        onOpenPhotoImport={() => pushCrumb({ type: 'photoImport', id: 'photoImport', label: 'Import photos' })}
        onOpenManageTags={() => pushCrumb({ type: 'manageTags', id: 'manageTags', label: 'Manage Tags' })}
        onOpenManageGroupTypes={() =>
          pushCrumb({ type: 'manageGroupTypes', id: 'manageGroupTypes', label: 'Manage Group Types' })
        }
      />
    )
  } else if (current?.type === 'calendarSettings') {
    content = <CalendarSettings onBack={popCrumb} backLabel={parentLabel} />
  } else if (current?.type === 'photoImport') {
    content = (
      <PhotoImportReview
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
      />
    )
  } else if (current?.type === 'importReview') {
    content = (
      <ImportReview
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
      />
    )
  } else if (current?.type === 'birthdayReview') {
    content = <BirthdayImportReview onBack={popCrumb} backLabel={parentLabel} />
  } else if (current?.type === 'contactsImport') {
    content = (
      <ContactsImport
        onBack={popCrumb}
        backLabel={parentLabel}
        onImported={() => pushCrumb({ type: 'contactSelection', id: 'contactSelection', label: 'Choose contacts' })}
      />
    )
  } else if (current?.type === 'contactSelection') {
    content = (
      <ContactSelection
        onBack={popCrumb}
        backLabel={parentLabel}
        onReviewSelected={() => pushCrumb({ type: 'contactImportReview', id: 'contactImportReview', label: 'Review contacts' })}
      />
    )
  } else if (current?.type === 'contactImportReview') {
    content = (
      <ContactImportReview
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(id, name) => pushCrumb({ type: 'person', id, label: name })}
      />
    )
  } else if (current?.type === 'about') {
    content = <About onBack={popCrumb} backLabel={parentLabel} />
  } else if (current?.type === 'privacy') {
    content = <Privacy onBack={popCrumb} backLabel={parentLabel} />
  } else {
    content = (
      <>
        {view === 'home' && (
          <Home
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onSelectDunbar={() => pushCrumb({ type: 'dunbar', id: 'dunbar', label: "Dunbar's number" })}
            onSelectNudges={() => pushCrumb({ type: 'nudges', id: 'nudges', label: 'Due for an update' })}
            onNavigateTab={goToTab}
            onOpenImportReview={() => pushCrumb({ type: 'importReview', id: 'importReview', label: 'Review calendar events' })}
            onOpenBirthdayReview={() => pushCrumb({ type: 'birthdayReview', id: 'birthdayReview', label: 'Review birthdays' })}
            onOpenContactImportReview={() => pushCrumb({ type: 'contactImportReview', id: 'contactImportReview', label: 'Review contacts' })}
            onOpenContactSelection={() => pushCrumb({ type: 'contactSelection', id: 'contactSelection', label: 'Choose contacts' })}
            askOnMount={pendingAsk}
            onAskConsumed={() => setPendingAsk(null)}
          />
        )}
        {view === 'people' && (
          <People
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
            onSelectPet={(p) => pushCrumb({ type: 'pet', id: p.id, label: p.name })}
            onFillGender={() => pushCrumb({ type: 'genderFill', id: 'genderFill', label: 'Fill in Gender' })}
          />
        )}
        {view === 'events' && (
          <Events
            filters={eventsFilters}
            onFiltersChange={setEventsFilters}
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
            onManageTags={() => pushCrumb({ type: 'manageTags', id: 'manageTags', label: 'Manage Tags' })}
            onManageLocations={() =>
              pushCrumb({ type: 'manageLocations', id: 'manageLocations', label: 'Manage Locations' })
            }
            onImportEvents={() =>
              pushCrumb({ type: 'calendarSettings', id: 'calendarSettings', label: 'Calendar settings' })
            }
          />
        )}
        {view === 'calendar' && (
          <Calendar
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
            onOpenCalendarSettings={() => pushCrumb({ type: 'calendarSettings', id: 'calendarSettings', label: 'Calendar settings' })}
            onOpenImportReview={() => pushCrumb({ type: 'importReview', id: 'importReview', label: 'Review calendar events' })}
            onOpenBirthdayReview={() => pushCrumb({ type: 'birthdayReview', id: 'birthdayReview', label: 'Review birthdays' })}
          />
        )}
        {view === 'groups' && (
          <Groups
            search={groupsSearch}
            onSearchChange={setGroupsSearch}
            typeFilter={groupsTypeFilter}
            onTypeFilterChange={setGroupsTypeFilter}
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectGroup={(g) => {
              groupsScrollRef.current = window.scrollY
              pushCrumb({ type: 'group', id: g.id, label: g.name })
            }}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
            restoreScrollRef={groupsScrollRef}
          />
        )}
      </>
    )
  }

  const TABS: { tab: Tab; label: string; Icon: (props: { size?: number }) => ReactElement }[] = [
    { tab: 'home', label: 'Home', Icon: HomeIcon },
    { tab: 'people', label: 'People', Icon: PeopleIcon },
    { tab: 'events', label: 'Events', Icon: EventsIcon },
    { tab: 'calendar', label: 'Calendar', Icon: CalendarIcon },
    { tab: 'groups', label: 'Groups', Icon: GroupsIcon },
  ]

  return (
    <div>
      <div style={navStyles.bar}>
        <div style={navStyles.left}>
          {/* className carries the phone breakpoint (see index.css) — the search button below
              needs the room this takes up. */}
          <span className="nav-wordmark" style={navStyles.wordmark}>
            Boomer
          </span>
          {TABS.map((t) => (
            <button
              key={t.tab}
              onClick={() => goToTab(t.tab)}
              style={view === t.tab ? navStyles.linkActive : navStyles.link}
              aria-current={view === t.tab ? 'page' : undefined}
            >
              <t.Icon />
              <span style={navStyles.linkLabel}>{t.label}</span>
            </button>
          ))}
          {/* Sits with the tabs rather than beside the avatar (founder report 2026-08-12: as a bare
              circle next to the initials it was too easy to open the account menu by mistake — the
              two were ~6px apart). Shaped like a tab, so it's a ~47px target instead of 34px, and
              never takes the active style: it opens a panel, it isn't a place you can be. */}
          <button
            type="button"
            onClick={openSearch}
            // Warms the corpus before the panel is even open, so on desktop the first search of a
            // session usually renders instantly instead of on a spinner.
            onPointerEnter={() => refreshSearchCorpus(false)}
            onFocus={() => refreshSearchCorpus(false)}
            style={navStyles.link}
            title="Search everything"
            aria-label="Search everything"
          >
            <SearchIcon size={21} />
            <span style={navStyles.linkLabel}>Search</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => setAccountMenuOpen(true)}
          style={navStyles.avatar}
          title={accountLabel?.name ?? 'Account'}
          aria-label="Account menu"
        >
          {accountLabel?.initials ?? '·'}
        </button>
      </div>

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        docs={searchDocs}
        loading={searchLoading}
        onSelect={handleSearchSelect}
        onAsk={handleAsk}
      />

      <ChoiceSheet
        open={accountMenuOpen}
        onClose={() => setAccountMenuOpen(false)}
        title={accountLabel?.name ?? 'Account'}
        actions={[
          {
            label: 'Settings',
            onClick: () => {
              setAccountMenuOpen(false)
              pushCrumb({ type: 'settings', id: 'settings', label: 'Settings' })
            },
          },
          {
            label: 'Log out',
            onClick: () => {
              setAccountMenuOpen(false)
              supabase.auth.signOut()
            },
          },
        ]}
      />

      {breadcrumbItems && <Breadcrumb items={breadcrumbItems} />}

      {/* ErrorBoundary OUTSIDE Suspense on purpose: a chunk that fails to download (offline, a
          deploy that rotated the hashed filenames mid-session) rejects the lazy import, and that
          rejection has to land on the boundary rather than leaving the fallback spinning forever. */}
      <ErrorBoundary key={current ? `${current.type}-${current.id}` : view}>
        <Suspense fallback={pageFallback}>{content}</Suspense>
      </ErrorBoundary>

      <FeedbackWidget pageLabel={feedbackPageLabel} />
    </div>
  )
}

const navStyles: { [key: string]: React.CSSProperties } = {
  // 2026-08-11: the five word-tabs measured 421px on a 375px phone, so Groups and the avatar hung
  // off the edge and the whole page scrolled sideways. Each tab is now an icon with its label
  // beneath, which fits with room to spare. `minWidth: 0` on the bar and the tab row is what
  // actually prevents the overflow — a flex row's default min-width is its content, so without it
  // the tabs push the bar wider than the screen instead of sharing the space they have.
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Deliberately wide (2026-08-12). At the old space.sm the nav's last control sat ~6px from the
    // account avatar, and reaching for it opened the account menu instead. This is the dead space
    // that stops that; it costs the tabs ~4px each, which they can afford.
    gap: space.xl,
    padding: '0.5rem 1rem',
    borderBottom: border.light,
    backgroundColor: colors.surface,
    fontFamily,
    minWidth: 0,
  },
  left: { display: 'flex', alignItems: 'center', gap: '2px', flex: '1 1 auto', minWidth: 0 },
  wordmark: {
    fontSize: fontSize.lead,
    fontWeight: 'bold',
    color: colors.ink,
    marginRight: space.sm,
    whiteSpace: 'nowrap',
    flex: 'none',
  },
  link: {
    background: 'none',
    border: 'none',
    color: colors.textMuted,
    fontFamily,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    // 44px is the minimum comfortable touch target; letting them share the row from a 0 basis is
    // what keeps five tabs inside a phone without any of them being individually pinned to a width.
    flex: '1 1 0',
    // Share the row on a phone, but stop stretching once there's room — five 120px icon buttons
    // spanning a desktop bar reads as a toolbar, not a nav.
    maxWidth: '76px',
    minWidth: 0,
    minHeight: '44px',
    padding: '0.3rem 0.15rem',
    borderRadius: radius.sm,
    cursor: 'pointer',
  },
  linkActive: {
    background: 'none',
    border: 'none',
    color: colors.primary,
    fontWeight: 'bold',
    fontFamily,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    flex: '1 1 0',
    // Share the row on a phone, but stop stretching once there's room — five 120px icon buttons
    // spanning a desktop bar reads as a toolbar, not a nav.
    maxWidth: '76px',
    minWidth: 0,
    minHeight: '44px',
    padding: '0.3rem 0.15rem',
    borderRadius: radius.sm,
    cursor: 'pointer',
  },
  // Small enough that "Calendar" — the longest label — still fits its share of a 375px row.
  linkLabel: { fontSize: '0.68rem', lineHeight: 1.1, whiteSpace: 'nowrap' },
  avatar: {
    width: '34px',
    height: '34px',
    borderRadius: radius.circle,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    fontSize: fontSize.small,
    fontWeight: 'bold',
    fontFamily,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    letterSpacing: '-0.02em',
    boxShadow: shadow.button,
    // Now a direct child of the bar (it used to sit inside a wrapper that carried this). Without
    // it the circle squashes into an oval before the tabs give up any width.
    flex: 'none',
  },
}
