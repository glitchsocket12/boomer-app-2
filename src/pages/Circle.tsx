// "My page" (backlog item 32) — the user's own relationship dashboard: self header, a real
// "Your circle" grid (spouse/kids/parents/siblings) driven by the relationships table, and
// "Your groups" with a Family-typed group linking into the real family tree, centered on the
// self person. Replaces the static CircleMock.tsx preview now that there's a real is_self flag
// and a real relationships table to read/write (see PROJECT_CONTEXT.md backlog item 32).

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getRelationshipsForPerson } from '../lib/relationshipsTable'
import { linkRelationship, createAndLinkRelationship, type CircleCategory } from '../lib/writeRelationship'
import RelationshipAddPicker from '../components/RelationshipAddPicker'
import { PersonChip } from '../components/Chips'
import SearchBox from '../components/SearchBox'

type SelfPerson = { id: string; name: string; last_name: string | null }
type PersonRef = { id: string; name: string }
type GroupRef = { id: string; name: string; group_type: string | null }
type ReminderRef = { label: string; month: number; day: number }
type AllPerson = { id: string; name: string; last_name: string | null }
type CircleIds = { spouse: string[]; kids: string[]; parents: string[]; siblings: string[] }

const CIRCLE_BOXES: { category: CircleCategory; title: string }[] = [
  { category: 'spouse', title: 'Spouse' },
  { category: 'kids', title: 'Kids' },
  { category: 'parents', title: 'Parents' },
  { category: 'siblings', title: 'Siblings' },
]

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function Circle({
  onBack,
  backLabel,
  onSelectPerson,
  onSelectGroup,
  onOpenFamilyTree,
}: {
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: PersonRef) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onOpenFamilyTree: (personId: string, label: string, memberIds?: string[]) => void
}) {
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [selfPerson, setSelfPerson] = useState<SelfPerson | null>(null)
  const [allPeople, setAllPeople] = useState<AllPerson[]>([])
  const [circleIds, setCircleIds] = useState<CircleIds>({ spouse: [], kids: [], parents: [], siblings: [] })
  const [groups, setGroups] = useState<GroupRef[]>([])
  const [reminders, setReminders] = useState<ReminderRef[]>([])
  const [onboardSearch, setOnboardSearch] = useState('')
  const [onboardBusy, setOnboardBusy] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function load() {
    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setUserId(user?.id ?? null)

    const [{ data: self }, { data: everyone }] = await Promise.all([
      supabase.from('people').select('id, name, last_name').eq('is_self', true).maybeSingle(),
      supabase.from('people').select('id, name, last_name'),
    ])
    setAllPeople((everyone as AllPerson[]) ?? [])

    if (!self) {
      setSelfPerson(null)
      setLoading(false)
      return
    }
    setSelfPerson(self as SelfPerson)

    const [rel, pgRes, reminderRes] = await Promise.all([
      getRelationshipsForPerson(self.id),
      supabase.from('person_groups').select('groups(id, name, group_type)').eq('person_id', self.id),
      supabase.from('reminders').select('label, month, day').eq('person_id', self.id),
    ])

    setCircleIds({
      spouse: [...rel.spouseIds, ...rel.partnerIds],
      kids: rel.childIds,
      parents: rel.parentIds,
      siblings: rel.siblingIds,
    })
    const groupRows = (pgRes.data as unknown as { groups: GroupRef | null }[]) ?? []
    setGroups(groupRows.map((r) => r.groups).filter((g): g is GroupRef => g !== null))
    setReminders((reminderRes.data as ReminderRef[]) ?? [])

    setLoading(false)
  }

  async function claimSelf(personId: string) {
    setOnboardBusy(true)
    await supabase.from('people').update({ is_self: true }).eq('id', personId)
    await load()
    setOnboardBusy(false)
  }

  async function createSelf() {
    setOnboardBusy(true)
    const { data: newPerson } = await supabase
      .from('people')
      .insert({ user_id: userId, name: 'You', is_self: true })
      .select()
      .single()
    setOnboardBusy(false)
    // Land on the fresh profile to set a real name, same "blank shell -> fact bar" pattern used
    // by manual "add person"/"add event"/"add group" elsewhere in the app.
    if (newPerson) onSelectPerson({ id: newPerson.id, name: newPerson.name })
  }

  async function handleSelectExisting(category: CircleCategory, person: { id: string; label: string }) {
    if (!selfPerson) return
    await linkRelationship(userId, category, selfPerson.id, fullSelfName, person.id, person.label)
    load()
  }

  async function handleCreateNew(category: CircleCategory, rawName: string) {
    if (!selfPerson) return
    await createAndLinkRelationship(userId, category, selfPerson.id, fullSelfName, rawName)
    load()
  }

  const nameById = new Map(allPeople.map((p) => [p.id, p.last_name ? `${p.name} ${p.last_name}` : p.name]))
  const fullSelfName = selfPerson ? `${selfPerson.name}${selfPerson.last_name ? ` ${selfPerson.last_name}` : ''}` : ''
  const birthday = reminders.find((r) => r.label === 'Birthday')
  const anniversary = reminders.find((r) => r.label === 'Anniversary')
  const peopleOptions = allPeople.map((p) => ({ id: p.id, label: p.last_name ? `${p.name} ${p.last_name}` : p.name }))

  if (loading) {
    return (
      <div style={styles.page}>
        <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
        <p>Loading…</p>
      </div>
    )
  }

  if (!selfPerson) {
    const q = onboardSearch.trim().toLowerCase()
    const results = q
      ? allPeople.filter((p) => `${p.name}${p.last_name ? ` ${p.last_name}` : ''}`.toLowerCase().includes(q)).slice(0, 8)
      : []
    return (
      <div style={styles.page}>
        <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>
        <h1 style={styles.heading}>Set up your page</h1>
        <p style={styles.body}>
          Which profile is you? This lets the app resolve things like "my mom" or "my brother" to real
          people, and builds your own circle and family tree.
        </p>
        <SearchBox value={onboardSearch} onChange={setOnboardSearch} placeholder="Search your people…" />
        {q && (
          <div style={styles.onboardResults}>
            {results.length === 0 && <p style={styles.empty}>No matches.</p>}
            {results.map((p) => (
              <button
                key={p.id}
                type="button"
                style={styles.onboardResultButton}
                onClick={() => claimSelf(p.id)}
                disabled={onboardBusy}
              >
                {p.name}{p.last_name ? ` ${p.last_name}` : ''}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={createSelf} style={styles.createSelfButton} disabled={onboardBusy}>
          {onboardBusy ? '…' : "I'm not listed — create my profile"}
        </button>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <div style={styles.header}>
        <div style={styles.avatar}>YOU</div>
        <button type="button" style={styles.nameButton} onClick={() => onSelectPerson({ id: selfPerson.id, name: fullSelfName })}>
          {fullSelfName}
        </button>
        <div style={styles.subtitle}>Your profile</div>
        <div style={styles.factRow}>
          <span style={styles.factChip}>
            {birthday ? `Birthday: ${MONTH_NAMES[birthday.month - 1]} ${birthday.day}` : 'No birthday on file'}
          </span>
          <span style={styles.factChip}>
            {anniversary ? `Anniversary: ${MONTH_NAMES[anniversary.month - 1]} ${anniversary.day}` : 'No anniversary on file'}
          </span>
        </div>
        <button
          type="button"
          style={styles.editProfileLink}
          onClick={() => onSelectPerson({ id: selfPerson.id, name: fullSelfName })}
        >
          Edit your profile →
        </button>
      </div>

      <h2 style={styles.sectionHeading}>Your circle</h2>
      <div style={styles.grid}>
        {CIRCLE_BOXES.map((box) => (
          <div key={box.category} style={styles.box}>
            <div style={styles.boxTitle}>{box.title}</div>
            <div style={styles.boxChips}>
              {circleIds[box.category].map((id) => (
                <PersonChip
                  key={id}
                  label={nameById.get(id) ?? 'Unknown'}
                  onClick={() => onSelectPerson({ id, name: nameById.get(id) ?? 'Unknown' })}
                />
              ))}
              <RelationshipAddPicker
                people={peopleOptions}
                excludeIds={[selfPerson.id, ...circleIds[box.category]]}
                onSelectExisting={(p) => handleSelectExisting(box.category, p)}
                onCreateNew={(name) => handleCreateNew(box.category, name)}
              />
            </div>
          </div>
        ))}
      </div>

      <h2 style={styles.sectionHeading}>Your groups</h2>
      <div style={styles.groupList}>
        {groups.length === 0 && <p style={styles.empty}>Not part of any groups yet.</p>}
        {groups.map((g) =>
          g.group_type === 'Family' ? (
            <button
              key={g.id}
              onClick={() => onOpenFamilyTree(selfPerson.id, `${fullSelfName}'s family tree`)}
              style={styles.familyGroupCard}
            >
              <div>
                <div style={styles.groupName}>{g.name}</div>
                <span style={styles.familyBadge}>Family</span>
              </div>
              <span style={styles.treeLink}>Tree →</span>
            </button>
          ) : (
            <button key={g.id} onClick={() => onSelectGroup(g)} style={styles.groupCard}>
              <div style={styles.groupName}>{g.name}</div>
              {g.group_type && <span style={styles.groupBadge}>{g.group_type}</span>}
            </button>
          )
        )}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '1rem 1.5rem 3rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    textDecoration: 'underline',
    fontSize: '0.9rem',
    fontFamily: 'Georgia, serif',
    cursor: 'pointer',
    padding: 0,
    marginBottom: '1rem',
  },
  heading: { fontSize: '1.6rem', color: '#2E4034', margin: '0 0 0.75rem' },
  body: { fontSize: '0.95rem', color: '#555', lineHeight: 1.5, marginBottom: '1.25rem' },
  onboardResults: { display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: '0.75rem 0 1.25rem' },
  onboardResultButton: {
    textAlign: 'left',
    fontSize: '0.9rem',
    padding: '0.5rem 0.7rem',
    borderRadius: '6px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#2E2E2E',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  createSelfButton: {
    fontSize: '0.9rem',
    padding: '0.6rem 1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '2rem' },
  avatar: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    border: '2px solid #6B4E9E',
    color: '#6B4E9E',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    fontWeight: 700,
    marginBottom: '0.6rem',
  },
  nameButton: {
    fontSize: '1.3rem',
    color: '#2E2E2E',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'Georgia, serif',
  },
  subtitle: { fontSize: '0.85rem', color: '#888', marginTop: '0.15rem' },
  factRow: { display: 'flex', gap: '0.5rem', marginTop: '0.9rem', flexWrap: 'wrap', justifyContent: 'center' },
  factChip: {
    fontSize: '0.8rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #CCC',
    color: '#555',
  },
  editProfileLink: {
    marginTop: '0.75rem',
    fontSize: '0.85rem',
    color: '#2E4034',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily: 'Georgia, serif',
  },
  sectionHeading: { fontSize: '1rem', color: '#2E2E2E', margin: '0 0 0.8rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.7rem',
    marginBottom: '2.5rem',
  },
  box: { border: '1px solid #E4E4E4', borderRadius: '10px', padding: '0.7rem' },
  boxTitle: { fontSize: '0.75rem', color: '#999', marginBottom: '0.5rem' },
  boxChips: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' },
  groupList: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  empty: { color: '#999', fontSize: '0.9rem' },
  familyGroupCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: '2px solid #6B4E9E',
    borderRadius: '10px',
    padding: '0.7rem 0.9rem',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    width: '100%',
    textAlign: 'left',
  },
  groupCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: '1px solid #E4E4E4',
    borderRadius: '10px',
    padding: '0.7rem 0.9rem',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
    width: '100%',
    textAlign: 'left',
  },
  groupName: { fontSize: '0.95rem', color: '#2E2E2E' },
  familyBadge: {
    fontSize: '0.7rem',
    backgroundColor: '#EEEDFE',
    color: '#3C3489',
    borderRadius: '999px',
    padding: '0.1rem 0.5rem',
    display: 'inline-block',
    marginTop: '0.25rem',
  },
  groupBadge: {
    fontSize: '0.7rem',
    backgroundColor: '#F2F2F2',
    color: '#777',
    borderRadius: '999px',
    padding: '0.1rem 0.5rem',
    display: 'inline-block',
  },
  treeLink: { fontSize: '0.85rem', color: '#6B4E9E' },
}
