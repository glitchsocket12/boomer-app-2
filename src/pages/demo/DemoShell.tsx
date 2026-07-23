import { useState } from 'react'
import Breadcrumb from '../../components/Breadcrumb'
import DemoHome from './DemoHome'
import DemoPeople from './DemoPeople'
import DemoPersonDetail from './DemoPersonDetail'
import DemoGroups from './DemoGroups'
import DemoGroupDetail from './DemoGroupDetail'
import DemoEvents from './DemoEvents'
import DemoEventDetail from './DemoEventDetail'
import DemoFamilyTree from './DemoFamilyTree'

type Tab = 'home' | 'people' | 'events' | 'groups'
type Crumb =
  | { type: 'person'; id: string; label: string }
  | { type: 'group'; id: string; label: string }
  | { type: 'event'; id: string; label: string }
  | { type: 'familyTree'; id: string; label: string; memberIds?: string[] }

const TAB_LABELS: Record<Tab, string> = { home: 'Home', people: 'People', events: 'Events', groups: 'Groups' }

// The demo's own tiny nav shell — deliberately mirrors App.tsx's real one (same tab bar,
// breadcrumb pattern) so the click-through feels like the actual app, but everything here reads
// from the static src/lib/demoData.ts dataset. No auth, no Supabase, no Edge Functions — every
// Demo* container below renders the real *View components with `readOnly` set.
export default function DemoShell({ onExit, onSignUp }: { onExit: () => void; onSignUp: () => void }) {
  const [view, setView] = useState<Tab>('home')
  const [navStack, setNavStack] = useState<Crumb[]>([])

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
      <DemoPersonDetail
        personId={current.id}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
        onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
        onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
        onOpenFamilyTree={(personId, label, memberIds) => pushCrumb({ type: 'familyTree', id: personId, label, memberIds })}
      />
    )
  } else if (current?.type === 'group') {
    content = (
      <DemoGroupDetail
        groupId={current.id}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
        onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
        onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
        onOpenFamilyTree={(personId, label, memberIds) => pushCrumb({ type: 'familyTree', id: personId, label, memberIds })}
      />
    )
  } else if (current?.type === 'event') {
    content = (
      <DemoEventDetail
        eventId={current.id}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
        onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
      />
    )
  } else if (current?.type === 'familyTree') {
    content = (
      <DemoFamilyTree
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
          <DemoHome
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onNavigateTab={goToTab}
          />
        )}
        {view === 'people' && (
          <DemoPeople
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
          />
        )}
        {view === 'events' && (
          <DemoEvents
            onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
            onSelectGroup={(g) => pushCrumb({ type: 'group', id: g.id, label: g.name })}
            onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
          />
        )}
        {view === 'groups' && (
          <DemoGroups
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
      <div style={styles.banner}>
        <span>You're viewing a sample profile — everything here is made up, and nothing you click saves anywhere.</span>
        <button onClick={onSignUp} style={styles.bannerButton}>Sign up to make your own →</button>
      </div>

      <div style={styles.navRow}>
        <div>
          <button onClick={() => goToTab('home')} style={styles.navButton}>Home</button>
          <button onClick={() => goToTab('people')} style={styles.navButton}>People</button>
          <button onClick={() => goToTab('events')} style={styles.navButton}>Events</button>
          <button onClick={() => goToTab('groups')} style={styles.navButton}>Groups</button>
        </div>
        <div>
          <button onClick={onExit} style={styles.exitButton}>Exit demo</button>
        </div>
      </div>

      {breadcrumbItems && <Breadcrumb items={breadcrumbItems} />}

      {content}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
    padding: '0.75rem 1.5rem',
    backgroundColor: '#FBF3E0',
    borderBottom: '1px solid #E6D6AC',
    color: '#5A4A20',
    fontFamily: 'Georgia, serif',
    fontSize: '0.9rem',
  },
  bannerButton: {
    fontSize: '0.85rem',
    fontWeight: 700,
    padding: '0.4rem 0.9rem',
    borderRadius: '999px',
    border: '1px solid #8A6A1F',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    whiteSpace: 'nowrap',
  },
  navRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1rem 1.5rem',
    fontFamily: 'Georgia, serif',
  },
  navButton: {
    marginRight: '0.5rem',
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  exitButton: {
    background: 'none',
    border: '1px solid #CCC',
    borderRadius: '8px',
    padding: '0.4rem 0.9rem',
    color: '#555',
    fontSize: '0.9rem',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
}
