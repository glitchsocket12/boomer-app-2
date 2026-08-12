import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { nameMatchStrength, personNameKeys } from '../lib/nameMatchStrength'
import { upsertReminder } from '../lib/reminders'
import SearchBox from '../components/SearchBox'
import SearchAddPicker from '../components/SearchAddPicker'
import MatchCallout from '../components/MatchCallout'
import ReviewNoteField from '../components/ReviewNoteField'
import { groupDisplayName } from '../lib/groupDisplayName'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

type LabeledValue = { label: string; value: string }
type Address = { label: string; street: string | null; city: string | null; state: string | null; zip: string | null; country: string | null }
type RelatedName = { label: string; name: string }

type Candidate = {
  id: string
  full_name: string
  first_name: string | null
  last_name: string | null
  middle_name: string | null
  nickname: string | null
  organization: string | null
  job_title: string | null
  phones: LabeledValue[]
  emails: LabeledValue[]
  addresses: Address[]
  urls: LabeledValue[]
  social_profiles: LabeledValue[]
  birthday_month: number | null
  birthday_day: number | null
  birthday_year: number | null
  anniversary_month: number | null
  anniversary_day: number | null
  anniversary_year: number | null
  note_text: string | null
  related_names: RelatedName[]
  matched_person_id: string | null
  match_confidence: 'high' | 'none'
}
type PersonRef = {
  id: string
  name: string
  last_name: string | null
  nicknames?: string | null
  middle_name?: string | null
  goes_by_other?: string | null
}
type GroupRef = { id: string; name: string; parent_group_id?: string | null }

// What handleAccept actually touched, captured at accept time so handleUndo can put things back
// exactly rather than guessing — a snapshot of the "before" state for an existing-person merge,
// or just the new row's id for a brand-new person.
type ReminderSnapshot = {
  label: 'Birthday' | 'Anniversary'
  before: { id: string; month: number | null; day: number | null; year: number | null } | null
}
type PersonFields = {
  organization: string | null
  job_title: string | null
  phones: LabeledValue[]
  emails: LabeledValue[]
  addresses: Address[]
  urls: LabeledValue[]
  social_profiles: LabeledValue[]
}
// noteIds (plural) because accepting can write two distinct notes: the vCard-derived one from
// buildNoteContent(), and whatever the founder typed or dictated into the review box. Undo has to
// take back both.
type UndoInfo =
  | { kind: 'new'; personId: string; noteIds: string[]; groupIds: string[]; reminders: ReminderSnapshot[] }
  | { kind: 'existing'; personId: string; noteIds: string[]; groupIds: string[]; reminders: ReminderSnapshot[]; before: PersonFields }

const PAGE_SIZE = 20

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatDate(month: number | null, day: number | null, year: number | null): string | null {
  if (!month || !day) return null
  const base = `${MONTH_NAMES[month - 1]} ${day}`
  return year ? `${base}, ${year}` : base
}

function personLabel(p: PersonRef): string {
  return p.last_name ? `${p.name} ${p.last_name}` : p.name
}

// Second-guesses a match import-contacts stored on a candidate, using the same rule the Edge
// Function now applies (src/lib/nameMatchStrength.ts). It's re-checked here as well as there
// because the old word-overlap matcher left this queue full of "is Alex Smith the same person as
// Alex Lesar?" — 574 of the founder's 576 stored matches were that bug — and re-checking on read
// fixes those rows without needing the whole address book re-imported.
function matchIsImplausible(fullName: string, matchedPersonId: string | null, people: Map<string, PersonRef>): boolean {
  if (!matchedPersonId) return false
  const person = people.get(matchedPersonId)
  // Not in the roster we loaded (deleted, or beyond it) — leave the stored match alone rather than
  // clearing one on evidence we don't have.
  if (!person) return false
  const aliases = [person.nicknames, person.middle_name, person.goes_by_other]
    .filter(Boolean)
    .flatMap((v) => String(v).split(','))
  return nameMatchStrength(fullName, personNameKeys(person.name, person.last_name, aliases)) === 'none'
}

const CLEARED_MATCH = { matched_person_id: null, match_confidence: 'none' } as const

function dropImplausibleMatches(rows: Candidate[], people: Map<string, PersonRef>): Candidate[] {
  return rows.map((c) => (matchIsImplausible(c.full_name, c.matched_person_id, people) ? { ...c, ...CLEARED_MATCH } : c))
}

