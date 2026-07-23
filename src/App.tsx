import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import Landing from './pages/Landing'
import Login from './pages/Login'
import DemoShell from './pages/demo/DemoShell'
import { ensureSelfPersonFromSignupMetadata } from './lib/ensureSelfFromSignup'
import { ensureStarterTags } from './lib/ensureStarterTags'
import Onboarding from './pages/Onboarding'
import Home from './pages/Home'
import People from './pages/People'
import Events from './pages/Events'
import Groups from './pages/Groups'
import GroupDetail from './pages/GroupDetail'
import EventDetail from './pages/EventDetail'
import PersonDetail from './pages/PersonDetail'
import DunbarDetail from './pages/DunbarDetail'
import DueForUpdate from './pages/DueForUpdate'
import ManageTags from './pages/ManageTags'
import Circle from './pages/Circle'
import SettingsPage from './pages/SettingsPage'
import About from './pages/About'
import Privacy from './pages/Privacy'
import FamilyTree from './pages/FamilyTree'
import ErrorBoundary from './components/ErrorBoundary'
import Breadcrumb from './components/Breadcrumb'
import FeedbackWidget from './components/FeedbackWidget'

type Tab = 'home' | 'people' | 'events' | 'groups'
type Crumb =
  | { type: 'person'; id: string; label: string }
  | { type: 'group'; id: string; label: string }
  | { type: 'event'; id: string; label: string }
  | { type: 'dunbar'; id: string; label: string }
  | { type: 'nudges'; id: string; label: string }
  | { type: 'manageTags'; id: string; label: string }
  | { type: 'circle'; id: string; label: string }
  | { type: 'familyTree'; id: string; label: string; memberIds?: string[] }
  | { type: 'settings'; id: string; label: string }
  | { type: 'about'; id: string; label: string }
  | { type: 'privacy'; id: string; label: string }

const TAB_LABELS: Record<Tab, string> = { home: 'Home', people: 'People', events: 'Events', groups: 'Groups' }

const CRUMB_TYPES = [
  'person',
  'group',
  'event',
  'dunbar',
  'nudges',
  'manageTags',
  'circle',
  'familyTree',
  'settings',
  'about',
  'privacy',
]

