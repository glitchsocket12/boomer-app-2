import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Home from './pages/Home'
import People from './pages/People'
import Events from './pages/Events'
import Groups from './pages/Groups'
import GroupDetail from './pages/GroupDetail'
import EventDetail from './pages/EventDetail'
import PersonDetail from './pages/PersonDetail'
import DunbarDetail from './pages/DunbarDetail'
import DueForUpdate from './pages/DueForUpdate'
import ErrorBoundary from './components/ErrorBoundary'
import Breadcrumb from './components/Breadcrumb'

type Tab = 'home' | 'people' | 'events' | 'groups'
type Crumb =
  | { type: 'person'; id: string; label: string }
  | { type: 'group'; id: string; label: string }
  | { type: 'event'; id: string; label: string }
  | { type: 'dunbar'; id: string; label: string }
  | { type: 'nudges'; id: string; label: string }

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
            ['person', 'group', 'event', 'dunbar', 'nudges'].includes(c.type) &&
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
  const [view, setView] = useState<Tab>(() => restoreNav().view)
  const [navStack, setNavStack] = useState<Crumb[]>(() => restoreNav().navStack)

  useEffect(() => {
    sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ view, navStack }))
  }, [view, navStack])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setCheckingSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

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

  function renameCurrentCrumb(newLabel: string) {
    setNavStack((s) => (s.length === 0 ? s : [...s.slice(0, -1), { ...s[s.length - 1], label: newLabel }]))
  }

  if (checkingSession) {
    return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>
  }

  if (!session) {
    return <Login />
  }

  const current = navStack[navStack.length - 1] ?? null
  const parentLabel = navStack.length >= 2 ? navStack[navStack.length - 2].label : TAB_LABELS[view]

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
          <button onClick={() => goToTab('people')} style={{ marginRight: '0.5rem' }}>People</button>
          <button onClick={() => goToTab('events')} style={{ marginRight: '0.5rem' }}>Events</button>
          <button onClick={() => goToTab('groups')}>Groups</button>
        </div>
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </div>

      {breadcrumbItems && <Breadcrumb items={breadcrumbItems} />}

      <ErrorBoundary key={current ? `${current.type}-${current.id}` : view}>{content}</ErrorBoundary>
    </div>
  )
}