// Same gold dot-badge look as components/Chips.tsx's GroupChip (used app-wide for group tiles),
// but static rather than a real button: that component is always a navigation affordance, and
// navigating away mid-review would unmount this whole paginated page, losing any unsaved name/
// group edits on every OTHER card on it too — a cost this read-only "proof it's really them"
// display shouldn't carry.
function ExistingGroupChip({ label }: { label: string }) {
  return (
    <span style={styles.existingGroupChip}>
      <span style={styles.existingGroupChipDot} />
      {label}
    </span>
  )
}

function normalizeValue(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Union two labeled-value arrays (phones/emails/urls/social_profiles), deduped by normalized
// value, so accepting a contact into an existing person appends new numbers/addresses without
// ever destroying one already on file.
function unionLabeledValues(existing: LabeledValue[], incoming: LabeledValue[]): LabeledValue[] {
  const seen = new Set(existing.map((e) => normalizeValue(e.value)))
  const result = [...existing]
  for (const item of incoming) {
    const key = normalizeValue(item.value)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

function unionAddresses(existing: Address[], incoming: Address[]): Address[] {
  const seen = new Set(existing.map((a) => normalizeValue([a.street, a.city, a.zip].filter(Boolean).join('|'))))
  const result = [...existing]
  for (const item of incoming) {
    const key = normalizeValue([item.street, item.city, item.zip].filter(Boolean).join('|'))
    if (key && !seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

// Detailed accept/reject-with-matching review, structural clone of BirthdayImportReview.tsx, BUT
// scoped to status = 'selected' only — candidates only reach here after the founder deliberately
// picked them on ContactSelection.tsx, never the raw pending set from an upload.
//
// Paginated at PAGE_SIZE (mirrors ContactSelection.tsx's approach — a real import can be 1000+
// selected candidates, and these cards are heavier than that screen's rows, so a smaller page
// keeps the DOM light). Sorted high-confidence matches first: those are quick "just accept" calls,
// so surfacing them ahead of net-new people keeps the harder new-person decisions from being
// mixed in with the fast ones.
type MatchFilter = 'all' | 'existing' | 'new'

export default function ContactImportReview({
  onBack,
  backLabel,
  onSelectPerson,
}: {
  onBack: () => void
  backLabel: string
  onSelectPerson: (id: string, name: string) => void
}) {
  const [page, setPage] = useState(0)
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('all')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [totalSelected, setTotalSelected] = useState(0)
  const [allPeople, setAllPeople] = useState<PersonRef[]>([])
  const [allGroups, setAllGroups] = useState<GroupRef[]>([])
  const [loading, setLoading] = useState(true)

  // The roster has to be in hand before the first page renders, not alongside it: cards read the
  // match off their candidate at mount, so the re-check in dropImplausibleMatches has to happen
  // before setCandidates or a demoted match would still show on screen.
  const rosterRef = useRef<Promise<Map<string, PersonRef>> | null>(null)
  const sweepRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    loadPage()
  }, [page, matchFilter])

  function ensureRoster(): Promise<Map<string, PersonRef>> {
    if (!rosterRef.current) rosterRef.current = loadRoster()
    return rosterRef.current
  }

  // The per-page re-check below keeps what's on screen honest, but the filter buttons and the
  // "N contacts" count are database counts — so a queue full of bad matches would keep claiming
  // hundreds are "Already in Boomer" while every card says otherwise, and the founder would have
  // to visit all 29 pages to clear them. This sweeps the whole selected set once per visit
  // instead. After the first pass it's a near-empty read, since only real matches are left.
  function ensureSweep(roster: Map<string, PersonRef>): Promise<void> {
    if (!sweepRef.current) sweepRef.current = sweepImplausibleMatches(roster)
    return sweepRef.current
  }

  async function sweepImplausibleMatches(roster: Map<string, PersonRef>) {
    const READ_CHUNK = 1000
    const stale: string[] = []
    for (let from = 0; ; from += READ_CHUNK) {
      const { data, error } = await supabase
        .from('contact_import_candidates')
        .select('id, full_name, matched_person_id')
        .eq('status', 'selected')
        .not('matched_person_id', 'is', null)
        .order('id')
        .range(from, from + READ_CHUNK - 1)
      if (error || !data || data.length === 0) break
      for (const row of data) {
        if (matchIsImplausible(row.full_name, row.matched_person_id, roster)) stale.push(row.id)
      }
      if (data.length < READ_CHUNK) break
    }
    // Chunked because the id list travels in the URL — 570 UUIDs in one filter is a ~21KB request.
    for (let i = 0; i < stale.length; i += 100) {
      await supabase.from('contact_import_candidates').update(CLEARED_MATCH).in('id', stale.slice(i, i + 100))
    }
  }

  async function loadRoster(): Promise<Map<string, PersonRef>> {
    const [peopleRes, groupsRes] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from('people')
          .select('id, name, last_name, nicknames, middle_name, goes_by_other')
          .order('name')
          .order('id')
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase.from('groups').select('id, name, parent_group_id').order('name').order('id').range(from, to)
      ),
    ])
    const people = (peopleRes.data as PersonRef[]) ?? []
    setAllPeople(people)
    setAllGroups((groupsRes.data as GroupRef[]) ?? [])
    return new Map(people.map((p) => [p.id, p]))
  }

  // Filtering by whether matched_person_id is set (not match_confidence) is deliberate: it's the
  // same field the "goes to an existing person" vs. "creates someone new" distinction on
  // handleAccept actually keys off of, so the filter matches what accepting a card will really do.
  function applyMatchFilter<T>(query: T): T {
    const q = query as any
    if (matchFilter === 'existing') return q.not('matched_person_id', 'is', null)
    if (matchFilter === 'new') return q.is('matched_person_id', null)
    return q
  }

  async function loadPage() {
    setLoading(true)
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const roster = await ensureRoster()
    await ensureSweep(roster)
    const [candidatesRes, countRes] = await Promise.all([
      applyMatchFilter(
        supabase
          .from('contact_import_candidates')
          .select(
            'id, full_name, first_name, last_name, middle_name, nickname, organization, job_title, phones, emails, addresses, urls, social_profiles, birthday_month, birthday_day, birthday_year, anniversary_month, anniversary_day, anniversary_year, note_text, related_names, matched_person_id, match_confidence'
          )
          .eq('status', 'selected')
      )
        .order('match_confidence', { ascending: true })
        .order('full_name')
        .range(from, to),
      applyMatchFilter(
        supabase.from('contact_import_candidates').select('id', { count: 'exact', head: true }).eq('status', 'selected')
      ),
    ])
    const raw = (candidatesRes.data as Candidate[]) ?? []
    const count = countRes.count ?? 0
    // Guards against a page emptying out mid-review (e.g. accepting the last card on the last
    // page) by stepping back a page instead of showing a false "nothing left to review".
    if (raw.length === 0 && page > 0 && count > 0) {
      setPage((p) => Math.max(0, p - 1))
      return
    }
    setCandidates(dropImplausibleMatches(raw, roster))
    setTotalSelected(count)
    setLoading(false)
  }

  function handleFilterChange(next: MatchFilter) {
    setMatchFilter(next)
    setPage(0)
  }

  function handleGroupCreated(group: GroupRef) {
    setAllGroups((prev) => [...prev, group].sort((a, b) => a.name.localeCompare(b.name)))
  }

  // Reject removes the card outright (nothing to confirm), so it refetches the whole page —
  // pulling in the next candidate from the total set rather than the page slowly shrinking.
  async function handleRejected() {
    await loadPage()
  }

  // Accept leaves its card in place showing a quiet "Saved contact info for X" confirmation
  // (see CandidateCard's savedLabel), so this only refreshes the total count for the footer —
  // a full reload would yank the confirmation off-screen before it's seen.
  async function handleAccepted() {
    const { count } = await applyMatchFilter(
      supabase.from('contact_import_candidates').select('id', { count: 'exact', head: true }).eq('status', 'selected')
    )
    setTotalSelected(count ?? 0)
  }

  const totalPages = Math.max(1, Math.ceil(totalSelected / PAGE_SIZE))

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Review contacts</h1>
      <p style={styles.intro}>
        These are the contacts you chose to bring in. Confirm who each one is, adjust their name
        or groups if you'd like, then accept or reject — nothing is saved to a profile until you
        say yes.
      </p>

      <div style={styles.filterRow}>
        {(
          [
            ['all', 'All'],
            ['existing', 'Already in Boomer'],
            ['new', 'New people'],
          ] as [MatchFilter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => handleFilterChange(value)}
            style={matchFilter === value ? styles.filterButtonActive : styles.filterButton}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={styles.body}>Loading…</p>
      ) : candidates.length === 0 ? (
        <p style={styles.body}>
          {matchFilter === 'all' ? 'Nothing left to review.' : 'Nothing left in this filter — try "All".'}
        </p>
      ) : (
        candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            allPeople={allPeople}
            allGroups={allGroups}
            onGroupCreated={handleGroupCreated}
            onAccepted={handleAccepted}
            onRejected={handleRejected}
            onSelectPerson={onSelectPerson}
          />
        ))
      )}

      {totalSelected > 0 && (
        <div style={styles.pagination}>
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={styles.pageButton}>
            ← Prev
          </button>
          <span style={styles.pageLabel}>
            Page {page + 1} of {totalPages} — {totalSelected} contact{totalSelected === 1 ? '' : 's'}
          </span>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= totalPages} style={styles.pageButton}>
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

function CandidateCard({
  candidate,
  allPeople,
  allGroups,
  onGroupCreated,
  onAccepted,
  onRejected,
  onSelectPerson,
}: {
  candidate: Candidate
  allPeople: PersonRef[]
  allGroups: GroupRef[]
  onGroupCreated: (group: GroupRef) => void
  onAccepted: () => void
  onRejected: () => void
  onSelectPerson: (id: string, name: string) => void
}) {
  const [linkedPersonId, setLinkedPersonId] = useState<string | null>(candidate.matched_person_id)
  const [pickerOpen, setPickerOpen] = useState(candidate.match_confidence !== 'high')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedLabel, setSavedLabel] = useState<string | null>(null)
  const [savedPersonId, setSavedPersonId] = useState<string | null>(null)
  const [undoInfo, setUndoInfo] = useState<UndoInfo | null>(null)

  // Prefilled from the parsed vCard data but editable — this review pass is effectively the only
  // chance to fix a name before it becomes a real profile, since nobody comes back later to a
  // person out of a 1000+-contact import just to correct a name.
  const [firstNameInput, setFirstNameInput] = useState(candidate.first_name || candidate.full_name.split(' ')[0] || '')
  const [middleNameInput, setMiddleNameInput] = useState(candidate.middle_name || '')
  const [lastNameInput, setLastNameInput] = useState(candidate.last_name || '')

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])

  // Free-text (typed or dictated) memory of who this person actually is. This review pass is the
  // only realistic moment anyone will add it — nobody comes back to a name out of a 1000-contact
  // import later just to write down how they know them.
  const [noteText, setNoteText] = useState('')
  const [transcribing, setTranscribing] = useState(false)

  // The linked person's CURRENT groups (read-only, distinct from selectedGroupIds above, which
  // are new tags this session is about to add). Shown so a match to an existing person comes with
  // visible proof it's really them — not just a name, but the groups you already know them by.
  const [existingPersonGroups, setExistingPersonGroups] = useState<GroupRef[]>([])

  const linkedPerson = allPeople.find((p) => p.id === linkedPersonId) ?? null
  // Built from the full roster so a subgroup's parent name resolves even when the parent isn't
  // itself one of this person's existing/selected groups.
  const groupNameById = useMemo(() => new Map(allGroups.map((g) => [g.id, g.name])), [allGroups])
  // Lets groupDisplayName walk the whole ancestor chain rather than stopping at one level.
  const groupParentById = useMemo(
    () => new Map(allGroups.map((g) => [g.id, g.parent_group_id ?? null])),
    [allGroups]
  )
  const birthdayLabel = formatDate(candidate.birthday_month, candidate.birthday_day, candidate.birthday_year)
  const anniversaryLabel = formatDate(candidate.anniversary_month, candidate.anniversary_day, candidate.anniversary_year)

  useEffect(() => {
    if (!linkedPersonId) {
      setExistingPersonGroups([])
      return
    }
    let cancelled = false
    supabase
      .from('person_groups')
      .select('groups(id, name, parent_group_id)')
      .eq('person_id', linkedPersonId)
      .then(({ data }) => {
        if (cancelled) return
        const groups = ((data as { groups: GroupRef | null }[] | null) ?? [])
          .map((row) => row.groups)
          .filter((g): g is GroupRef => !!g)
        setExistingPersonGroups(groups)
      })
    return () => {
      cancelled = true
    }
  }, [linkedPersonId])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return allPeople.filter((p) => personLabel(p).toLowerCase().includes(q)).slice(0, 8)
  }, [search, allPeople])

  const selectedGroups = selectedGroupIds
    .map((id) => allGroups.find((g) => g.id === id))
    .filter((g): g is GroupRef => !!g)

  function addGroup(id: string) {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }

  function removeGroup(id: string) {
    setSelectedGroupIds((prev) => prev.filter((g) => g !== id))
  }

  // Same find-or-create logic as PersonDetail.tsx's confirmSuggestedGroup — case-insensitive
  // match against existing groups, else create one. The new group is pushed up to the page-level
  // roster so it's immediately selectable for the next candidate in this same review session too.
  async function handleCreateGroup(name: string) {
    const existing = allGroups.find((g) => g.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      addGroup(existing.id)
      return
    }
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data: newGroup, error } = await supabase
      .from('groups')
      .insert({ user_id: user?.id, name })
      .select('id, name')
      .single()
    if (error || !newGroup) return
    onGroupCreated(newGroup as GroupRef)
    addGroup(newGroup.id)
  }

  async function markReviewed(status: 'accepted' | 'rejected', personId: string | null) {
    await supabase
      .from('contact_import_candidates')
      .update({ status, reviewed_at: new Date().toISOString(), matched_person_id: personId })
      .eq('id', candidate.id)
  }

  function buildNoteContent(): string | null {
    const lines: string[] = []
    if (candidate.note_text) lines.push(candidate.note_text)
    for (const rel of candidate.related_names) lines.push(`Apple relationship: ${rel.label} — ${rel.name}`)
    return lines.length > 0 ? lines.join('\n') : null
  }

  async function snapshotReminder(personId: string, label: 'Birthday' | 'Anniversary') {
    const { data } = await supabase.from('reminders').select('id, month, day, year').eq('person_id', personId).eq('label', label).maybeSingle()
    return data ?? null
  }

  async function handleAccept() {
    setSaving(true)
    let personId: string | null = linkedPersonId
    let undo: UndoInfo

    if (!personId) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: newPerson, error } = await supabase
        .from('people')
        .insert({
          user_id: user?.id,
          name: firstNameInput.trim() || candidate.full_name.split(' ')[0],
          last_name: lastNameInput.trim() || null,
          middle_name: middleNameInput.trim() || null,
          nicknames: candidate.nickname,
          organization: candidate.organization,
          job_title: candidate.job_title,
          phones: candidate.phones,
          emails: candidate.emails,
          addresses: candidate.addresses,
          urls: candidate.urls,
          social_profiles: candidate.social_profiles,
        })
        .select()
        .single()
      if (error || !newPerson) {
        setSaving(false)
        return
      }
      personId = newPerson.id
      undo = { kind: 'new', personId: personId as string, noteIds: [], groupIds: [], reminders: [] }
    } else {
      const { data: existingPerson } = await supabase
        .from('people')
        .select('organization, job_title, phones, emails, addresses, urls, social_profiles')
        .eq('id', personId)
        .maybeSingle()
      undo = {
        kind: 'existing',
        personId,
        noteIds: [],
        groupIds: [],
        reminders: [],
        before: {
          organization: existingPerson?.organization ?? null,
          job_title: existingPerson?.job_title ?? null,
          phones: existingPerson?.phones ?? [],
          emails: existingPerson?.emails ?? [],
          addresses: existingPerson?.addresses ?? [],
          urls: existingPerson?.urls ?? [],
          social_profiles: existingPerson?.social_profiles ?? [],
        },
      }
      if (existingPerson) {
        await supabase
          .from('people')
          .update({
            organization: existingPerson.organization || candidate.organization,
            job_title: existingPerson.job_title || candidate.job_title,
            phones: unionLabeledValues(existingPerson.phones ?? [], candidate.phones),
            emails: unionLabeledValues(existingPerson.emails ?? [], candidate.emails),
            addresses: unionAddresses(existingPerson.addresses ?? [], candidate.addresses),
            urls: unionLabeledValues(existingPerson.urls ?? [], candidate.urls),
            social_profiles: unionLabeledValues(existingPerson.social_profiles ?? [], candidate.social_profiles),
          })
          .eq('id', personId)
      }
    }

    if (candidate.birthday_month && candidate.birthday_day) {
      undo.reminders.push({ label: 'Birthday', before: await snapshotReminder(personId as string, 'Birthday') })
      await upsertReminder(personId as string, 'Birthday', {
        month: candidate.birthday_month,
        day: candidate.birthday_day,
        year: candidate.birthday_year,
      })
    }
    if (candidate.anniversary_month && candidate.anniversary_day) {
      undo.reminders.push({ label: 'Anniversary', before: await snapshotReminder(personId as string, 'Anniversary') })
      await upsertReminder(personId as string, 'Anniversary', {
        month: candidate.anniversary_month,
        day: candidate.anniversary_day,
        year: candidate.anniversary_year,
      })
    }

    const noteContent = buildNoteContent()
    if (noteContent) {
      const { data: newNote } = await supabase
        .from('notes')
        .insert({ person_id: personId, content: noteContent, source: 'contacts_import' })
        .select('id')
        .single()
      if (newNote?.id) undo.noteIds.push(newNote.id)
    }

    // Kept as its own row rather than appended to the note above: that one is machine-derived
    // (the vCard's NOTE field, Apple's relationship labels), this one is the founder's own words,
    // and PersonDetail badges them differently because of it.
    const typedNote = noteText.trim()
    if (typedNote) {
      const { data: newNote } = await supabase
        .from('notes')
        .insert({ person_id: personId, content: typedNote, source: 'review_note' })
        .select('id')
        .single()
      if (newNote?.id) undo.noteIds.push(newNote.id)
    }

    if (selectedGroupIds.length > 0) {
      await supabase
        .from('person_groups')
        .upsert(
          selectedGroupIds.map((groupId) => ({ person_id: personId, group_id: groupId })),
          { onConflict: 'person_id,group_id', ignoreDuplicates: true }
        )
      undo.groupIds = selectedGroupIds
    }

    await markReviewed('accepted', personId)
    setSaving(false)
    setUndoInfo(undo)
    setSavedLabel(linkedPerson ? personLabel(linkedPerson) : candidate.full_name)
    setSavedPersonId(personId)
    onAccepted()
  }

  async function handleReject() {
    setSaving(true)
    await markReviewed('rejected', linkedPersonId)
    setSaving(false)
    onRejected()
  }

  // Reverses exactly what handleAccept did, using the snapshot captured at accept time — deletes
  // whatever was newly created (person, note, group tags, reminders) or restores whatever an
  // existing person's fields looked like before the merge, then puts the candidate back to
  // 'selected' so it reappears in the queue to be reviewed again (e.g. via the "add as new"
  // escape hatch above, for exactly the wrong-match case this was built for).
  async function handleUndo() {
    if (!undoInfo) return
    setSaving(true)

    if (undoInfo.noteIds.length > 0) {
      await supabase.from('notes').delete().in('id', undoInfo.noteIds)
    }
    if (undoInfo.groupIds.length > 0) {
      await supabase.from('person_groups').delete().eq('person_id', undoInfo.personId).in('group_id', undoInfo.groupIds)
    }
    for (const r of undoInfo.reminders) {
      if (r.before) {
        await supabase.from('reminders').update({ month: r.before.month, day: r.before.day, year: r.before.year }).eq('id', r.before.id)
      } else {
        await supabase.from('reminders').delete().eq('person_id', undoInfo.personId).eq('label', r.label)
      }
    }

    if (undoInfo.kind === 'new') {
      await supabase.from('people').delete().eq('id', undoInfo.personId)
    } else {
      await supabase.from('people').update(undoInfo.before).eq('id', undoInfo.personId)
    }

    await supabase
      .from('contact_import_candidates')
      .update({ status: 'selected', reviewed_at: null, matched_person_id: candidate.matched_person_id })
      .eq('id', candidate.id)

    setLinkedPersonId(candidate.matched_person_id)
    setPickerOpen(candidate.match_confidence !== 'high')
    setSearch('')
    setFirstNameInput(candidate.first_name || candidate.full_name.split(' ')[0] || '')
    setMiddleNameInput(candidate.middle_name || '')
    setLastNameInput(candidate.last_name || '')
    setSelectedGroupIds([])
    // noteText is deliberately NOT reset. Everything else here is derived from the candidate, but
    // this is the founder's own words — undoing a wrong match shouldn't make them retype it.
    setUndoInfo(null)
    setSavedLabel(null)
    setSavedPersonId(null)
    setSaving(false)
    onAccepted()
  }

  if (savedLabel) {
    return (
      <div style={styles.card}>
        <p style={styles.confirmText}>
          Saved contact info for {savedLabel}.{' '}
          <button type="button" onClick={handleUndo} disabled={saving} style={styles.linkButton}>
            {saving ? '…' : 'Undo'}
          </button>
        </p>
        {savedPersonId && (
          <button
            type="button"
            onClick={() => onSelectPerson(savedPersonId, savedLabel)}
            style={styles.viewProfileButton}
          >
            View profile →
          </button>
        )}
      </div>
    )
  }

  // Shared by both picker branches: inside the match callout it's the "or link to someone
  // else" fallback, and without a match it's the only way to link to an existing person.
  const searchArea = (
    <>
      <SearchBox value={search} onChange={setSearch} placeholder="Search your people…" />
      {searchResults.length > 0 && (
        <div style={styles.searchResults}>
          {searchResults.map((p) => (
            <button
              key={p.id}
              type="button"
              style={styles.searchResultRow}
              onClick={() => {
                setLinkedPersonId(p.id)
                setPickerOpen(false)
                setSearch('')
              }}
            >
              {personLabel(p)}
            </button>
          ))}
        </div>
      )}
    </>
  )

  return (
    <div style={styles.card}>
      <p style={styles.cardTitle}>{candidate.full_name}</p>
      {(candidate.organization || candidate.job_title) && (
        <p style={styles.metaText}>{[candidate.job_title, candidate.organization].filter(Boolean).join(' at ')}</p>
      )}
      {birthdayLabel && <p style={styles.metaText}>Birthday: {birthdayLabel}</p>}
      {anniversaryLabel && <p style={styles.metaText}>Anniversary: {anniversaryLabel}</p>}
      {candidate.phones.length > 0 && (
        <p style={styles.metaText}>{candidate.phones.map((p) => `${p.label}: ${p.value}`).join(' · ')}</p>
      )}
      {candidate.emails.length > 0 && (
        <p style={styles.metaText}>{candidate.emails.map((e) => `${e.label}: ${e.value}`).join(' · ')}</p>
      )}
      {candidate.addresses.length > 0 && (
        <p style={styles.metaText}>
          {candidate.addresses.map((a) => `${a.label}: ${[a.street, a.city, a.state].filter(Boolean).join(', ')}`).join(' · ')}
        </p>
      )}

      <div style={styles.linkSection}>
        {linkedPerson && !pickerOpen ? (
          <>
            <p style={styles.linkedLine}>
              <span style={styles.linkedTick}>✓</span> Goes to{' '}
              <span style={styles.linkedName}>{personLabel(linkedPerson)}</span>{' '}
              <button type="button" onClick={() => setPickerOpen(true)} style={styles.linkButton}>
                change
              </button>
            </p>
            {existingPersonGroups.length > 0 && (
              <div style={styles.existingGroupsBlock}>
                <p style={styles.matchGroupsLabel}>Already in:</p>
                <div style={styles.chipRow}>
                  {existingPersonGroups.map((g) => (
                    <ExistingGroupChip key={g.id} label={groupDisplayName(g, groupNameById, groupParentById)} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div>
            {linkedPerson ? (
              // "No — add as new person" is the escape hatch for a wrong auto-match (e.g. two
              // different people sharing a phone number). Clearing linkedPersonId flips the view
              // below to the !linkedPerson branch, which shows the editable name fields for a
              // brand-new person.
              <MatchCallout
                candidateName={candidate.full_name}
                matchName={personLabel(linkedPerson)}
                onConfirm={() => setPickerOpen(false)}
                onNotSame={() => {
                  setLinkedPersonId(null)
                  setSearch('')
                }}
                evidence={
                  existingPersonGroups.length > 0 ? (
                    <div style={styles.existingGroupsBlock}>
                      <p style={styles.matchGroupsLabel}>{personLabel(linkedPerson)} is already in:</p>
                      <div style={styles.chipRow}>
                        {existingPersonGroups.map((g) => (
                          <ExistingGroupChip key={g.id} label={groupDisplayName(g, groupNameById, groupParentById)} />
                        ))}
                      </div>
                    </div>
                  ) : null
                }
              >
                {searchArea}
              </MatchCallout>
            ) : (
              <>
                <p style={styles.body}>
                  Couldn't match this to anyone on file — add as a new person, or link to someone existing:
                </p>
                {searchArea}
                <p style={styles.body}>
                  Leaving this blank and accepting will add <strong>{candidate.full_name}</strong> as a new person.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {!linkedPerson && (
        <div style={styles.nameSection}>
          <p style={styles.body}>Name to save:</p>
          <div style={styles.nameRow}>
            <input
              value={firstNameInput}
              onChange={(e) => setFirstNameInput(e.target.value)}
              placeholder="First"
              style={styles.nameInput}
            />
            <input
              value={middleNameInput}
              onChange={(e) => setMiddleNameInput(e.target.value)}
              placeholder="Middle"
              style={styles.nameInput}
            />
            <input
              value={lastNameInput}
              onChange={(e) => setLastNameInput(e.target.value)}
              placeholder="Last"
              style={styles.nameInput}
            />
          </div>
        </div>
      )}

      <div style={styles.groupSection}>
        <p style={styles.body}>Add to groups:</p>
        {selectedGroups.length > 0 && (
          <div style={styles.chipRow}>
            {selectedGroups.map((g) => (
              <span key={g.id} style={styles.chip}>
                {groupDisplayName(g, groupNameById, groupParentById)}
                <button type="button" onClick={() => removeGroup(g.id)} style={styles.chipRemove} aria-label={`Remove ${groupDisplayName(g, groupNameById, groupParentById)}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <SearchAddPicker
          items={allGroups
            .filter((g) => !selectedGroupIds.includes(g.id) && !existingPersonGroups.some((eg) => eg.id === g.id))
            .map((g) => ({ id: g.id, label: groupDisplayName(g, groupNameById, groupParentById) }))}
          placeholder="Tag a group…"
          onSelect={(item) => addGroup(item.id)}
          onCreateNew={handleCreateGroup}
          createLabel={(q) => `+ Create group "${q}"`}
          emptyText="No groups match."
          browseAll
        />
      </div>

      <ReviewNoteField
        label="Anything you want to remember about them? (optional)"
        value={noteText}
        onChange={setNoteText}
        placeholder="How you know them, who they're related to, anything worth keeping…"
        disabled={saving}
        onBusyChange={setTranscribing}
      />

      <div style={styles.buttonRow}>
        <button type="button" onClick={handleAccept} disabled={saving || transcribing} style={styles.acceptButton}>
          {saving ? '…' : 'Accept'}
        </button>
        <button type="button" onClick={handleReject} disabled={saving} style={styles.rejectButton}>
          Reject
        </button>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily },
  backButton: { background: 'none', border: 'none', color: colors.ink, fontSize: fontSize.base, cursor: 'pointer', marginBottom: '1rem', padding: 0 },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: '0 0 0.5rem' },
  intro: { fontSize: fontSize.bodyLg, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 1.25rem' },
  filterRow: { display: 'flex', gap: space.md, marginBottom: '1.25rem', flexWrap: 'wrap' },
  filterButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.pill,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily,
  },
  filterButtonActive: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  body: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.5rem' },
  card: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  cardTitle: { fontSize: fontSize.lead, color: colors.ink, margin: '0 0 0.25rem', fontWeight: 'bold' },
  metaText: { fontSize: fontSize.label, color: colors.textMuted, margin: '0 0 0.25rem' },
  linkSection: { margin: '0.75rem 0' },
  linkedLine: { fontSize: fontSize.bodyLg, color: colors.textBody, lineHeight: 1.5, margin: '0 0 0.5rem' },
  linkedTick: { color: colors.success, fontWeight: 700 },
  linkedName: { color: colors.ink, fontWeight: 700 },
  existingGroupsBlock: { margin: '0 0 0.5rem' },
  matchGroupsLabel: { fontSize: fontSize.small, color: colors.textMuted, margin: '0 0 0.35rem' },
  existingGroupChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: fontSize.small,
    fontWeight: 700,
    padding: '0.3rem 0.7rem 0.3rem 0.6rem',
    borderRadius: radius.md,
    border: border.suggestFill,
    backgroundColor: colors.suggestBg,
    color: colors.suggest,
    fontFamily,
    letterSpacing: '0.02em',
  },
  existingGroupChipDot: {
    width: '6px',
    height: '6px',
    borderRadius: radius.circle,
    backgroundColor: colors.suggestFill,
    flexShrink: 0,
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: fontSize.label,
    fontFamily,
    padding: 0,
  },
  searchResults: { display: 'flex', flexDirection: 'column', gap: space.xs, marginBottom: '0.5rem' },
  searchResultRow: {
    textAlign: 'left',
    fontSize: fontSize.body,
    padding: '0.4rem 0.6rem',
    borderRadius: radius.sm,
    border: `1px solid ${neutral.grey100}`,
    backgroundColor: colors.surfaceSunk,
    cursor: 'pointer',
    fontFamily,
  },
  buttonRow: { display: 'flex', gap: '0.6rem' },
  acceptButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  rejectButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.danger,
    cursor: 'pointer',
    fontFamily,
  },
  confirmText: { color: colors.success, fontSize: fontSize.bodyLg, margin: '0 0 0.6rem' },
  viewProfileButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  nameSection: { margin: '0 0 0.75rem' },
  nameRow: { display: 'flex', gap: space.md, flexWrap: 'wrap' },
  nameInput: {
    flex: '1 1 120px',
    fontSize: fontSize.body,
    padding: '0.45rem 0.6rem',
    borderRadius: radius.sm,
    border: border.default,
    fontFamily,
    color: colors.inkPlain,
  },
  groupSection: { margin: '0 0 1rem' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: fontSize.label,
    padding: '0.3rem 0.5rem',
    borderRadius: radius.pill,
    backgroundColor: neutral.sageWash,
    color: colors.ink,
  },
  chipRemove: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    cursor: 'pointer',
    fontSize: fontSize.body,
    lineHeight: 1,
    padding: 0,
  },
  pagination: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space.xl, marginTop: '0.5rem' },
  pageButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
  pageLabel: { fontSize: fontSize.label, color: colors.textMuted },
}
