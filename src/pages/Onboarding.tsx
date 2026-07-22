// Standalone first-run "experience" (see gameplan doc) — a full-screen sequence with no app
// chrome (no tab bar/breadcrumb), shown once instead of Home for a brand-new account. Ordered by
// downstream connective value, not alphabetically: the family tree (highest leverage — one add
// auto-propagates via syncFamilyClique, and unlocks "my mom/dad" resolution everywhere) comes
// before groups (next-highest — one group seeds several people plus a reusable container), and
// individual notes/events are deliberately left out entirely (lowest leverage, better organic).
// Reuses existing building blocks throughout rather than inventing new ones: FamilyTree.tsx as-is
// for the tree step, the same relationships/groups tables everything else already writes to.

import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { buildFamilyTree } from '../lib/familyTree'
import type { GroupType } from '../lib/groupTypes'
import FamilyTree from './FamilyTree'

type SelfPerson = { id: string; name: string; last_name: string | null }
type PersonOption = { id: string; label: string }
type Stage = 'welcome' | 'tree' | 'familyGroupOffer' | 'groups' | 'handoff'

// Family is covered by the tree step itself (item 41's existing Family-group/tree pairing) —
// these are the next-highest-leverage clusters per the gameplan's "juice for the squeeze" ranking.
const PICKABLE_GROUP_TYPES: { type: GroupType; example: string }[] = [
  { type: 'Friend group', example: 'e.g. college roommates, a standing dinner group' },
  { type: 'School', example: 'e.g. high school, college' },
  { type: 'Team', example: 'e.g. a sports team, a hobby club' },
  { type: 'Work', example: 'e.g. current or former coworkers' },
]

const STAGE_DOT_INDEX: Record<Stage, number> = {
  welcome: 0,
  tree: 1,
  familyGroupOffer: 1,
  groups: 2,
  handoff: 3,
}
const STAGE_DOT_LABELS = ['Welcome', 'Family', 'Groups', 'Done']

