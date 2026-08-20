import { useState } from 'react'
import Breadcrumb from '../../components/Breadcrumb'
import DemoIntro from './DemoIntro'
import DemoHome from './DemoHome'
import DemoPeople from './DemoPeople'
import DemoPersonDetail from './DemoPersonDetail'
import DemoGroups from './DemoGroups'
import DemoGroupDetail from './DemoGroupDetail'
import DemoEvents from './DemoEvents'
import DemoEventDetail from './DemoEventDetail'
import DemoFamilyTree from './DemoFamilyTree'
import DemoNotebooks from './DemoNotebooks'
import DemoNotebookDetail from './DemoNotebookDetail'
import GlobalSearch from '../../components/GlobalSearch'
import { SearchIcon } from '../../components/NavIcons'
import { DEMO_SEARCH_DOCS } from '../../lib/demoSearchCorpus'
import type { SearchTarget } from '../../lib/globalSearch'
import { border, colors, fontFamily, fontSize, radius, space } from '../../lib/theme'

type Tab = 'home' | 'people' | 'events' | 'groups' | 'notebooks'
type Crumb =
  | { type: 'person'; id: string; label: string }
  | { type: 'group'; id: string; label: string }
  | { type: 'event'; id: string; label: string }
  | { type: 'familyTree'; id: string; label: string; memberIds?: string[] }
  | { type: 'notebook'; id: string; label: string }

const TAB_LABELS: Record<Tab, string> = { home: 'Home', people: 'People', events: 'Events', groups: 'Groups', notebooks: 'Notebooks' }

// The demo's own tiny nav shell — deliberately mirrors App.tsx's real one (same tab bar,
// breadcrumb pattern) so the click-through feels like the actual app, but everything here reads
// from the static src/lib/demoData.ts dataset. No auth, no Supabase, no Edge Functions — every
// Demo* container below renders the real *View components with `readOnly` set.
export default function DemoShell({ onExit, onSignUp }: { onExit: () => void; onSignUp: () => void }) {
  const [introSeen, setIntroSeen] = useState(false)
  const [view, setView] = useState<Tab>('home')
  const [navStack, setNavStack] = useState<Crumb[]>([])
  const [searchOpen, setSearchOpen] = useState(false)

  if (!introSeen) {
    return <DemoIntro onFinish={() => setIntroSeen(true)} />
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

  function handleSearchSelect(target: SearchTarget) {
    // The demo's Crumb union has no pet or tag member, and demoSearchCorpus never emits those
    // kinds — the default is unreachable, and exists so adding a kind later fails loudly in tsc
    // rather than silently doing nothing on click.
    switch (target.kind) {
      case 'person':
      case 'group':
      case 'event':
      case 'notebook':
        return pushCrumb({ type: target.kind, id: target.id, label: target.label })
      default:
        return
    }
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
        onSelectEvent={(e) => pushCrumb({ type: 'event', id: e.id, label: e.summary })}
      />
    )
  } else if (current?.type === 'notebook') {
    content = (
      <DemoNotebookDetail
        notebookId={current.id}
        onBack={popCrumb}
        backLabel={parentLabel}
        onSelectPerson={(p) => pushCrumb({ type: 'person', id: p.id, label: p.name })}
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
        onSelectPerson={(id, name) => pushCrumb({ type: 'person', id, label: name })}
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
        {view === 'notebooks' && (
          <DemoNotebooks onSelectNotebook={(n) => pushCrumb({ type: 'notebook', id: n.id, label: n.name })} />
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
          <button onClick={() => goToTab('notebooks')} style={styles.navButton}>Notebooks</button>
          {/* With the tabs, not next to "Exit demo" — mirrors the real nav, where sitting beside
              the account avatar made it easy to hit the wrong thing (founder report 2026-08-12).
              Here the neighbour would have been the button that ENDS the demo. */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            style={styles.searchButton}
            title="Search everything"
            aria-label="Search everything"
          >
            <SearchIcon size={17} />
            <span>Search</span>
          </button>
        </div>
        <div>
          <button onClick={onExit} style={styles.exitButton}>Exit demo</button>
        </div>
      </div>

      {/* No onAsk: the demo has no chat to hand a question to. The corpus is a module constant, so
          `loading` is permanently false and there is nothing to fetch. */}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        docs={DEMO_SEARCH_DOCS}
        loading={false}
        onSelect={handleSearchSelect}
      />

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
    backgroundColor: colors.suggestBg,
    borderBottom: `1px solid ${colors.suggestBorder}`,
    color: colors.suggestDeep,
    fontFamily,
    fontSize: fontSize.body,
  },
  bannerButton: {
    fontSize: fontSize.label,
    fontWeight: 700,
    padding: '0.4rem 0.9rem',
    borderRadius: radius.pill,
    border: `1px solid ${colors.suggest}`,
    backgroundColor: 'transparent',
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
  },
  navRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '1rem 1.5rem',
    fontFamily,
  },
  navButton: {
    marginRight: '0.5rem',
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    fontFamily,
  },
  // Matches navButton's plain-text look so it reads as part of the same row, with the glyph in
  // front to say it opens a search rather than another page.
  searchButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.xs,
    marginRight: space.md,
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    fontFamily,
    padding: 0,
  },
  exitButton: {
    background: 'none',
    border: border.default,
    borderRadius: radius.md,
    padding: '0.4rem 0.9rem',
    color: colors.textBody,
    fontSize: fontSize.body,
    cursor: 'pointer',
    fontFamily,
  },
}
