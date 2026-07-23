import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Landing from './pages/Landing'
import Login from './pages/Login'
import { ensureSelfPersonFromSignupMetadata } from './lib/ensureSelfFromSignup'
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
import Circle from './pages/Circle'
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
  | { type: 'circle'; id: string; label: string }
  | { type: 'familyTree'; id: string; label: string; memberIds?: string[] }

const TAB_LABELS: Record<Tab, string> = { home: 'Home', people: 'People', events: 'Events', groups: 'Groups' }

// Where-you-are is plain React state, so a browser refresh used to reset to Home.
// Persist it per browser tab (sessionStorage) so refreshing stays on the current page.
const NAV_STORAGE_KEY = 'boomer-nav'

function restoreNav(): { view: Tab; navStack: Crumb[] } {
  const fallback = { view: 'home' as Tab, navStack: [] as Crumb[] }
  try {
    const raw = sessionStorage.getItem(NAV_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (!(parsed.view in TAB_LABELS)) return fallback
    const stack = Array.isArray(parsed.navStack)
      ? parsed.navStack.filter(
          (c: Crumb) =>
            c &&
            ['person', 'group', 'event', 'dunbar', 'nudges', 'circle', 'familyTree'].includes(c.type) &&
            typeof c.id === 'string' &&
            typeof c.label === 'string'
        )
      : []
    return { view: parsed.view, navStack: stack }
  } catch {
    return fallback
  }
}

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [authView, setAuthView] = useState<'landing' | 'login' | 'signup'>('landing')
  // null = still checking, true = show the standalone onboarding experience instead of the app
  // shell. Gated on two signals together: the account hasn't already finished/skipped onboarding
  // (auth user_metadata, set by Onboarding.tsx on completion) AND it doesn't already have real
  // data (people beyond the self profile) — the second check keeps every pre-existing account
  // (no metadata flag at all) from suddenly being routed into onboarding.
  const [onboardingPending, setOnboardingPending] = useState<boolean | null>(null)
  const [view, setView] = useState<Tab>(() => restoreNav().view)
  const [navStack, setNavStack] = useState<Crumb[]>(() => restoreNav().navStack)

  useEffect(() => {
    sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ view, navStack }))
  }, [view, navStack])

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
      await supabase.auth.updateUser({ data: { onboarding_started: true } })
    }
  }

  function goToTab(tab: Tab) {
    setView(tab)
    setNavStack([])
  }

  function pushCrumb(crumb: Crumb) {
    setNavStack((s) => [...s, crumb])
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
          <button onClick={() => supabase.auth.signOut()}>Log out</button>
        </div>
      </div>

      {breadcrumbItems && <Breadcrumb items={breadcrumbItems} />}

      <ErrorBoundary key={current ? `${current.type}-${current.id}` : view}>{content}</ErrorBoundary>

      <FeedbackWidget pageLabel={feedbackPageLabel} />
    </div>
  )
}
