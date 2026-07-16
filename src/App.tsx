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
import ErrorBoundary from './components/ErrorBoundary'
import Breadcrumb from './components/Breadcrumb'

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [view, setView] = useState<'home' | 'people' | 'events' | 'groups'>('home')
  const [viewingPerson, setViewingPerson] = useState<{ id: string; name: string } | null>(null)
  const [viewingGroup, setViewingGroup] = useState<{ id: string; name: string } | null>(null)
  const [viewingEvent, setViewingEvent] = useState<{ id: string; summary: string } | null>(null)

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

  if (checkingSession) {
    return <p style={{ textAlign: 'center', marginTop: '4rem' }}>Loading…</p>
  }

  if (!session) {
    return <Login />
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem 1.5rem' }}>
        <div>
          <button onClick={() => { setView('home'); setViewingPerson(null); setViewingGroup(null); setViewingEvent(null) }} style={{ marginRight: '0.5rem' }}>Home</button>
          <button onClick={() => { setView('people'); setViewingPerson(null); setViewingGroup(null); setViewingEvent(null) }} style={{ marginRight: '0.5rem' }}>People</button>
          <button onClick={() => { setView('events'); setViewingPerson(null); setViewingGroup(null); setViewingEvent(null) }} style={{ marginRight: '0.5rem' }}>Events</button>
          <button onClick={() => { setView('groups'); setViewingPerson(null); setViewingGroup(null); setViewingEvent(null) }}>Groups</button>
        </div>
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </div>

      {!viewingPerson && viewingGroup && (
        <Breadcrumb
          items={[
            { label: 'Home', onClick: () => { setView('home'); setViewingGroup(null); setViewingEvent(null) } },
            { label: 'Groups', onClick: () => { setViewingGroup(null); setViewingEvent(null) } },
            viewingEvent
              ? { label: viewingGroup.name, onClick: () => setViewingEvent(null) }
              : { label: viewingGroup.name },
            ...(viewingEvent ? [{ label: viewingEvent.summary }] : []),
          ]}
        />
      )}

      <ErrorBoundary
        key={
          viewingPerson
            ? `person-${viewingPerson.id}`
            : viewingEvent
            ? `event-${viewingEvent.id}`
            : viewingGroup
            ? `group-${viewingGroup.id}`
            : view
        }
      >
        {viewingPerson ? (
          <PersonDetail
            personId={viewingPerson.id}
            personName={viewingPerson.name}
            onBack={() => setViewingPerson(null)}
          />
        ) : viewingEvent && viewingGroup ? (
          <EventDetail eventId={viewingEvent.id} onSelectPerson={(p) => setViewingPerson(p)} />
        ) : viewingGroup ? (
          <GroupDetail
            groupId={viewingGroup.id}
            groupName={viewingGroup.name}
            onSelectEvent={(e) => setViewingEvent(e)}
          />
        ) : (
          <>
            {view === 'home' && <Home onSelectPerson={(p) => setViewingPerson(p)} />}
            {view === 'people' && <People />}
            {view === 'events' && <Events onSelectPerson={(p) => setViewingPerson(p)} />}
            {view === 'groups' && <Groups onSelectPerson={(p) => setViewingPerson(p)} onSelectGroup={(g) => setViewingGroup(g)} />}
          </>
        )}
      </ErrorBoundary>
    </div>
  )
}