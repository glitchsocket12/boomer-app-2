import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Home from './pages/Home'
import People from './pages/People'
import Events from './pages/Events'
import Groups from './pages/Groups'
import PersonDetail from './pages/PersonDetail'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [view, setView] = useState<'home' | 'people' | 'events' | 'groups'>('home')
  const [viewingPerson, setViewingPerson] = useState<{ id: string; name: string } | null>(null)

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
          <button onClick={() => { setView('home'); setViewingPerson(null) }} style={{ marginRight: '0.5rem' }}>Home</button>
          <button onClick={() => { setView('people'); setViewingPerson(null) }} style={{ marginRight: '0.5rem' }}>People</button>
          <button onClick={() => { setView('events'); setViewingPerson(null) }} style={{ marginRight: '0.5rem' }}>Events</button>
          <button onClick={() => { setView('groups'); setViewingPerson(null) }}>Groups</button>
        </div>
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </div>

      <ErrorBoundary key={viewingPerson ? `person-${viewingPerson.id}` : view}>
        {viewingPerson ? (
          <PersonDetail
            personId={viewingPerson.id}
            personName={viewingPerson.name}
            onBack={() => setViewingPerson(null)}
          />
        ) : (
          <>
            {view === 'home' && <Home onSelectPerson={(p) => setViewingPerson(p)} />}
            {view === 'people' && <People />}
            {view === 'events' && <Events onSelectPerson={(p) => setViewingPerson(p)} />}
            {view === 'groups' && <Groups onSelectPerson={(p) => setViewingPerson(p)} />}
          </>
        )}
      </ErrorBoundary>
    </div>
  )
}