// Crumb types that are single fixed pages rather than records with a real id (their `id` is
// just a copy of `type`, e.g. `{ type: 'circle', id: 'circle' }`) — the URL only needs one
// segment for these, not a `/type/id` pair.
const SINGLETON_CRUMB_TYPES = new Set(['dunbar', 'nudges', 'manageTags', 'circle', 'settings', 'about', 'privacy'])

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
  const [authView, setAuthView] = useState<'landing' | 'login' | 'signup' | 'demo'>('landing')
  // null = still checking, true = show the standalone onboarding experience instead of the app
  // shell. Gated on two signals together: the account hasn't already finished/skipped onboarding
  // (auth user_metadata, set by Onboarding.tsx on completion) AND it doesn't already have real
  // data (people beyond the self profile) — the second check keeps every pre-existing account
  // (no metadata flag at all) from suddenly being routed into onboarding.
  const [onboardingPending, setOnboardingPending] = useState<boolean | null>(null)
  const [view, setView] = useState<Tab>(() => restoreNav().view)
  const [navStack, setNavStack] = useState<Crumb[]>(() => restoreNav().navStack)
  // Guards against re-pushing a history entry for a state change that itself came FROM a
  // popstate (browser Back/Forward) — otherwise every Back press would immediately push a
  // matching Forward entry right back on top of it.
  const skipNextHistoryPush = useRef(false)

  useEffect(() => {
    sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ view, navStack }))

    if (skipNextHistoryPush.current) {
      skipNextHistoryPush.current = false
      return
    }
    const path = buildPath(view, navStack)
    if (path !== window.location.pathname) {
      window.history.pushState({ view, navStack }, '', path)
    }
  }, [view, navStack])

  useEffect(() => {
    // Sync the CURRENT history entry's state on mount (a plain replace, not a new entry) so
    // Back/Forward has full-fidelity state to restore from immediately, not just whatever the
    // very first render's [view, navStack] effect above would otherwise push.
    window.history.replaceState({ view, navStack }, '', buildPath(view, navStack))

    function handlePopState(e: PopStateEvent) {
      skipNextHistoryPush.current = true
      const state = e.state as { view?: Tab; navStack?: Crumb[] } | null
      if (state?.view) {
        setView(state.view)
        setNavStack(Array.isArray(state.navStack) ? state.navStack : [])
      } else {
        const parsed = parseNavFromPath(window.location.pathname)
        setView(parsed?.view ?? 'home')
        setNavStack(parsed?.navStack ?? [])
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setCheckingSession(false)
      checkOnboarding(session)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (event === 'SIGNED_IN' && session?.user) {
        ensureSelfPersonFromSignupMetadata(session.user.id, session.user.user_metadata ?? {})
        ensureStarterTags(session.user.id, session.user.user_metadata ?? {})
      }
      checkOnboarding(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

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
    setView(tab)
    setNavStack([])
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

  if (checkingSession) {
    return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>
  }

  if (!session) {
    if (authView === 'landing') {
      return <Landing onAuthClick={(mode) => setAuthView(mode)} />
    }
    if (authView === 'demo') {
      return <DemoShell onExit={() => setAuthView('landing')} onSignUp={() => setAuthView('signup')} />
    }
    return <Login initialSignUp={authView === 'signup'} onBack={() => setAuthView('landing')} />
  }

  if (onboardingPending === null) {
    return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>
  }
  if (onboardingPending) {
    return <Onboarding onComplete={() => setOnboardingPending(false)} />
  }

  const current = navStack[navStack.length - 1] ?? null
  const parentLabel = navStack.length >= 2 ? navStack[navStack.length - 2].label : TAB_LABELS[view]
  const feedbackPageLabel = current?.label ?? TAB_LABELS[view]

  const breadcrumbItems =
    navStack.length > 0
      ? [
          { label: 'Home', onClick: () => goToTab('home') },
          ...(view !== 'home' ? [{ label: TAB_LABELS[view], onClick: () => setNavStack([]) }] : []),
          ...navStack.map((crumb, i) =>
            i === navStack.length - 1 ? { label: crumb.label } : { label: crumb.label, onClick: () => jumpTo(i) }
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
        onRenamed={renameCurrentCrumb}
        onMerged={(e) => replaceCurrentCrumb({ type: 'event', id: e.id, label: e.summary })}
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
      />
    )
  } else if (current?.type === 'settings') {
    content = (
      <SettingsPage
        onBack={popCrumb}
        backLabel={parentLabel}
        onOpenAbout={() => pushCrumb({ type: 'about', id: 'about', label: 'About' })}
        onOpenPrivacy={() => pushCrumb({ type: 'privacy', id: 'privacy', label: 'Privacy' })}
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
          />
        )}
        {view === 'people' && (
          <People
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
          />
        )}
        {view === 'events' && (
          <Events
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
            onManageTags={() => pushCrumb({ type: 'manageTags', id: 'manageTags', label: 'Manage Tags' })}
          />
        )}
        {view === 'groups' && (
          <Groups
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
          />
        )}
      </>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 1.5rem' }}>
        <div>
          <button onClick={() => goToTab('home')} style={{ marginRight: '0.5rem' }}>Home</button>
          <button
            onClick={() => pushCrumb({ type: 'circle', id: 'circle', label: 'My page' })}
            style={{ marginRight: '0.5rem' }}
          >
            My page
          </button>
          <button onClick={() => goToTab('people')} style={{ marginRight: '0.5rem' }}>People</button>
          <button onClick={() => goToTab('events')} style={{ marginRight: '0.5rem' }}>Events</button>
          <button onClick={() => goToTab('groups')}>Groups</button>
        </div>
        <div>
          <button
            onClick={() => pushCrumb({ type: 'settings', id: 'settings', label: 'Settings' })}
            style={{ marginRight: '0.5rem' }}
          >
            Settings
          </button>
          <button onClick={() => supabase.auth.signOut()}>Log out</button>
        </div>
      </div>

      {breadcrumbItems && <Breadcrumb items={breadcrumbItems} />}

      <ErrorBoundary key={current ? `${current.type}-${current.id}` : view}>{content}</ErrorBoundary>

      <FeedbackWidget pageLabel={feedbackPageLabel} />
    </div>
  )
}
