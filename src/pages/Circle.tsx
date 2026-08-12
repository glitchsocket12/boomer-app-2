// "My page" (backlog item 32) — the user's own relationship dashboard: self header, a real
// "Your circle" grid (spouse/kids/parents/siblings) driven by the relationships table, and
// "Your groups" with a Family-typed group linking into the real family tree, centered on the
// self person. Replaces the static CircleMock.tsx preview now that there's a real is_self flag
// and a real relationships table to read/write (see PROJECT_CONTEXT.md backlog item 32).

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { getRelationshipsForPerson } from '../lib/relationshipsTable'
import { linkRelationship, createAndLinkRelationship, type CircleCategory } from '../lib/writeRelationship'
import RelationshipAddPicker from '../components/RelationshipAddPicker'
import { PersonChip } from '../components/Chips'
import { useGroupRoster } from '../lib/groupRoster'
import SearchBox from '../components/SearchBox'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

type SelfPerson = { id: string; name: string; last_name: string | null }
type PersonRef = { id: string; name: string }
type GroupRef = { id: string; name: string; group_type: string | null }
type ReminderRef = { label: string; month: number; day: number }
type AllPerson = { id: string; name: string; last_name: string | null }
type CircleIds = { spouse: string[]; kids: string[]; parents: string[]; siblings: string[] }

// Backlog item 32(a), settled: an empty category stays VISIBLE and reads as an invitation, rather
// than hiding until something fills it. Hiding would make the four boxes appear one at a time in a
// shifting layout, and the whole point of this page is to prompt the links that aren't recorded
// yet — a box you can't see can't ask for anything. `addLabel` is what makes the empty state an
// actual invitation instead of a bare "+".
const CIRCLE_BOXES: { category: CircleCategory; title: string; addLabel: string }[] = [
  { category: 'spouse', title: 'Spouse', addLabel: 'Add a spouse' },
  { category: 'kids', title: 'Kids', addLabel: 'Add a child' },
  { category: 'parents', title: 'Parents', addLabel: 'Add a parent' },
  { category: 'siblings', title: 'Siblings', addLabel: 'Add a sibling' },
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
  const groupRoster = useGroupRoster()
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
      fetchAllRows((from, to) => supabase.from('people').select('id, name, last_name').order('id').range(from, to)),
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
                emptyLabel={circleIds[box.category].length === 0 ? box.addLabel : undefined}
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
                <div style={styles.groupName}>{groupRoster.label(g.id, g.name)}</div>
                <span style={styles.familyBadge}>Family</span>
              </div>
              <span style={styles.treeLink}>Tree →</span>
            </button>
          ) : (
            <button key={g.id} onClick={() => onSelectGroup(g)} style={styles.groupCard}>
              <div style={styles.groupName}>{groupRoster.label(g.id, g.name)}</div>
              {g.group_type && <span style={styles.groupBadge}>{g.group_type}</span>}
            </button>
          )
        )}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 3rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    textDecoration: 'underline',
    fontSize: fontSize.body,
    fontFamily,
    cursor: 'pointer',
    padding: 0,
    marginBottom: '1rem',
  },
  heading: { fontSize: '1.6rem', color: colors.ink, margin: '0 0 0.75rem' },
  body: { fontSize: fontSize.bodyLg, color: colors.textBody, lineHeight: 1.5, marginBottom: '1.25rem' },
  onboardResults: { display: 'flex', flexDirection: 'column', gap: '0.4rem', margin: '0.75rem 0 1.25rem' },
  onboardResultButton: {
    textAlign: 'left',
    fontSize: fontSize.body,
    padding: '0.5rem 0.7rem',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
    cursor: 'pointer',
    fontFamily,
  },
  createSelfButton: {
    fontSize: fontSize.body,
    padding: '0.6rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: '2rem' },
  avatar: {
    width: '56px',
    height: '56px',
    borderRadius: radius.circle,
    border: `2px solid ${colors.tree}`,
    color: colors.tree,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: fontSize.small,
    fontWeight: 700,
    marginBottom: '0.6rem',
  },
  nameButton: {
    fontSize: fontSize.h3,
    color: colors.inkPlain,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    fontFamily,
  },
  subtitle: { fontSize: fontSize.label, color: colors.textFaint, marginTop: '0.15rem' },
  factRow: { display: 'flex', gap: space.md, marginTop: '0.9rem', flexWrap: 'wrap', justifyContent: 'center' },
  factChip: {
    fontSize: fontSize.small,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.pill,
    border: border.default,
    color: colors.textBody,
  },
  editProfileLink: {
    marginTop: '0.75rem',
    fontSize: fontSize.label,
    color: colors.ink,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily,
  },
  sectionHeading: { fontSize: fontSize.base, color: colors.inkPlain, margin: '0 0 0.8rem' },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.7rem',
    marginBottom: '2.5rem',
  },
  box: { border: `1px solid ${neutral.grey150}`, borderRadius: radius.lg, padding: '0.7rem' },
  boxTitle: { fontSize: fontSize.tiny, color: colors.textFaintest, marginBottom: '0.5rem' },
  boxChips: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' },
  groupList: { display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  empty: { color: colors.textFaintest, fontSize: fontSize.body },
  familyGroupCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: `2px solid ${colors.tree}`,
    borderRadius: radius.lg,
    padding: '0.7rem 0.9rem',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily,
    width: '100%',
    textAlign: 'left',
  },
  groupCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    border: `1px solid ${neutral.grey150}`,
    borderRadius: radius.lg,
    padding: '0.7rem 0.9rem',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    fontFamily,
    width: '100%',
    textAlign: 'left',
  },
  groupName: { fontSize: fontSize.bodyLg, color: colors.inkPlain },
  familyBadge: {
    fontSize: fontSize.micro,
    backgroundColor: '#EEEDFE',
    color: '#3C3489',
    borderRadius: radius.pill,
    padding: '0.1rem 0.5rem',
    display: 'inline-block',
    marginTop: '0.25rem',
  },
  groupBadge: {
    fontSize: fontSize.micro,
    backgroundColor: neutral.offWhite,
    color: colors.textSubtle,
    borderRadius: radius.pill,
    padding: '0.1rem 0.5rem',
    display: 'inline-block',
  },
  treeLink: { fontSize: fontSize.label, color: colors.tree },
}