export default function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [stage, setStage] = useState<Stage>('welcome')
  const [userId, setUserId] = useState<string | null>(null)
  const [selfPerson, setSelfPerson] = useState<SelfPerson | null | undefined>(undefined)
  const [selfNameInput, setSelfNameInput] = useState('')
  const [creatingSelf, setCreatingSelf] = useState(false)

  const [viewingPersonId, setViewingPersonId] = useState<string | null>(null)
  const [treeMemberIds, setTreeMemberIds] = useState<string[]>([])
  const [creatingFamilyGroup, setCreatingFamilyGroup] = useState(false)
  const [familyGroupDone, setFamilyGroupDone] = useState(false)

  const [allPeople, setAllPeople] = useState<PersonOption[]>([])
  const [selectedGroupTypes, setSelectedGroupTypes] = useState<GroupType[]>([])
  const [groupQueue, setGroupQueue] = useState<GroupType[]>([])
  const [currentGroupName, setCurrentGroupName] = useState('')
  const [currentGroupMembers, setCurrentGroupMembers] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)

  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    loadSelf()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadSelf(retriesLeft = 4) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setUserId(user?.id ?? null)
    const { data: self } = await supabase.from('people').select('id, name, last_name').eq('is_self', true).maybeSingle()
    if (self) {
      setSelfPerson(self as SelfPerson)
      setViewingPersonId(self.id)
      refreshAllPeople()
      return
    }
    // The signup metadata → self-person write (ensureSelfPersonFromSignupMetadata) fires
    // fire-and-forget on SIGNED_IN — brief retry window covers that race rather than
    // dead-ending straight to the fallback form below.
    if (retriesLeft > 0) {
      setTimeout(() => loadSelf(retriesLeft - 1), 400)
    } else {
      setSelfPerson(null)
    }
  }

  async function refreshAllPeople() {
    const { data } = await supabase.from('people').select('id, name, last_name')
    setAllPeople((data ?? []).map((p) => ({ id: p.id, label: p.last_name ? `${p.name} ${p.last_name}` : p.name })))
  }

  // Covers accounts that predate the signup metadata flow, or the rare timing miss — onboarding
  // should never dead-end even without it.
  async function createSelfFallback(e: FormEvent) {
    e.preventDefault()
    const trimmed = selfNameInput.trim()
    if (!trimmed) return
    setCreatingSelf(true)
    const [first, ...rest] = trimmed.split(/\s+/)
    const { data: newPerson } = await supabase
      .from('people')
      .insert({ user_id: userId, name: first, last_name: rest.length > 0 ? rest.join(' ') : null, is_self: true })
      .select()
      .single()
    setCreatingSelf(false)
    if (newPerson) {
      setSelfPerson(newPerson as SelfPerson)
      setViewingPersonId(newPerson.id)
      refreshAllPeople()
    }
  }

  async function markOnboardingComplete() {
    await supabase.auth.updateUser({ data: { onboarding_complete: true } })
  }

  async function skipEverything() {
    await markOnboardingComplete()
    onComplete()
  }

  async function finishOnboarding() {
    setFinishing(true)
    // Live payoff, not the cached fallback — the first thing Home shows should already reflect
    // what was just built here.
    await supabase.functions.invoke('suggest-prompts', { body: { refresh: true } })
    await markOnboardingComplete()
    setFinishing(false)
    onComplete()
  }

  // Gathers everyone shown on the tree (minus self) so the family-group offer can seed its
  // roster from exactly what was just built, instead of asking the user to re-list names.
  async function proceedFromTree() {
    if (!selfPerson) return
    const tree = await buildFamilyTree(selfPerson.id)
    const ids = new Set<string>()
    tree.tiers.forEach((tier) =>
      tier.branches.forEach((branch) => {
        ;[branch.union, ...branch.leftExtended, ...branch.rightExtended, ...branch.siblings].forEach((union) => {
          ids.add(union.a.id)
          union.spouses.forEach((s) => ids.add(s.id))
        })
      })
    )
    ids.delete(selfPerson.id)
    setTreeMemberIds([...ids])
    setStage('familyGroupOffer')
  }

  // Reuses the existing Family-group + tree pairing (item 41) rather than a separate mechanism —
  // this just seeds that group's roster from the tree instead of the usual manual add.
  async function createFamilyGroup() {
    if (!selfPerson || !userId) return
    setCreatingFamilyGroup(true)
    const groupName = selfPerson.last_name ? `${selfPerson.last_name} Family` : 'My Family'
    const { data: group } = await supabase
      .from('groups')
      .insert({ user_id: userId, name: groupName, group_type: 'Family' })
      .select()
      .single()
    if (group) {
      const memberIds = [selfPerson.id, ...treeMemberIds]
      await supabase
        .from('person_groups')
        .upsert(
          memberIds.map((id) => ({ person_id: id, group_id: group.id })),
          { onConflict: 'person_id,group_id', ignoreDuplicates: true }
        )
    }
    setCreatingFamilyGroup(false)
    setFamilyGroupDone(true)
  }

  function toggleGroupType(type: GroupType) {
    setSelectedGroupTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  function confirmGroupTypes() {
    if (selectedGroupTypes.length === 0) {
      setStage('handoff')
      return
    }
    setGroupQueue(selectedGroupTypes)
    setCurrentGroupName('')
    setCurrentGroupMembers('')
  }

  // Matches a typed name against everyone already on file (exact, case-insensitive — same
  // "confident match" bar the rest of the app uses), else creates a new person, mirroring
  // writeRelationship.ts's createAndLinkRelationship but for plain group membership (no
  // relationship to record).
  async function resolveOrCreatePerson(rawName: string): Promise<string | null> {
    const trimmed = rawName.trim()
    if (!trimmed) return null
    const match = allPeople.find((p) => p.label.toLowerCase() === trimmed.toLowerCase())
    if (match) return match.id
    const [first, ...rest] = trimmed.split(/\s+/)
    const { data: newPerson } = await supabase
      .from('people')
      .insert({ user_id: userId, name: first, last_name: rest.length > 0 ? rest.join(' ') : null })
      .select()
      .single()
    return newPerson?.id ?? null
  }

  async function saveCurrentGroup() {
    if (!userId || !selfPerson || groupQueue.length === 0) return
    const type = groupQueue[0]
    const name = currentGroupName.trim() || type
    setSavingGroup(true)
    const { data: group } = await supabase.from('groups').insert({ user_id: userId, name, group_type: type }).select().single()
    if (group) {
      const rawNames = currentGroupMembers.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      const memberIds = [selfPerson.id]
      for (const raw of rawNames) {
        const id = await resolveOrCreatePerson(raw)
        if (id) memberIds.push(id)
      }
      await supabase
        .from('person_groups')
        .upsert(
          memberIds.map((id) => ({ person_id: id, group_id: group.id })),
          { onConflict: 'person_id,group_id', ignoreDuplicates: true }
        )
      await refreshAllPeople()
    }
    setSavingGroup(false)
    advanceGroupQueue()
  }

  function skipCurrentGroup() {
    advanceGroupQueue()
  }

  function advanceGroupQueue() {
    const rest = groupQueue.slice(1)
    setGroupQueue(rest)
    setCurrentGroupName('')
    setCurrentGroupMembers('')
    if (rest.length === 0) setStage('handoff')
  }

  const dotIndex = STAGE_DOT_INDEX[stage]

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.progressRow}>
          {STAGE_DOT_LABELS.map((label, i) => (
            <div key={label} style={styles.dotWrap}>
              <div style={{ ...styles.dot, ...(i === dotIndex ? styles.dotActive : i < dotIndex ? styles.dotDone : {}) }} />
              <span style={styles.dotLabel}>{label}</span>
            </div>
          ))}
        </div>

        {selfPerson === undefined && <p style={styles.body}>Setting things up…</p>}

        {selfPerson === null && (
          <>
            <h1 style={styles.title}>Let's get started</h1>
            <p style={styles.body}>First, what's your name?</p>
            <form onSubmit={createSelfFallback} style={styles.inlineForm}>
              <input
                type="text"
                value={selfNameInput}
                onChange={(e) => setSelfNameInput(e.target.value)}
                placeholder="Your name"
                style={styles.input}
                autoFocus
              />
              <button type="submit" disabled={creatingSelf || !selfNameInput.trim()} style={styles.primaryButton}>
                {creatingSelf ? '…' : 'Continue'}
              </button>
            </form>
          </>
        )}

        {selfPerson && stage === 'welcome' && (
          <>
            <h1 style={styles.title}>Welcome, {selfPerson.name}.</h1>
            <p style={styles.body}>
              Boomer is organized around a few simple ideas: <strong>People</strong> hold everything about
              someone you know, <strong>Events</strong> are the moments you want remembered, <strong>Groups</strong>{' '}
              cluster the people who belong together, and <strong>Notes</strong> are the running texture on a
              person's profile — the little details that make you sound like you remember.
            </p>
            <p style={styles.body}>
              Let's build out the people who matter most to you, starting with family — the more you add now,
              the more useful this gets right away.
            </p>
            <div style={styles.buttonRow}>
              <button onClick={() => setStage('tree')} style={styles.primaryButton}>
                Let's go →
              </button>
              <button onClick={skipEverything} style={styles.skipLink}>
                Skip for now
              </button>
            </div>
          </>
        )}

        {selfPerson && stage === 'tree' && (
          <>
            <h1 style={styles.title}>Build your family tree</h1>
            <p style={styles.body}>
              Add your spouse, kids, siblings, and parents to start — then keep going if you can: grandparents,
              cousins, in-laws. There's no limit on how far back or how far out you go, and the more you add,
              the more useful your family tree (and the rest of Boomer) becomes.
            </p>
            <div style={styles.treeWrap}>
              <FamilyTree
                personId={viewingPersonId ?? selfPerson.id}
                backLabel="Welcome"
                onBack={() => setStage('welcome')}
                onSelectTree={(id) => setViewingPersonId(id)}
              />
            </div>
            <div style={styles.buttonRow}>
              <button onClick={proceedFromTree} style={styles.primaryButton}>
                Continue →
              </button>
              <button onClick={skipEverything} style={styles.skipLink}>
                Skip onboarding for now
              </button>
            </div>
          </>
        )}

        {selfPerson && stage === 'familyGroupOffer' && (
          <>
            <h1 style={styles.title}>Turn that into a Family group?</h1>
            {treeMemberIds.length === 0 ? (
              <>
                <p style={styles.body}>No family added yet — that's alright, you can always come back to this later.</p>
                <div style={styles.buttonRow}>
                  <button onClick={() => setStage('groups')} style={styles.primaryButton}>
                    Continue →
                  </button>
                </div>
              </>
            ) : familyGroupDone ? (
              <>
                <p style={styles.body}>Done — your Family group is ready with everyone you just added.</p>
                <div style={styles.buttonRow}>
                  <button onClick={() => setStage('groups')} style={styles.primaryButton}>
                    Continue →
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={styles.body}>
                  You've added {treeMemberIds.length} {treeMemberIds.length === 1 ? 'person' : 'people'} to your tree.
                  Want to also create a Family group with everyone in it, so events and photos can be tagged to your
                  whole family at once?
                </p>
                <div style={styles.buttonRow}>
                  <button onClick={createFamilyGroup} disabled={creatingFamilyGroup} style={styles.primaryButton}>
                    {creatingFamilyGroup ? '…' : 'Yes, create it'}
                  </button>
                  <button onClick={() => setStage('groups')} style={styles.secondaryButton}>
                    Not now
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {selfPerson && stage === 'groups' && groupQueue.length === 0 && (
          <>
            <h1 style={styles.title}>Which of these are part of your life?</h1>
            <p style={styles.body}>
              Friends are for a reason, a season, or a lifetime — however long they stick around, naming the
              groups they belong to now pays off later, when Boomer can tag events and photos to the whole
              group at once instead of one person at a time.
            </p>
            <div style={styles.typeGrid}>
              {PICKABLE_GROUP_TYPES.map(({ type, example }) => {
                const selected = selectedGroupTypes.includes(type)
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => toggleGroupType(type)}
                    style={{ ...styles.typeCard, ...(selected ? styles.typeCardSelected : {}) }}
                  >
                    <div style={styles.typeCardTitle}>
                      {selected ? '✓ ' : ''}
                      {type}
                    </div>
                    <div style={styles.typeCardExample}>{example}</div>
                  </button>
                )
              })}
            </div>
            <div style={styles.buttonRow}>
              <button onClick={confirmGroupTypes} style={styles.primaryButton}>
                Continue →
              </button>
              <button onClick={() => setStage('handoff')} style={styles.skipLink}>
                Skip groups
              </button>
            </div>
          </>
        )}

        {selfPerson && stage === 'groups' && groupQueue.length > 0 && (
          <>
            <h1 style={styles.title}>Your {groupQueue[0].toLowerCase()}</h1>
            <p style={styles.body}>Give it a name, and list who's in it — one per line or separated by commas.</p>
            <label style={styles.label}>
              Name
              <input
                type="text"
                value={currentGroupName}
                onChange={(e) => setCurrentGroupName(e.target.value)}
                placeholder={groupQueue[0]}
                style={styles.input}
                autoFocus
              />
            </label>
            <label style={styles.label}>
              Who's in it?
              <textarea
                value={currentGroupMembers}
                onChange={(e) => setCurrentGroupMembers(e.target.value)}
                placeholder={'Jamie Lee\nCarlos Ruiz\nPriya Patel'}
                style={styles.textarea}
                rows={4}
              />
            </label>
            <div style={styles.buttonRow}>
              <button onClick={saveCurrentGroup} disabled={savingGroup} style={styles.primaryButton}>
                {savingGroup ? '…' : 'Save & continue →'}
              </button>
              <button onClick={skipCurrentGroup} style={styles.secondaryButton} disabled={savingGroup}>
                Skip this one
              </button>
            </div>
          </>
        )}

        {selfPerson && stage === 'handoff' && (
          <>
            <h1 style={styles.title}>You're all set.</h1>
            <p style={styles.body}>
              That's enough to make Boomer genuinely useful right away — you can always keep building from here,
              whenever you talk to it or add someone new.
            </p>
            <div style={styles.buttonRow}>
              <button onClick={finishOnboarding} disabled={finishing} style={styles.primaryButton}>
                {finishing ? '…' : 'Take me in →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    backgroundColor: '#F7F5F2',
    fontFamily: 'Georgia, serif',
    padding: '2.5rem 1.25rem',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: '14px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
    padding: '2.5rem',
    width: '100%',
    maxWidth: '640px',
  },
  progressRow: { display: 'flex', justifyContent: 'center', gap: '1.75rem', marginBottom: '2rem' },
  dotWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' },
  dot: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#E2DFD6' },
  dotActive: { backgroundColor: '#6B4E9E' },
  dotDone: { backgroundColor: '#2E4034' },
  dotLabel: { fontSize: '0.7rem', color: '#999' },
  title: { fontSize: '1.8rem', color: '#2E4034', margin: '0 0 1rem' },
  body: { fontSize: '1rem', color: '#444', lineHeight: 1.6, marginBottom: '1.25rem' },
  buttonRow: { display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', marginTop: '0.5rem' },
  primaryButton: {
    fontSize: '1.05rem',
    padding: '0.75rem 1.5rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  secondaryButton: {
    fontSize: '0.95rem',
    padding: '0.7rem 1.3rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#555',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  skipLink: {
    fontSize: '0.9rem',
    color: '#999',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline',
    fontFamily: 'Georgia, serif',
    padding: 0,
  },
  treeWrap: { border: '1px solid #EEE', borderRadius: '10px', padding: '0.5rem 0.5rem 0', marginBottom: '0.5rem' },
  typeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem' },
  typeCard: {
    textAlign: 'left',
    border: '1px solid #DDD',
    borderRadius: '10px',
    padding: '0.85rem 1rem',
    backgroundColor: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  typeCardSelected: { border: '2px solid #2E4034', backgroundColor: '#F4F8F1' },
  typeCardTitle: { fontSize: '1rem', color: '#2E4034', marginBottom: '0.25rem' },
  typeCardExample: { fontSize: '0.8rem', color: '#888' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.95rem', color: '#2E2E2E', marginBottom: '1rem' },
  input: { fontSize: '1.05rem', padding: '0.65rem', borderRadius: '8px', border: '1px solid #CCC', fontFamily: 'Georgia, serif' },
  textarea: {
    fontSize: '1rem',
    padding: '0.65rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
    resize: 'vertical',
  },
  inlineForm: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
}
