import { useEffect, useState, type FormEvent, type Dispatch, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import { summarize } from '../lib/summarize'
import { EventChip, PersonChip } from '../components/Chips'
import VoiceInputButton from '../components/VoiceInputButton'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import PhotoGallery from '../components/PhotoGallery'
import ContactInfoSection from '../components/ContactInfoSection'
import PetsSection from '../components/PetsSection'
import type { Pet } from '../lib/pets'
import RefreshButton from '../components/RefreshButton'
import RetractFactPanel from '../components/RetractFactPanel'
import SearchBox from '../components/SearchBox'
import SearchAddPicker from '../components/SearchAddPicker'
import EditButton from '../components/EditButton'
import RelationshipSuggestionBanners, {
  toStagedNewPersonSuggestions,
  type RelationshipSuggestion,
  type NewPersonSuggestion,
} from '../components/RelationshipSuggestions'
import { groupDisplayName } from '../lib/groupDisplayName'
import { loadFamilyGraph } from '../lib/familyTree'
import { calculateRelationship, describeKinPath } from '../lib/relationshipCalculator'
import { guessGenderFromName } from '../lib/nameGender'
import { IS_TOUCH } from '../lib/touch'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, shadow, space } from '../lib/theme'
import { personLabel } from '../lib/personLabel'
import { formerNameLine, parseFormerLastNames } from '../lib/formerNames'

export type Note = {
  id: string
  content: string
  created_at: string
  moment_id: string | null
  moments: { id: string; occasion: string | null; raw_description: string } | null
  source: string | null
  source_group_id: string | null
  groups: { id: string; name: string; parent_group_id?: string | null } | null
}

export type GroupRef = { id: string; name: string; parent_group_id?: string | null }

export type PersonRow = {
  name: string
  last_name: string | null
  middle_name: string | null
  goes_by_kind: 'first' | 'middle' | 'last' | 'other' | null
  goes_by_other: string | null
  former_last_names?: string | null
  how_you_know_them?: string | null
  deceased_date?: string | null
}

// Which of first/middle/last/other actually displays as this person's name on their profile —
// e.g. going by a middle name or a callsign. Falls back to the legal first name when unset.
export function computeFullName(person: PersonRow): string {
  if (person.goes_by_kind === 'middle' && person.middle_name) return `${person.middle_name} ${person.last_name ?? ''}`.trim()
  if (person.goes_by_kind === 'other' && person.goes_by_other) return `${person.goes_by_other} ${person.last_name ?? ''}`.trim()
  if (person.goes_by_kind === 'last' && person.last_name) return person.last_name
  return `${person.name} ${person.last_name ?? ''}`.trim()
}

type LinkedPerson = { name: string; personId?: string }

export type KeyFact = {
  category: 'spouse' | 'partner' | 'siblings' | 'parents' | 'kids' | 'location' | 'education' | 'other'
  text?: string
  relationshipLabel?: string
  people?: LinkedPerson[]
}

type OtherPerson = { id: string; name: string; last_name: string | null }

// Fixed display order so Key Facts read the same way on every profile, regardless of
// the order the AI extracted them in. Categories not listed here keep their relative order,
// appended after the relationship facts.
const KEY_FACT_CATEGORY_ORDER: Partial<Record<KeyFact['category'], number>> = {
  parents: 0,
  spouse: 1,
  // Sits beside spouse rather than after the kids: it answers the same question, and only one of
  // the two is ever on a profile in practice.
  partner: 2,
  siblings: 3,
  kids: 4,
}
/** The chip as plain text, so the retraction panel can quote back the exact thing being cleared
 *  ("Dating Olivia") instead of asking about "this fact". Mirrors KeyFactItem's own rendering —
 *  the real names, never the "You" substitution, since this is a question about stored data. */
export function keyFactLabel(fact: KeyFact): string {
  if (fact.people && fact.people.length > 0) {
    return [fact.relationshipLabel, fact.people.map((p) => p.name).join(', ')].filter(Boolean).join(' ')
  }
  return fact.text ?? ''
}

export function sortKeyFacts(facts: KeyFact[]): KeyFact[] {
  return facts
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => {
      const orderA = KEY_FACT_CATEGORY_ORDER[a.fact.category] ?? Number.MAX_SAFE_INTEGER
      const orderB = KEY_FACT_CATEGORY_ORDER[b.fact.category] ?? Number.MAX_SAFE_INTEGER
      return orderA !== orderB ? orderA - orderB : a.index - b.index
    })
    .map(({ fact }) => fact)
}

const AFFILIATION_LIMIT = 5

// Placeholder name a manually-created ("+ Add Person") profile starts with — matches
// "Untitled moment"/"New group" being manual-shell placeholders elsewhere. Used to swap in a
// name-specific nudge instead of the generic one until it's renamed (either via the pencil
// icon below or conversationally through the fact bar).
export const NEW_PERSON_PLACEHOLDER = 'New person'

// Mirrors the deterministic note phrasings RECIPROCAL_NOTE writes in
// supabase/functions/_shared/relationships.ts — used only to retroactively spot a last-name
// suggestion on a profile that was created with a bare first name (e.g. "Ale's wife is Molly").
// Keep these patterns in sync if that module's phrasing ever changes.
const RELATIONSHIP_NOTE_PATTERNS: RegExp[] = [
  /^Married to (.+)\.$/i,
  /^Their sibling is (.+)\.$/i,
  /^Their child is (.+)\.$/i,
  /^Their parent is (.+)\.$/i,
  /^In a relationship with (.+)\.$/i,
]

// `satisfiedBy` is every category that answers the question, not just the one it's named for —
// "Is X married?" is a silly thing to keep asking about someone already recorded as dating.
const NUDGE_CATEGORIES: {
  category: 'spouse' | 'kids' | 'location' | 'education'
  satisfiedBy: KeyFact['category'][]
  question: (name: string) => string
}[] = [
  { category: 'spouse', satisfiedBy: ['spouse', 'partner'], question: (name) => `Is ${name} married? If so, what's their spouse's name?` },
  { category: 'kids', satisfiedBy: ['kids'], question: (name) => `Does ${name} have kids? What are their names?` },
  { category: 'location', satisfiedBy: ['location'], question: (name) => `Where does ${name} live?` },
  { category: 'education', satisfiedBy: ['education'], question: (name) => `Where did ${name} go to school?` },
]

export default function PersonDetail({
  personId,
  personName,
  onBack,
  backLabel,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onSelectPet,
  onMerged,
  onRenamed,
  onOpenFamilyTree,
}: {
  personId: string
  personName: string
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onSelectPet: (pet: { id: string; name: string }) => void
  onMerged: (person: { id: string; name: string }) => void
  onRenamed?: (newName: string) => void
  onOpenFamilyTree: (personId: string, label: string, memberIds?: string[]) => void
}) {
  const [notes, setNotes] = useState<Note[]>([])
  const [groups, setGroups] = useState<GroupRef[]>([])
  const [allGroupsList, setAllGroupsList] = useState<GroupRef[]>([])
  const [person, setPerson] = useState<PersonRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [firstNameInput, setFirstNameInput] = useState('')
  const [lastNameInput, setLastNameInput] = useState('')
  const [middleNameInput, setMiddleNameInput] = useState('')
  const [goesByKind, setGoesByKind] = useState<'first' | 'middle' | 'last' | 'other'>('first')
  const [goesByOtherInput, setGoesByOtherInput] = useState('')
  const [formerNameInput, setFormerNameInput] = useState('')
  const [howYouKnowInput, setHowYouKnowInput] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [newFact, setNewFact] = useState('')
  const [saving, setSaving] = useState(false)
  const [groupTagMessage, setGroupTagMessage] = useState<string | null>(null)
  const [suggestedGroup, setSuggestedGroup] = useState<string | null>(null)
  const [familyTagMessage, setFamilyTagMessage] = useState<string | null>(null)
  const [factError, setFactError] = useState<string | null>(null)
  const [relationshipSuggestions, setRelationshipSuggestions] = useState<RelationshipSuggestion[]>([])
  const [newPersonSuggestions, setNewPersonSuggestions] = useState<NewPersonSuggestion[]>([])
  const [keyFacts, setKeyFacts] = useState<KeyFact[]>([])
  // Which Key Fact the user has opened the "that's not right" panel on, by its index in the
  // rendered list. Index rather than a fact id because key_facts is a cached jsonb blob with no
  // stable ids, and it is re-sorted deterministically on load.
  const [retractingFactIndex, setRetractingFactIndex] = useState<number | null>(null)
  const [factsLoading, setFactsLoading] = useState(true)
  // Only ever set by an explicit refresh. A passive visit that hits a failed extraction still has
  // the cached facts to show and nothing useful to say about it; a refresh the user asked for and
  // that silently changed nothing is the case worth naming.
  const [factsFailed, setFactsFailed] = useState(false)
  const [selfId, setSelfId] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(true)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [otherPeople, setOtherPeople] = useState<OtherPerson[]>([])
  const [mergeCandidate, setMergeCandidate] = useState<OtherPerson | null>(null)
  const [lastNameSuggestion, setLastNameSuggestion] = useState<{ lastName: string; sourceName: string } | null>(null)
  const [deceasedDateInput, setDeceasedDateInput] = useState('')
  const [savingDeceased, setSavingDeceased] = useState(false)
  const [gender, setGender] = useState<string | null>(null)
  const [savingGender, setSavingGender] = useState(false)
  const [kinToSelf, setKinToSelf] = useState<{ label: string; path: string } | null>(null)

  useEffect(() => {
    setLastNameSuggestion(null)
    setEditingName(false)
    loadData()
    loadGroupsList()
    loadGender()
  }, [personId])

  // Fetched once, not per-profile, and in its own query rather than folded into loadData — same
  // reasoning as EventDetail's identical lookup. Only used to word a Key Facts chip as "You"
  // (item 33), so if it never resolves the page just keeps showing the founder's own name.
  useEffect(() => {
    supabase
      .from('people')
      .select('id')
      .eq('is_self', true)
      .maybeSingle()
      .then(({ data }) => setSelfId(data?.id ?? null))
  }, [])

  // How this person is related to you, in words. Deliberately NOT part of loadData's Promise.all:
  // it costs the same three queries the family tree already pays, and the profile shouldn't wait on
  // them to paint. Nothing renders unless there's something worth saying, so a friend with no
  // family link on file gets no "not related" noise.
  useEffect(() => {
    let cancelled = false
    setKinToSelf(null)
    loadFamilyGraph().then((g) => {
      if (cancelled || !g.selfId || g.selfId === personId) return
      const k = calculateRelationship(g, g.selfId, personId)
      if (k.kind === 'unrelated') return
      setKinToSelf({ label: k.label, path: describeKinPath(g, k) })
    })
    return () => {
      cancelled = true
    }
  }, [personId])

  // Own query, separate from the main person select in loadData() below — see the "isolate a new
  // column" gotcha in project_boomer_infra.md: bundling `gender` into that shared select would 400
  // the WHOLE profile page (name, notes, everything) until the migration adding the column has run.
  async function loadGender() {
    const { data } = await supabase.from('people').select('gender').eq('id', personId).maybeSingle()
    setGender(data?.gender ?? null)
  }

  async function saveGender(value: string) {
    setSavingGender(true)
    const newValue = value || null
    const { error } = await supabase.from('people').update({ gender: newValue }).eq('id', personId)
    setSavingGender(false)
    if (error) return
    setGender(newValue)
  }

  // Full group roster for the manual "tag a group" search box below — separate from `groups`
  // (this person's actual memberships), same split EventDetail.tsx uses for its own group tagger.
  async function loadGroupsList() {
    const { data } = await fetchAllRows((from, to) =>
      supabase.from('groups').select('id, name, parent_group_id').order('name').order('id').range(from, to)
    )
    setAllGroupsList((data as GroupRef[]) ?? [])
  }

  // The "✓ Also added … to …" banner names a group the same way the chips above it do, so a
  // subgroup doesn't read as a bare "Pilots". A group created by the very call that produced the
  // banner isn't in allGroupsList yet — that falls back to the bare name it came back with.
  function labelForGroupId(id: string | null | undefined, fallbackName: string): string {
    const group = allGroupsList.find((g) => g.id === id)
    if (!group) return fallbackName
    return groupDisplayName(
      group,
      new Map(allGroupsList.map((g) => [g.id, g.name])),
      new Map(allGroupsList.map((g) => [g.id, g.parent_group_id ?? null]))
    )
  }

  useEffect(() => {
    if (loading || person?.last_name) {
      if (!loading) setLastNameSuggestion(null)
      return
    }
    checkLastNameSuggestion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, loading, notes, person?.last_name])

  // Retroactive nudge for a profile that already exists with only a first name (e.g. created via
  // a relationship suggestion before this last-name inference existed, or from before the other
  // person had a last name on file themselves) — looks for one of this app's own deterministic
  // relationship notes, resolves the named person, and offers their last name if they have one.
  // Only ever a suggestion; confirming updates the record, declining just clears the banner.
  async function checkLastNameSuggestion() {
    let sourceRawName: string | null = null
    for (const note of notes) {
      for (const pattern of RELATIONSHIP_NOTE_PATTERNS) {
        const match = note.content.trim().match(pattern)
        if (match) {
          sourceRawName = match[1].trim()
          break
        }
      }
      if (sourceRawName) break
    }
    if (!sourceRawName) return

    // Paged: this is the last-name suggestion, and it decides by finding EXACTLY ONE match across
    // everyone on file. A truncated candidate list turns "no match, stay quiet" into the wrong
    // answer silently — and worse, could make an ambiguous name look unique.
    const { data: candidates } = await fetchAllRows((from, to) =>
      supabase
        .from('people')
        .select('name, last_name')
        .neq('id', personId)
        .not('last_name', 'is', null)
        .order('id')
        .range(from, to)
    )
    const match = candidates.find((p) => {
      const full = `${p.name} ${p.last_name}`.trim()
      return full.toLowerCase() === sourceRawName!.toLowerCase() || p.name.toLowerCase() === sourceRawName!.toLowerCase()
    })
    if (match?.last_name) {
      setLastNameSuggestion({ lastName: match.last_name, sourceName: `${match.name} ${match.last_name}` })
    }
  }

  async function confirmLastNameSuggestion() {
    if (!lastNameSuggestion) return
    await supabase.from('people').update({ last_name: lastNameSuggestion.lastName }).eq('id', personId)
    setLastNameSuggestion(null)
    const updated = await loadData()
    if (updated) onRenamed?.(computeFullName(updated))
    loadFacts(true)
  }

  useEffect(() => {
    if (loading) return
    if (notes.length === 0) {
      setKeyFacts([])
      setFactsLoading(false)
      return
    }
    // Plain visits serve the DB-cached facts (no AI call); regeneration only happens via
    // the explicit refresh icon or after the notes actually change.
    loadFacts(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, loading])

  async function loadFacts(refresh: boolean) {
    setFactsLoading(true)
    const { data } = await supabase.functions.invoke('person-facts', { body: { personId, refresh } })
    setKeyFacts(sortKeyFacts((data?.facts as KeyFact[]) ?? []))
    setFactsFailed(refresh && data?.error === 'extraction_failed')
    setFactsLoading(false)
  }

  async function loadData() {
    setLoading(true)

    const [notesRes, groupsRes, personRes] = await Promise.all([
      supabase
        .from('notes')
        .select(
          'id, content, created_at, moment_id, moments(id, occasion, raw_description), source, source_group_id, groups:groups!notes_source_group_id_fkey(id, name, parent_group_id)'
        )
        .eq('person_id', personId)
        .order('created_at', { ascending: false }),
      supabase.from('person_groups').select('groups(id, name, parent_group_id)').eq('person_id', personId),
      supabase
        .from('people')
        .select('name, last_name, middle_name, goes_by_kind, goes_by_other, former_last_names, how_you_know_them, deceased_date')
        .eq('id', personId)
        .single(),
    ])

    setNotes((notesRes.data as unknown as Note[]) ?? [])

    const groupRows = (groupsRes.data as unknown as { groups: GroupRef | null }[]) ?? []
    setGroups(groupRows.map((r) => r.groups).filter((g): g is GroupRef => g !== null))

    const loadedPerson = (personRes.data as unknown as PersonRow) ?? null
    setPerson(loadedPerson)

    setLoading(false)
    return loadedPerson
  }

  async function submitFact() {
    if (!newFact.trim()) return
    setSaving(true)
    setGroupTagMessage(null)
    setSuggestedGroup(null)
    setFamilyTagMessage(null)
    setFactError(null)
    setNewPersonSuggestions([])

    const { data, error } = await supabase.functions.invoke('add-fact', {
      body: { personId, text: newFact.trim() },
    })

    // add-fact now fails loudly (401 if the session expired, 500 if the note insert itself
    // failed) instead of silently no-op'ing — surface that instead of pretending it saved,
    // and keep the typed text so nothing the user wrote is lost.
    if (error || data?.error) {
      setFactError(data?.message ?? 'Something went wrong saving that — please try again.')
      setSaving(false)
      return
    }

    if (data?.groupTag) setGroupTagMessage(labelForGroupId(data.groupTag.id, data.groupTag.name))
    if (data?.suggestedGroup) setSuggestedGroup(data.suggestedGroup)
    if (data?.familyTags?.length > 0) {
      const names: string[] = data.familyTags.map((t: { name: string }) => t.name)
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
      setFamilyTagMessage(`${list}'s profile${names.length > 1 ? 's have' : ' has'} been updated to reflect this relationship.`)
    }
    if (data?.relationshipSuggestions?.length > 0) {
      setRelationshipSuggestions(data.relationshipSuggestions)
    }
    if (data?.newPersonSuggestions?.length > 0) {
      setNewPersonSuggestions(toStagedNewPersonSuggestions(data.newPersonSuggestions))
    }

    setNewFact('')
    setSaving(false)
    // add-fact can classify this as a name/nickname correction (the only way a person's name
    // changes — see NEW_PERSON_PLACEHOLDER above), so refresh the breadcrumb label along with
    // the page itself; harmless to call when the name didn't actually change.
    const updated = await loadData()
    if (updated) onRenamed?.(computeFullName(updated))
    loadFacts(true)
  }

  // Editing a note directly improves the data everywhere it's used (not just this one card),
  // and Key Facts — which are re-extracted from notes fresh every visit — pick up the
  // correction automatically rather than drifting back on the next reload.
  async function handleEditNote(noteId: string, newContent: string) {
    await supabase.from('notes').update({ content: newContent }).eq('id', noteId)
    await loadData()
    loadFacts(true)
  }

  // The retraction panel has already done the deleting; this is the cleanup that makes it stick.
  // The Key Facts refresh is the load-bearing half: the chip is a cached jsonb column, so without
  // a regeneration the fact stays on screen even after every note behind it is gone.
  async function handleRetracted() {
    setRetractingFactIndex(null)
    await loadData()
    loadFacts(true)
  }

  async function handleDeleteNote(noteId: string) {
    await supabase.from('notes').delete().eq('id', noteId)
    await loadData()
    loadFacts(true)
  }

  async function handleTagGroup(groupId: string) {
    await supabase
      .from('person_groups')
      .upsert({ person_id: personId, group_id: groupId }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
    await loadData()
  }

  // "Untagging" is pure detachment from person_groups, not deletion — same non-destructive
  // reasoning as EventDetail.tsx's handleUntagGroup. The group itself is untouched.
  async function handleUntagGroup(groupId: string) {
    await supabase.from('person_groups').delete().eq('person_id', personId).eq('group_id', groupId)
    await loadData()
  }

  async function handleSaveName(e: FormEvent) {
    e.preventDefault()
    if (!person) return
    const trimmedFirst = firstNameInput.trim()
    if (!trimmedFirst) return
    const trimmedLast = lastNameInput.trim() || null
    const trimmedMiddle = middleNameInput.trim() || null
    // Re-joined from the field rather than merged onto what's on file, because this IS the editor
    // for the column: the additive merge belongs on the chat paths, where a stray capture must
    // never wipe what an earlier conversation recorded. Here the user is looking at the whole list.
    const trimmedFormer = parseFormerLastNames(formerNameInput).join(', ') || null
    const trimmedHowYouKnow = howYouKnowInput.trim() || null

    // Fall back to 'first' (stored as null) if the chosen slot has since gone empty — e.g. the
    // dropdown was left on "middle" but the middle name field was then cleared.
    let finalGoesByKind: 'middle' | 'last' | 'other' | null = goesByKind === 'first' ? null : goesByKind
    if (finalGoesByKind === 'middle' && !trimmedMiddle) finalGoesByKind = null
    if (finalGoesByKind === 'last' && !trimmedLast) finalGoesByKind = null
    let trimmedGoesByOther = finalGoesByKind === 'other' ? goesByOtherInput.trim() || null : null
    if (finalGoesByKind === 'other' && !trimmedGoesByOther) finalGoesByKind = null
    if (finalGoesByKind !== 'other') trimmedGoesByOther = null

    const unchanged =
      trimmedFirst === person.name &&
      trimmedLast === person.last_name &&
      trimmedMiddle === person.middle_name &&
      finalGoesByKind === person.goes_by_kind &&
      trimmedGoesByOther === person.goes_by_other &&
      trimmedFormer === (person.former_last_names ?? null) &&
      trimmedHowYouKnow === (person.how_you_know_them ?? null)
    if (unchanged) {
      setEditingName(false)
      return
    }

    setSavingName(true)
    const { error } = await supabase
      .from('people')
      .update({
        name: trimmedFirst,
        last_name: trimmedLast,
        middle_name: trimmedMiddle,
        goes_by_kind: finalGoesByKind,
        goes_by_other: trimmedGoesByOther,
        former_last_names: trimmedFormer,
        how_you_know_them: trimmedHowYouKnow,
      })
      .eq('id', personId)
    setSavingName(false)
    if (error) return

    // A newly chosen "Other" goes-by name is new information worth keeping as a note (like any
    // other fact about this person) — unlike picking First/Middle/Last, which just points at a
    // name already on file and isn't itself new information.
    const otherIsNew = finalGoesByKind === 'other' && !!trimmedGoesByOther && trimmedGoesByOther !== person.goes_by_other
    if (otherIsNew) {
      await supabase.from('notes').insert({ person_id: personId, content: `Goes by ${trimmedGoesByOther}.` })
    }

    const updatedPerson: PersonRow = {
      name: trimmedFirst,
      last_name: trimmedLast,
      middle_name: trimmedMiddle,
      goes_by_kind: finalGoesByKind,
      goes_by_other: trimmedGoesByOther,
      former_last_names: trimmedFormer,
      how_you_know_them: trimmedHowYouKnow,
      deceased_date: person.deceased_date,
    }
    setPerson(updatedPerson)
    setEditingName(false)
    onRenamed?.(computeFullName(updatedPerson))
    if (otherIsNew) {
      await loadData()
      loadFacts(true)
    }
  }

  // Deceased is a standalone fact saved independently of name/goes-by, but surfaced only inside
  // the name-edit form (pencil icon) rather than as its own always-visible row — a permanent
  // "Mark as deceased" prompt on every profile read as a downer (founder feedback, 2026-07-24).
  async function saveDeceased() {
    if (!person) return
    setSavingDeceased(true)
    const dateValue = deceasedDateInput.trim() || null
    const { error } = await supabase.from('people').update({ deceased_date: dateValue }).eq('id', personId)
    setSavingDeceased(false)
    if (error) return
    setPerson({ ...person, deceased_date: dateValue })
  }

  async function clearDeceased() {
    if (!person) return
    setSavingDeceased(true)
    const { error } = await supabase.from('people').update({ deceased_date: null }).eq('id', personId)
    setSavingDeceased(false)
    if (error) return
    setPerson({ ...person, deceased_date: null })
  }

  async function confirmSuggestedGroup() {
    if (!suggestedGroup) return
    const groupName = suggestedGroup
    setSuggestedGroup(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    // Paged: this is find-or-CREATE. Missing an existing group here doesn't just fail to find it,
    // it silently creates a duplicate group with the same name.
    const { data: existingGroups } = await fetchAllRows((from, to) =>
      supabase.from('groups').select('id, name').order('id').range(from, to)
    )
    const match = existingGroups.find((g) => g.name.toLowerCase() === groupName.toLowerCase())

    let groupId = match?.id ?? null
    if (!groupId) {
      const { data: newGroup } = await supabase
        .from('groups')
        .insert({ user_id: user?.id, name: groupName })
        .select()
        .single()
      groupId = newGroup?.id ?? null
    }
    if (groupId) {
      await supabase
        .from('person_groups')
        .upsert({ person_id: personId, group_id: groupId }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
      setGroupTagMessage(labelForGroupId(match?.id, match?.name ?? groupName))
      loadData()
    }
  }

  // Permanently removes this person and everything tied only to them (notes, reminders,
  // group memberships). Anyone else's notes that merely mention this person's name by text
  // are left as-is — there's no way to "unmention" someone from prose, and pruning that text
  // isn't this action's job. Any other profile's cached Key Facts pointing at this person's ID
  // will stop resolving to a clickable button next time it's regenerated, same fail-safe-to-
  // plain-text behavior as any other unresolved name.
  async function handleDeleteProfile() {
    setActionBusy(true)
    setActionError(null)
    const results = await Promise.all([
      supabase.from('notes').delete().eq('person_id', personId),
      supabase.from('reminders').delete().eq('person_id', personId),
      supabase.from('person_groups').delete().eq('person_id', personId),
      // person_pets cascades on the people FK, so this is belt-and-braces for symmetry with the
      // other dependents. It sits in the same Promise.all, which aborts the delete on ANY error —
      // safe only now that 2026-08-01-pets.sql has actually been run (confirmed live 2026-08-01).
      supabase.from('person_pets').delete().eq('person_id', personId),
    ])
    const dependentsError = results.find((r) => r.error)?.error
    if (dependentsError) {
      setActionError('Something went wrong deleting this profile — please try again.')
      setActionBusy(false)
      return
    }

    const { error } = await supabase.from('people').delete().eq('id', personId)
    if (error) {
      setActionError('Something went wrong deleting this profile — please try again.')
      setActionBusy(false)
      return
    }
    onBack()
  }

  async function openMerge() {
    setMergeOpen(true)
    setMergeCandidate(null)
    setMergeSearch('')
    if (otherPeople.length === 0) {
      const { data } = await fetchAllRows((from, to) =>
        supabase.from('people').select('id, name, last_name').neq('id', personId).order('name').order('id').range(from, to)
      )
      setOtherPeople((data as OtherPerson[]) ?? [])
    }
  }

  // Folds THIS profile into `mergeCandidate` (the one picked from search) — the reverse of
  // the old behavior. Users discover duplicates by clicking into the unwanted profile first,
  // so the profile they're standing on is the one that should disappear; the one they search
  // for and pick is the one they want to keep. Every note and reminder moves to the survivor,
  // group memberships are unioned (not duplicated), this profile's own name(s) are kept as a
  // nickname on the survivor so a bare first-name mention in existing notes resolves
  // unambiguously going forward, and this record itself is deleted. The survivor's cached Key
  // Facts are cleared so they regenerate from the newly-merged notes, and the caller
  // navigates to the survivor since this profile no longer exists.
  async function handleMerge() {
    if (!mergeCandidate) return
    setActionBusy(true)
    setActionError(null)
    const survivorId = mergeCandidate.id
    const duplicateId = personId

    const [dupPersonRes, survivorPersonRes, survivorRemindersRes, dupRemindersRes, dupGroupsRes, dupPetsRes] = await Promise.all([
      supabase.from('people').select('name, last_name, nicknames, middle_name, goes_by_other, former_last_names').eq('id', duplicateId).single(),
      supabase.from('people').select('nicknames, last_name, former_last_names').eq('id', survivorId).single(),
      supabase.from('reminders').select('id, label').eq('person_id', survivorId),
      supabase.from('reminders').select('id, label').eq('person_id', duplicateId),
      supabase.from('person_groups').select('group_id').eq('person_id', duplicateId),
      supabase.from('person_pets').select('pet_id').eq('person_id', duplicateId),
    ])

    if (dupPersonRes.error || survivorPersonRes.error) {
      setActionError('Something went wrong merging these profiles — please try again.')
      setActionBusy(false)
      return
    }

    // Every step below is checked, and any failure bails BEFORE the delete at the end (2026-08-11,
    // §12's silent-write rule). This isn't tidiness: the last act of a merge is deleting the
    // duplicate, and notes cascade on that delete. So if the re-point at the top had failed while
    // the rest carried on — which is exactly what happened before, invisibly — the delete
    // destroyed every note that hadn't moved. Bailing leaves a partly-merged pair, which is
    // untidy but fully recoverable by merging again; the delete is not.
    //
    // There's no transaction available from the browser client, so "stop at the first failure and
    // never reach the destructive step" is the strongest guarantee this path can offer.
    function fail() {
      setActionError('Something went wrong merging these profiles — nothing was deleted. Please try again.')
      setActionBusy(false)
    }

    const notesRes = await supabase.from('notes').update({ person_id: survivorId }).eq('person_id', duplicateId)
    if (notesRes.error) return fail()

    const survivorLabels = new Set((survivorRemindersRes.data ?? []).map((r) => r.label))
    for (const r of dupRemindersRes.data ?? []) {
      const res = survivorLabels.has(r.label)
        ? await supabase.from('reminders').delete().eq('id', r.id)
        : await supabase.from('reminders').update({ person_id: survivorId }).eq('id', r.id)
      if (res.error) return fail()
    }

    for (const g of dupGroupsRes.data ?? []) {
      const res = await supabase
        .from('person_groups')
        .upsert({ person_id: survivorId, group_id: g.group_id }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
      if (res.error) return fail()
    }
    const dropGroupsRes = await supabase.from('person_groups').delete().eq('person_id', duplicateId)
    if (dropGroupsRes.error) return fail()

    // Pets follow the same union-then-detach rule as groups. Without this the duplicate's pets
    // would vanish with the record (person_pets cascades on delete) — and since a pet can be on
    // several profiles, a plain re-point would collide where the survivor already has it.
    for (const p of dupPetsRes.data ?? []) {
      const res = await supabase
        .from('person_pets')
        .upsert({ person_id: survivorId, pet_id: p.pet_id }, { onConflict: 'person_id,pet_id', ignoreDuplicates: true })
      if (res.error) return fail()
    }
    const dropPetsRes = await supabase.from('person_pets').delete().eq('person_id', duplicateId)
    if (dropPetsRes.error) return fail()

    const dup = dupPersonRes.data
    const dupNames = [
      dup?.name,
      dup?.last_name ? `${dup.name} ${dup.last_name}` : null,
      dup?.middle_name,
      dup?.goes_by_other,
      ...(dup?.nicknames ?? '').split(',').map((n: string) => n.trim()),
    ].filter((n): n is string => !!n)
    const mergedNicknames = (survivorPersonRes.data?.nicknames ?? '').split(',').map((n: string) => n.trim()).filter(Boolean)
    for (const n of dupNames) {
      if (!mergedNicknames.some((m: string) => m.toLowerCase() === n.toLowerCase())) mergedNicknames.push(n)
    }

    // A merge is the one moment the app is TOLD that two different names are one person, so a
    // surname that differs between the two records is a former name and gets filed as one. It
    // still goes into the nicknames fold above as the whole old name ("Sarah Jenkins"), but that
    // list only ever feeds the given-name side of matching — without this line the surname itself
    // is lost, and the next import under the old name proposes a new person all over again.
    const survivor = survivorPersonRes.data
    const mergedFormer = parseFormerLastNames(survivor?.former_last_names)
    for (const candidate of [...parseFormerLastNames(dup?.former_last_names), dup?.last_name ?? '']) {
      const trimmed = (candidate ?? '').trim()
      if (!trimmed) continue
      if (trimmed.toLowerCase() === (survivor?.last_name ?? '').trim().toLowerCase()) continue
      if (mergedFormer.some((f) => f.toLowerCase() === trimmed.toLowerCase())) continue
      mergedFormer.push(trimmed)
    }

    const nicknamesRes = await supabase
      .from('people')
      .update({
        nicknames: mergedNicknames.join(', ') || null,
        former_last_names: mergedFormer.join(', ') || null,
        key_facts: null,
      })
      .eq('id', survivorId)
    if (nicknamesRes.error) return fail()

    // The point of no return — everything the duplicate owned has already moved and been verified.
    const deleteRes = await supabase.from('people').delete().eq('id', duplicateId)
    if (deleteRes.error) {
      // Everything moved but the shell survived: harmless, and re-merging clears it. Say so rather
      // than reporting a failure that would send the founder looking for lost data.
      setActionError("Everything moved across, but the duplicate profile couldn't be removed — try merging once more.")
      setActionBusy(false)
      return
    }

    setMergeOpen(false)
    setMergeCandidate(null)
    setActionBusy(false)
    onMerged({
      id: survivorId,
      name: `${mergeCandidate.name}${mergeCandidate.last_name ? ` ${mergeCandidate.last_name}` : ''}`,
    })
  }

  return (
    <PersonDetailView
      personId={personId}
      personName={personName}
      person={person}
      loading={loading}
      notes={notes}
      groups={groups}
      allGroupsList={allGroupsList}
      keyFacts={keyFacts}
      retractingFactIndex={retractingFactIndex}
      onStartRetractFact={setRetractingFactIndex}
      onRetracted={handleRetracted}
      factsLoading={factsLoading}
      factsFailed={factsFailed}
      selfId={selfId}
      onBack={onBack}
      backLabel={backLabel}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onSelectEvent={onSelectEvent}
      onSelectPet={onSelectPet}
      onOpenFamilyTree={onOpenFamilyTree}
      onRefreshFacts={() => loadFacts(true)}
      editingName={editingName}
      firstNameInput={firstNameInput}
      lastNameInput={lastNameInput}
      middleNameInput={middleNameInput}
      goesByKind={goesByKind}
      goesByOtherInput={goesByOtherInput}
      formerNameInput={formerNameInput}
      howYouKnowInput={howYouKnowInput}
      onHowYouKnowInputChange={setHowYouKnowInput}
      howYouKnowThem={person?.how_you_know_them ?? null}
      savingName={savingName}
      onStartEditName={() => {
        setFirstNameInput(person?.name ?? '')
        setLastNameInput(person?.last_name ?? '')
        setMiddleNameInput(person?.middle_name ?? '')
        setGoesByKind(person?.goes_by_kind ?? 'first')
        setGoesByOtherInput(person?.goes_by_other ?? '')
        setFormerNameInput(person?.former_last_names ?? '')
        setHowYouKnowInput(person?.how_you_know_them ?? '')
        setDeceasedDateInput(person?.deceased_date ?? '')
        setEditingName(true)
      }}
      onFirstNameInputChange={setFirstNameInput}
      onLastNameInputChange={setLastNameInput}
      onMiddleNameInputChange={setMiddleNameInput}
      onGoesByKindChange={setGoesByKind}
      onGoesByOtherInputChange={setGoesByOtherInput}
      onFormerNameInputChange={setFormerNameInput}
      onSaveName={handleSaveName}
      onCancelEditName={() => setEditingName(false)}
      deceasedDateInput={deceasedDateInput}
      savingDeceased={savingDeceased}
      onDeceasedDateInputChange={setDeceasedDateInput}
      onSaveDeceased={saveDeceased}
      onClearDeceased={clearDeceased}
      gender={gender}
      savingGender={savingGender}
      onChangeGender={saveGender}
      kinToSelf={kinToSelf}
      newFact={newFact}
      onNewFactChange={setNewFact}
      saving={saving}
      onSubmitFact={submitFact}
      factError={factError}
      groupTagMessage={groupTagMessage}
      familyTagMessage={familyTagMessage}
      suggestedGroup={suggestedGroup}
      onConfirmSuggestedGroup={confirmSuggestedGroup}
      onDeclineSuggestedGroup={() => setSuggestedGroup(null)}
      lastNameSuggestion={lastNameSuggestion}
      onConfirmLastNameSuggestion={confirmLastNameSuggestion}
      onDeclineLastNameSuggestion={() => setLastNameSuggestion(null)}
      relationshipSuggestions={relationshipSuggestions}
      setRelationshipSuggestions={setRelationshipSuggestions}
      newPersonSuggestions={newPersonSuggestions}
      setNewPersonSuggestions={setNewPersonSuggestions}
      onRelationshipApplied={() => {
        loadData()
        loadFacts(true)
      }}
      notesOpen={notesOpen}
      onToggleNotesOpen={() => setNotesOpen((o) => !o)}
      onEditNote={handleEditNote}
      onDeleteNote={handleDeleteNote}
      onTagGroup={handleTagGroup}
      onUntagGroup={handleUntagGroup}
      deleteConfirming={deleteConfirming}
      onStartDelete={() => setDeleteConfirming(true)}
      onCancelDelete={() => setDeleteConfirming(false)}
      onConfirmDelete={handleDeleteProfile}
      mergeOpen={mergeOpen}
      onOpenMerge={openMerge}
      mergeSearch={mergeSearch}
      onMergeSearchChange={setMergeSearch}
      otherPeople={otherPeople}
      mergeCandidate={mergeCandidate}
      onSelectMergeCandidate={setMergeCandidate}
      onCancelMerge={() => setMergeOpen(false)}
      onBackFromMergeCandidate={() => setMergeCandidate(null)}
      onConfirmMerge={handleMerge}
      actionBusy={actionBusy}
      actionError={actionError}
    />
  )
}

// Pure render — split out (2026-07-22) so the landing-page demo can render the exact same profile
// UI fed by static data, with no Supabase/Edge Function calls. `readOnly` hides every write-only
// control (name-edit pencil, the fact bar, group tag/untag pickers, note edit/delete, relationship
// suggestion banners, delete/merge) — everything else (Key Facts, notes, associated groups/events,
// the family-tree link, all navigation) renders and behaves identically either way.
export function PersonDetailView({
  personId,
  personName,
  person,
  loading,
  notes,
  groups,
  allGroupsList,
  keyFacts,
  retractingFactIndex = null,
  onStartRetractFact,
  onRetracted,
  factsLoading,
  factsFailed = false,
  selfId = null,
  onBack,
  backLabel,
  onSelectPerson,
  onSelectGroup,
  onSelectEvent,
  onOpenFamilyTree,
  onRefreshFacts,
  readOnly = false,
  editingName = false,
  firstNameInput = '',
  lastNameInput = '',
  middleNameInput = '',
  goesByKind = 'first',
  goesByOtherInput = '',
  formerNameInput = '',
  howYouKnowInput = '',
  onHowYouKnowInputChange = () => {},
  howYouKnowThem = null,
  savingName = false,
  onStartEditName = () => {},
  onFirstNameInputChange = () => {},
  onLastNameInputChange = () => {},
  onMiddleNameInputChange = () => {},
  onGoesByKindChange = () => {},
  onGoesByOtherInputChange = () => {},
  onFormerNameInputChange = () => {},
  onSaveName = () => {},
  onCancelEditName = () => {},
  deceasedDateInput = '',
  savingDeceased = false,
  onDeceasedDateInputChange = () => {},
  onSaveDeceased = () => {},
  onClearDeceased = () => {},
  gender = null,
  savingGender = false,
  onChangeGender = () => {},
  kinToSelf = null,
  // Left undefined by the live container on purpose — PetsSection runs its own isolated query.
  // Only the demo passes this, so the public demo makes no Supabase call for pets.
  pets = undefined,
  onSelectPet = undefined,
  newFact = '',
  onNewFactChange = () => {},
  saving = false,
  onSubmitFact = () => {},
  factError = null,
  groupTagMessage = null,
  familyTagMessage = null,
  suggestedGroup = null,
  onConfirmSuggestedGroup = () => {},
  onDeclineSuggestedGroup = () => {},
  lastNameSuggestion = null,
  onConfirmLastNameSuggestion = () => {},
  onDeclineLastNameSuggestion = () => {},
  relationshipSuggestions = [],
  setRelationshipSuggestions = () => {},
  newPersonSuggestions = [],
  setNewPersonSuggestions = () => {},
  onRelationshipApplied = () => {},
  notesOpen = true,
  onToggleNotesOpen = () => {},
  onEditNote = () => {},
  onDeleteNote = () => {},
  onTagGroup = () => {},
  onUntagGroup = () => {},
  deleteConfirming = false,
  onStartDelete = () => {},
  onCancelDelete = () => {},
  onConfirmDelete = () => {},
  mergeOpen = false,
  onOpenMerge = () => {},
  mergeSearch = '',
  onMergeSearchChange = () => {},
  otherPeople = [],
  mergeCandidate = null,
  onSelectMergeCandidate = () => {},
  onCancelMerge = () => {},
  onBackFromMergeCandidate = () => {},
  onConfirmMerge = () => {},
  actionBusy = false,
  actionError = null,
}: {
  personId: string
  personName: string
  person: PersonRow | null
  loading: boolean
  notes: Note[]
  groups: GroupRef[]
  allGroupsList: GroupRef[]
  keyFacts: KeyFact[]
  retractingFactIndex?: number | null
  onStartRetractFact?: (index: number | null) => void
  onRetracted?: () => void
  factsLoading: boolean
  factsFailed?: boolean
  selfId?: string | null
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onOpenFamilyTree: (personId: string, label: string, memberIds?: string[]) => void
  onRefreshFacts: () => void
  readOnly?: boolean
  editingName?: boolean
  firstNameInput?: string
  lastNameInput?: string
  middleNameInput?: string
  goesByKind?: 'first' | 'middle' | 'last' | 'other'
  goesByOtherInput?: string
  formerNameInput?: string
  howYouKnowInput?: string
  onHowYouKnowInputChange?: (v: string) => void
  howYouKnowThem?: string | null
  savingName?: boolean
  onStartEditName?: () => void
  onFirstNameInputChange?: (v: string) => void
  onLastNameInputChange?: (v: string) => void
  onMiddleNameInputChange?: (v: string) => void
  onGoesByKindChange?: (v: 'first' | 'middle' | 'last' | 'other') => void
  onGoesByOtherInputChange?: (v: string) => void
  onFormerNameInputChange?: (v: string) => void
  onSaveName?: (e: FormEvent) => void
  onCancelEditName?: () => void
  deceasedDateInput?: string
  savingDeceased?: boolean
  onDeceasedDateInputChange?: (v: string) => void
  onSaveDeceased?: () => void
  onClearDeceased?: () => void
  gender?: string | null
  savingGender?: boolean
  onChangeGender?: (value: string) => void
  // How this person is related to the account holder, already resolved to words. Optional and
  // passed in rather than computed here so the demo can supply one from its static graph.
  kinToSelf?: { label: string; path: string } | null
  pets?: Pet[]
  // Undefined in the demo, which has no pet pages to navigate to — PetsSection renders the pets
  // as plain (disabled) rows in that case rather than dead links.
  onSelectPet?: (pet: { id: string; name: string }) => void
  newFact?: string
  onNewFactChange?: (v: string) => void
  saving?: boolean
  onSubmitFact?: () => void
  factError?: string | null
  groupTagMessage?: string | null
  familyTagMessage?: string | null
  suggestedGroup?: string | null
  onConfirmSuggestedGroup?: () => void
  onDeclineSuggestedGroup?: () => void
  lastNameSuggestion?: { lastName: string; sourceName: string } | null
  onConfirmLastNameSuggestion?: () => void
  onDeclineLastNameSuggestion?: () => void
  relationshipSuggestions?: RelationshipSuggestion[]
  setRelationshipSuggestions?: Dispatch<SetStateAction<RelationshipSuggestion[]>>
  newPersonSuggestions?: NewPersonSuggestion[]
  setNewPersonSuggestions?: Dispatch<SetStateAction<NewPersonSuggestion[]>>
  onRelationshipApplied?: () => void
  notesOpen?: boolean
  onToggleNotesOpen?: () => void
  onEditNote?: (noteId: string, newContent: string) => void
  onDeleteNote?: (noteId: string) => void
  onTagGroup?: (groupId: string) => void
  onUntagGroup?: (groupId: string) => void
  deleteConfirming?: boolean
  onStartDelete?: () => void
  onCancelDelete?: () => void
  onConfirmDelete?: () => void
  mergeOpen?: boolean
  onOpenMerge?: () => void
  mergeSearch?: string
  onMergeSearchChange?: (v: string) => void
  otherPeople?: OtherPerson[]
  mergeCandidate?: OtherPerson | null
  onSelectMergeCandidate?: (p: OtherPerson) => void
  onCancelMerge?: () => void
  onBackFromMergeCandidate?: () => void
  onConfirmMerge?: () => void
  actionBusy?: boolean
  actionError?: string | null
}) {
  const affiliatedEvents = new Map<string, { id: string; summary: string }>()
  for (const n of notes) {
    if (n.moments) {
      affiliatedEvents.set(n.moments.id, { id: n.moments.id, summary: summarize(n.moments.occasion, n.moments.raw_description) })
    }
  }
  const allEvents = Array.from(affiliatedEvents.values())
  const shownEvents = allEvents.slice(0, AFFILIATION_LIMIT)

  // Built from the full roster so a subgroup's parent name resolves even when the parent isn't
  // itself tagged to this person.
  const groupNameById = new Map(allGroupsList.map((g) => [g.id, g.name]))
  // Lets groupDisplayName walk the whole ancestor chain rather than stopping at one level.
  const groupParentById = new Map(allGroupsList.map((g) => [g.id, g.parent_group_id ?? null]))

  // The chip states the relationship; the chain behind it is one tap away rather than always on,
  // since most of the time you only want the answer.
  const [kinPathOpen, setKinPathOpen] = useState(false)

  const fullName = person ? computeFullName(person) : personName
  // Shown, but quietly: it's context for recognising a name you might still use for them, not a
  // second identity. Deliberately nowhere else — list cards and chips always show the current name.
  const formerLine = person ? formerNameLine(person.name, person.former_last_names) : ''
  const missingFactCategories = NUDGE_CATEGORIES.filter((c) => !keyFacts.some((f) => c.satisfiedBy.includes(f.category)))
  const showNudge = !readOnly && (notes.length === 0 || missingFactCategories.length > 0)

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      {editingName ? (
        <form onSubmit={onSaveName} style={styles.renameForm}>
          <div style={styles.nameInputRow}>
            <input
              type="text"
              value={firstNameInput}
              onChange={(e) => onFirstNameInputChange(e.target.value)}
              placeholder="First name"
              style={styles.renameInput}
              autoFocus
            />
            <input
              type="text"
              value={middleNameInput}
              onChange={(e) => onMiddleNameInputChange(e.target.value)}
              placeholder="Middle/nickname"
              style={styles.renameInput}
            />
            <input
              type="text"
              value={lastNameInput}
              onChange={(e) => onLastNameInputChange(e.target.value)}
              placeholder="Last name"
              style={styles.renameInput}
            />
            <input
              type="text"
              value={formerNameInput}
              onChange={(e) => onFormerNameInputChange(e.target.value)}
              placeholder="Former name"
              style={styles.renameInput}
            />
          </div>
          <p style={styles.goesByCaption}>
            "Former name" is a last name they used to have — a maiden name, or one changed by
            marriage, divorce or adoption. It makes them findable under the old name instead of
            being added twice. Separate several with commas.
          </p>
          <input
            type="text"
            value={howYouKnowInput}
            onChange={(e) => onHowYouKnowInputChange(e.target.value)}
            placeholder="How you know them"
            style={styles.howYouKnowInput}
          />
          <p style={styles.goesByCaption}>
            One short line placing them, in your words — "Manuel's friend", "barista at Rosetta",
            "Gus's girlfriend". It shows next to their name anywhere someone else shares it, and
            it's what lets the app ask "which {firstNameInput.trim() || 'one'}?" instead of guessing.
          </p>
          <div style={styles.goesByRow}>
            <span style={styles.goesByLabel}>Goes by</span>
            <select
              value={goesByKind}
              onChange={(e) => onGoesByKindChange(e.target.value as typeof goesByKind)}
              style={styles.goesBySelect}
            >
              <option value="first">{firstNameInput.trim() || 'First name'}</option>
              {middleNameInput.trim() && <option value="middle">{middleNameInput.trim()}</option>}
              {lastNameInput.trim() && <option value="last">{lastNameInput.trim()}</option>}
              <option value="other">Other…</option>
            </select>
            {goesByKind === 'other' && (
              <input
                type="text"
                value={goesByOtherInput}
                onChange={(e) => onGoesByOtherInputChange(e.target.value)}
                placeholder="Their other name"
                style={styles.goesByOtherInput}
              />
            )}
          </div>
          {goesByKind === 'other' && (
            <p style={styles.goesByCaption}>
              We'll save this as a note on {firstNameInput.trim() || 'their'}'s profile!
            </p>
          )}
          {person && (
            <div style={styles.deceasedRow}>
              {person.deceased_date ? (
                <>
                  <span style={styles.deceasedLabel}>† Deceased ({person.deceased_date})</span>
                  <button type="button" onClick={onClearDeceased} disabled={savingDeceased} style={styles.textLinkButton}>
                    Undo
                  </button>
                </>
              ) : (
                <>
                  <span style={styles.deceasedLabel}>Deceased:</span>
                  <input
                    type="date"
                    value={deceasedDateInput}
                    onChange={(e) => onDeceasedDateInputChange(e.target.value)}
                    style={styles.deceasedDateInput}
                  />
                  <button type="button" onClick={onSaveDeceased} disabled={savingDeceased} style={styles.textLinkButton}>
                    {savingDeceased ? '…' : 'Mark as deceased'}
                  </button>
                </>
              )}
            </div>
          )}
          <div style={styles.deceasedRow}>
            <span style={styles.deceasedLabel}>Gender:</span>
            <select
              value={gender ?? ''}
              onChange={(e) => onChangeGender(e.target.value)}
              disabled={savingGender}
              style={styles.goesBySelect}
            >
              <option value="">Not set</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non-binary">Non-binary</option>
              <option value="other">Other</option>
            </select>
          </div>
          {!gender && <GenderGuessHint firstName={firstNameInput} />}
          <div style={styles.nameButtonRow}>
            <button type="submit" disabled={savingName || !firstNameInput.trim()} style={styles.saveButton}>
              {savingName ? '…' : 'Save'}
            </button>
            <button type="button" onClick={onCancelEditName} style={styles.cancelButton}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div style={formerLine || howYouKnowThem ? styles.headingRowTight : styles.headingRow}>
          <h1 style={styles.heading}>{fullName}</h1>
          {!readOnly && <EditButton label="Edit name" onClick={onStartEditName} />}
        </div>
      )}
      {!editingName && formerLine && <p style={styles.formerNameLine}>{formerLine}</p>}
      {!editingName && howYouKnowThem && <p style={styles.howYouKnowLine}>{howYouKnowThem}</p>}

      {kinToSelf && (
        <button
          type="button"
          style={styles.kinChip}
          onClick={() => setKinPathOpen((open) => !open)}
          aria-expanded={kinPathOpen}
          title={kinToSelf.path || undefined}
        >
          Your {kinToSelf.label}
          {kinToSelf.path && <span style={styles.kinChevron}>{kinPathOpen ? ' ▴' : ' ▾'}</span>}
        </button>
      )}
      {kinToSelf && kinPathOpen && kinToSelf.path && <p style={styles.kinPath}>{kinToSelf.path}</p>}

      {!loading && (
        <button
          type="button"
          style={styles.treeLink}
          onClick={() => onOpenFamilyTree(personId, `${fullName}'s family tree`)}
        >
          View family tree →
        </button>
      )}

      {!loading && (factsLoading || keyFacts.length > 0) && (
        <div style={styles.keyFacts}>
          <span style={styles.keyFactsHeadingRow}>
            <span style={styles.keyFactsHeading}>Key facts</span>
            {!readOnly && <RefreshButton label="Refresh key facts" refreshing={factsLoading} onClick={onRefreshFacts} />}
          </span>
          {factsFailed && !factsLoading && (
            <p style={styles.keyFactsFailed}>
              Couldn't refresh these just now — Grove's AI didn't answer. These are the ones it had
              already. Try again in a few minutes.
            </p>
          )}
          {factsLoading ? (
            <p style={styles.keyFactsLoading}>Gathering what we know…</p>
          ) : (
            <ul style={styles.keyFactsList}>
              {keyFacts.map((f, i) => (
                <li key={i} style={styles.keyFactsEntry}>
                  <KeyFactItem
                    fact={f}
                    selfId={selfId}
                    onSelectPerson={onSelectPerson}
                    // Only offered on facts that name someone. Those are the ones that fan out —
                    // a mirror note on the other profile, a relationships row, a cached chip on
                    // both sides — and so the ones a single note deletion can't actually retract.
                    // A plain text fact is already fixable by editing its note in the list below.
                    onDispute={
                      !readOnly && onStartRetractFact && (f.people ?? []).length > 0
                        ? () => onStartRetractFact(retractingFactIndex === i ? null : i)
                        : undefined
                    }
                  />
                  {retractingFactIndex === i && (
                    <RetractFactPanel
                      personId={personId}
                      subjectName={fullName}
                      factLabel={keyFactLabel(f)}
                      category={f.category}
                      linkedPeople={f.people ?? []}
                      onCancel={() => onStartRetractFact?.(null)}
                      onRetracted={() => onRetracted?.()}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!loading && <ContactInfoSection personId={personId} readOnly={readOnly} />}

      {!loading && <PetsSection personId={personId} readOnly={readOnly} pets={pets} onSelectPet={onSelectPet} />}

      {!loading && (
        <>
          <h2 style={styles.subheading}>Associated Groups</h2>
          {groups.length > 0 && (
            <>
              <p style={styles.chatHint}>
                {readOnly ? 'Tap a group for its profile.' : `Tap a group for its profile, or hover to untag it from ${fullName}.`}
              </p>
              <div style={styles.chipRow}>
                {groups.map((g) => (
                  <AffiliatedGroupChip
                    key={g.id}
                    group={g}
                    displayName={groupDisplayName(g, groupNameById, groupParentById)}
                    onSelect={() => onSelectGroup(g)}
                    onRemove={readOnly ? undefined : () => onUntagGroup(g.id)}
                  />
                ))}
              </div>
            </>
          )}
          {!readOnly && (
            <SearchAddPicker
              items={allGroupsList
                .filter((g) => !groups.some((tagged) => tagged.id === g.id))
                .map((g) => ({ id: g.id, label: groupDisplayName(g, groupNameById, groupParentById) }))}
              placeholder="Tag this person to a group…"
              onSelect={(item) => onTagGroup(item.id)}
              emptyText="No groups match."
            />
          )}
        </>
      )}

      {!loading && shownEvents.length > 0 && (
        <>
          <h2 style={styles.subheading}>Associated Events</h2>
          <div style={styles.chipRow}>
            {shownEvents.map((e) => (
              <EventChip key={e.id} label={e.summary} onClick={() => onSelectEvent(e)} />
            ))}
            {allEvents.length > AFFILIATION_LIMIT && (
              <span style={styles.moreText}>+{allEvents.length - AFFILIATION_LIMIT} more</span>
            )}
          </div>
        </>
      )}

      {/* readOnly (demo) gets no personId — PhotoGallery has no static-data override like
          PetsSection's `pets` prop, so passing it unconditionally would fire a real Supabase
          query from the logged-out demo. */}
      <PhotoGallery personId={readOnly ? undefined : personId} />

      {!loading && !factsLoading && showNudge && (
        <div style={styles.nudgeBox}>
          <span style={styles.nudgeHeading}>Help us get to know {fullName} better</span>
          <ul style={styles.nudgeList}>
            {notes.length === 0 ? (
              <li style={styles.nudgeItem}>
                {fullName === NEW_PERSON_PLACEHOLDER
                  ? 'Start by telling us who this is — e.g. "This is Sarah Chen, my old college roommate."'
                  : `Tell us a memory about ${fullName} to get started.`}
              </li>
            ) : (
              missingFactCategories.map((c) => (
                <li key={c.category} style={styles.nudgeItem}>{c.question(fullName)}</li>
              ))
            )}
          </ul>
        </div>
      )}

      {!readOnly && (
        <div style={styles.stickyBarWrapper}>
          <div style={styles.stickyBarInner}>
            <form onSubmit={(e) => { e.preventDefault(); onSubmitFact() }} style={styles.addForm}>
              <AutoGrowTextarea
                value={newFact}
                onChange={onNewFactChange}
                onEnter={onSubmitFact}
                placeholder={
                  fullName === NEW_PERSON_PLACEHOLDER
                    ? 'Who is this? e.g. "This is Sarah Chen, my old college roommate"'
                    : `Add a fact about ${fullName}, e.g. "Married to Manuel, they share a house"`
                }
                style={styles.addInput}
                disabled={saving}
              />
              <VoiceInputButton
                value={newFact}
                onChange={onNewFactChange}
                disabled={saving}
              />
              <button type="submit" disabled={saving} style={styles.addButton}>
                {saving ? '…' : 'Add'}
              </button>
            </form>
          </div>
        </div>
      )}

      {factError && (
        <p style={styles.factErrorBanner}>{factError}</p>
      )}

      {groupTagMessage && (
        <p style={styles.groupTagBanner}>✓ Also added {fullName} to "{groupTagMessage}".</p>
      )}

      {familyTagMessage && (
        <p style={styles.groupTagBanner}>✓ {familyTagMessage}</p>
      )}

      {suggestedGroup && (
        <div style={styles.suggestBanner}>
          <span>It sounds like {fullName} might belong to a group called "{suggestedGroup}". Add them?</span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={onConfirmSuggestedGroup} style={styles.suggestYesButton}>
              Yes, add
            </button>
            <button type="button" onClick={onDeclineSuggestedGroup} style={styles.suggestNoButton}>
              No thanks
            </button>
          </div>
        </div>
      )}

      {lastNameSuggestion && (
        <div style={styles.suggestBanner}>
          <span>
            It looks like {fullName} is connected to {lastNameSuggestion.sourceName}. Add "{lastNameSuggestion.lastName}" as{' '}
            {fullName}'s last name?
          </span>
          <div style={styles.suggestButtonRow}>
            <button type="button" onClick={onConfirmLastNameSuggestion} style={styles.suggestYesButton}>
              Yes, add
            </button>
            <button type="button" onClick={onDeclineLastNameSuggestion} style={styles.suggestNoButton}>
              No thanks
            </button>
          </div>
        </div>
      )}

      <RelationshipSuggestionBanners
        relationshipSuggestions={relationshipSuggestions}
        setRelationshipSuggestions={setRelationshipSuggestions}
        newPersonSuggestions={newPersonSuggestions}
        setNewPersonSuggestions={setNewPersonSuggestions}
        onApplied={onRelationshipApplied}
      />

      {loading && <p>Loading…</p>}

      {!loading && notes.length === 0 && (
        <p style={styles.empty}>Nothing recorded yet — add a moment or a fact about {fullName} to see it here.</p>
      )}

      {notes.length > 0 && (
        <>
          <div style={styles.notesHeaderRow}>
            <h2 style={styles.subheading}>Notes ({notes.length})</h2>
            <button type="button" onClick={onToggleNotesOpen} style={styles.notesToggle}>
              {notesOpen ? '▾ Hide notes' : '▸ Show notes'}
            </button>
          </div>
          {notesOpen && (
            <div style={styles.notesList}>
              {notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  sourceGroupLabel={note.groups ? groupDisplayName(note.groups, groupNameById, groupParentById) : null}
                  onSelectEvent={onSelectEvent}
                  onSelectGroup={onSelectGroup}
                  onEdit={readOnly ? undefined : onEditNote}
                  onDelete={readOnly ? undefined : onDeleteNote}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!loading && !readOnly && (
        <div style={styles.dangerZone}>
          <span style={styles.dangerHeading}>Profile</span>

          {actionError && <p style={styles.factErrorBanner}>{actionError}</p>}

          {!mergeOpen && !deleteConfirming && (
            <div style={styles.dangerButtonRow}>
              <button type="button" onClick={onOpenMerge} style={styles.dangerSecondaryButton} disabled={actionBusy}>
                This is a duplicate — merge it away…
              </button>
              <button
                type="button"
                onClick={onStartDelete}
                style={styles.dangerDeleteButton}
                disabled={actionBusy}
              >
                Delete this profile
              </button>
            </div>
          )}

          {deleteConfirming && (
            <div style={styles.suggestBanner}>
              <span>Delete {fullName} permanently? This removes all of their notes and reminders. This can't be undone.</span>
              <div style={styles.suggestButtonRow}>
                <button type="button" onClick={onConfirmDelete} style={styles.dangerDeleteButton} disabled={actionBusy}>
                  {actionBusy ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  style={styles.suggestNoButton}
                  disabled={actionBusy}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mergeOpen && (
            <div style={styles.suggestBanner}>
              {!mergeCandidate ? (
                <>
                  <span>Search for the profile you want to keep. Everything on {fullName} will move there, and this profile will be deleted:</span>
                  <SearchBox value={mergeSearch} onChange={onMergeSearchChange} placeholder="Search people…" />
                  <div style={styles.mergeResultsList}>
                    {otherPeople
                      .filter((p) => {
                        const full = `${p.name}${p.last_name ? ` ${p.last_name}` : ''}`.toLowerCase()
                        return mergeSearch.trim() ? full.includes(mergeSearch.trim().toLowerCase()) : false
                      })
                      .slice(0, 8)
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => onSelectMergeCandidate(p)}
                          style={styles.mergeResultButton}
                        >
                          {p.name}{p.last_name ? ` ${p.last_name}` : ''}
                        </button>
                      ))}
                  </div>
                  <div style={styles.suggestButtonRow}>
                    <button type="button" onClick={onCancelMerge} style={styles.suggestNoButton}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span>
                    Merge "{fullName}" into "{mergeCandidate.name}{mergeCandidate.last_name ? ` ${mergeCandidate.last_name}` : ''}"?
                    All notes, reminders, pets, and group memberships move to "{mergeCandidate.name}{mergeCandidate.last_name ? ` ${mergeCandidate.last_name}` : ''}",
                    "{fullName}" is deleted, and you'll be taken to the kept profile. This can't be undone.
                  </span>
                  <div style={styles.suggestButtonRow}>
                    <button type="button" onClick={onConfirmMerge} style={styles.suggestYesButton} disabled={actionBusy}>
                      {actionBusy ? 'Merging…' : 'Yes, merge'}
                    </button>
                    <button
                      type="button"
                      onClick={onBackFromMergeCandidate}
                      style={styles.suggestNoButton}
                      disabled={actionBusy}
                    >
                      Back
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const TRASH_ICON = (
  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
)

// Clicking goes to the group's profile, same as any other chip. Hovering reveals a trash badge
// that untags the group from this person — same corner-badge pattern as EventDetail.tsx's
// AffiliatedGroupChip, reused here for a person's group memberships. `onRemove` omitted (demo
// read-only mode) simply never shows the hover badge.
function AffiliatedGroupChip({
  group,
  displayName,
  onSelect,
  onRemove,
}: {
  group: GroupRef
  displayName?: string
  onSelect: () => void
  onRemove?: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div style={styles.badgeWrapper} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button onClick={onSelect} style={styles.groupChip}>
        <span style={styles.groupDot} />
        {displayName ?? group.name}
      </button>
      {(hovered || IS_TOUCH) && onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Untag ${displayName ?? group.name} from this person`}
          className="touch-action" style={styles.cornerBadge}
        >
          {TRASH_ICON}
        </button>
      )}
    </div>
  )
}

// One Key Fact bullet — purely presentational. Editing/deleting the underlying text, and seeing
// where it came from, now happens on the note itself in the Notes section below (see NoteCard),
// since a fact can be derived from more than one note and "edit this bullet" was ambiguous there.
function KeyFactItem({
  fact,
  selfId = null,
  onSelectPerson,
  onDispute,
}: {
  fact: KeyFact
  selfId?: string | null
  onSelectPerson: (person: { id: string; name: string }) => void
  /** Omitted (demo read-only, or a fact with nobody linked) simply never shows the control. */
  onDispute?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      style={styles.keyFactsItem}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {fact.people && fact.people.length > 0 ? (
        <>
          <span>{fact.relationshipLabel}</span>
          {fact.people.map((p, i) =>
            p.personId ? (
              // The founder reads their own name here as a stranger's ("Married to Jake Volin" on
              // their wife's profile) — say "You", matching the attendee/member chips on
              // EventDetail and GroupDetail (item 33). The chip still navigates to their own
              // profile; only the wording changes.
              <PersonChip
                key={i}
                label={personLabel({ id: p.personId, name: p.name }, selfId)}
                onClick={() => onSelectPerson({ id: p.personId!, name: p.name })}
              />
            ) : (
              <span key={i}>{p.name}</span>
            )
          )}
        </>
      ) : (
        <span>{fact.text}</span>
      )}
      {onDispute && (
        // Kept mounted and merely faded rather than conditionally rendered, so revealing it can't
        // reflow the bullet under the cursor — the same reason NoteCard's hover badges are a
        // corner overlay. Always visible to a keyboard/touch user, who gets no hover at all.
        <button
          type="button"
          onClick={onDispute}
          style={{ ...styles.disputeButton, opacity: hovered ? 1 : 0.35 }}
        >
          That's not right
        </button>
      )}
    </div>
  )
}

// One note card. Hovering reveals a pencil + trash badge in the corner (same
// wrapper-plus-corner-badge pattern used for member/suggestion chips elsewhere in the app,
// chosen specifically because it doesn't resize the card on hover and so can't flicker).
// Shows the date it was added plus, if it came from a tagged event, a clickable link to it.
// `onEdit`/`onDelete` omitted (demo read-only mode) simply never shows the hover badges.
function NoteCard({
  note,
  sourceGroupLabel = null,
  onSelectEvent,
  onSelectGroup,
  onEdit,
  onDelete,
}: {
  note: Note
  // Pre-qualified "Parent / Child" for the source group, built by the caller from the full
  // roster. Null (the demo's default) falls back to the bare name below.
  sourceGroupLabel?: string | null
  onSelectEvent: (event: { id: string; summary: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
  onEdit?: (noteId: string, newContent: string) => void
  onDelete?: (noteId: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  function startEditing() {
    setDraft(note.content)
    setEditing(true)
  }

  function commitEdit() {
    if (draft.trim()) onEdit?.(note.id, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div style={styles.noteCard}>
        <form onSubmit={(e) => { e.preventDefault(); commitEdit() }} style={styles.noteEditForm}>
          <AutoGrowTextarea value={draft} onChange={setDraft} onEnter={commitEdit} style={styles.noteEditInput} />
          <div style={styles.noteEditButtonRow}>
            <button type="submit" style={styles.noteSaveButton}>Save</button>
            <button type="button" onClick={() => setEditing(false)} style={styles.noteCancelButton}>Cancel</button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div
      style={styles.noteCardWrapper}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={styles.noteCard}>
        <p style={styles.noteContent}>{note.content}</p>
        <div style={styles.noteMetaRow}>
          <span style={styles.noteDate}>
            {new Date(note.created_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          {note.moments ? (
            <button
              type="button"
              style={styles.noteSourceButton}
              onClick={() => onSelectEvent({ id: note.moments!.id, summary: summarize(note.moments!.occasion, note.moments!.raw_description) })}
            >
              Added through: {summarize(note.moments.occasion, note.moments.raw_description)}
            </button>
          ) : note.groups ? (
            <button
              type="button"
              style={styles.noteSourceButton}
              onClick={() => onSelectGroup({ id: note.groups!.id, name: note.groups!.name })}
            >
              From: {sourceGroupLabel ?? note.groups.name}
            </button>
          ) : note.source === 'home' ? (
            <span style={styles.noteSourceTag}>From Home</span>
          ) : note.source === 'contacts_import' ? (
            <span style={styles.noteSourceTag}>From: Contacts import</span>
          ) : null}
        </div>
      </div>

      {(hovered || IS_TOUCH) && (onEdit || onDelete) && (
        <div style={styles.noteBadgeRow}>
          {onEdit && (
            <button onClick={startEditing} aria-label="Edit this note" className="touch-action" style={styles.noteBadge}>
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button onClick={() => { if (confirm("Delete this note? This cannot be undone.")) onDelete(note.id) }} aria-label="Delete this note" className="touch-action" style={{ ...styles.noteBadge, ...styles.noteDeleteBadge }}>
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Nothing is recorded for this person, but the app is still wording their relationships as if it
// knows — say so, rather than letting "Not set" sit next to a tree that confidently calls them
// someone's son. The guess itself never reaches the database (see nameGender.ts); this dropdown is
// how it gets replaced with a fact.
function GenderGuessHint({ firstName }: { firstName: string }) {
  const guess = guessGenderFromName(firstName)
  if (!guess) return null
  return (
    <span style={styles.genderGuessHint}>
      Not set — Grove is assuming {guess} from the first name, so it can say "son" instead of
      "child". Pick one above if that's wrong.
    </span>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '2rem 1.5rem 6rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    cursor: 'pointer',
    marginBottom: space.xl,
    padding: 0,
  },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: 0 },
  headingRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: space.xl, flexWrap: 'wrap' },
  // Same row, minus the bottom gap, so the "Formerly …" line reads as part of the name block
  // rather than as a floating sentence halfway down the page.
  headingRowTight: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: space.xs, flexWrap: 'wrap' },
  formerNameLine: { fontSize: fontSize.small, color: colors.textFaintest, margin: `0 0 ${space.xl} 0` },
  treeLink: {
    display: 'block',
    background: 'none',
    border: 'none',
    color: colors.tree,
    fontSize: fontSize.body,
    cursor: 'pointer',
    padding: 0,
    marginBottom: space.xxl,
    fontFamily,
    textDecoration: 'underline',
  },
  kinChip: {
    display: 'inline-block',
    backgroundColor: neutral.offWhite,
    border: border.default,
    borderRadius: radius.pill,
    color: colors.ink,
    fontSize: fontSize.body,
    fontFamily,
    padding: '0.25rem 0.7rem',
    marginBottom: space.md,
    cursor: 'pointer',
  },
  kinChevron: { color: colors.textMuted },
  kinPath: { fontSize: fontSize.body, color: colors.textMuted, margin: `0 0 ${space.md}`, lineHeight: 1.6 },
  renameForm: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: space.xl },
  nameInputRow: { display: 'flex', gap: space.md, flexWrap: 'wrap' },
  renameInput: {
    fontSize: fontSize.h2,
    fontFamily,
    color: colors.ink,
    padding: '0.25rem 0.5rem',
    borderRadius: radius.md,
    border: border.default,
    // Basis 0, not a fixed px basis: three 150px boxes can't fit a phone's content width, so the
    // row wrapped to two lines and stopped reading as one name. At 0 they always share the row.
    flex: '1 1 0',
    minWidth: 0,
  },
  goesByRow: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  goesByLabel: { fontSize: fontSize.body, color: colors.ink },
  goesBySelect: {
    fontSize: fontSize.bodyLg,
    fontFamily,
    color: colors.ink,
    padding: '0.3rem 0.4rem',
    borderRadius: radius.md,
    border: border.default,
    width: '130px',
    flex: '0 0 auto',
  },
  goesByOtherInput: {
    fontSize: fontSize.bodyLg,
    fontFamily,
    color: colors.ink,
    padding: '0.3rem 0.5rem',
    borderRadius: radius.md,
    border: border.default,
    width: '160px',
    flex: '0 0 auto',
  },
  goesByCaption: { fontSize: '0.78rem', color: colors.textFaintest, margin: 0 },
  // Full width on its own row rather than a fourth box in nameInputRow: this holds a phrase, not
  // a name, and sharing that row would squeeze all four below a readable width on a phone.
  howYouKnowInput: {
    fontSize: fontSize.body,
    fontFamily,
    color: colors.ink,
    padding: '0.35rem 0.5rem',
    borderRadius: radius.md,
    border: border.default,
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  howYouKnowLine: { fontSize: fontSize.body, color: colors.textFaint, margin: `0 0 ${space.xl} 0` },
  nameButtonRow: { display: 'flex', gap: space.md },
  deceasedRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: space.lg, flexWrap: 'wrap' },
  deceasedLabel: { fontSize: fontSize.label, color: colors.textFaint },
  genderGuessHint: { display: 'block', fontSize: fontSize.small, color: colors.textFaintest, lineHeight: 1.5 },
  deceasedDateInput: {
    fontSize: fontSize.body,
    fontFamily,
    color: colors.ink,
    padding: '0.3rem 0.4rem',
    borderRadius: radius.md,
    border: border.default,
  },
  textLinkButton: {
    background: 'none',
    border: 'none',
    color: colors.tree,
    fontSize: fontSize.label,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    fontFamily,
  },
  saveButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
  },
  cancelButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
  },
  chatHint: { margin: '0 0 0.25rem 0', fontSize: fontSize.body, color: colors.textFaint },
  groupChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.88rem',
    fontWeight: 700,
    padding: '0.35rem 0.85rem 0.35rem 0.7rem',
    borderRadius: radius.md,
    border: border.suggestFill,
    backgroundColor: colors.suggestBg,
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
    letterSpacing: '0.02em',
  },
  groupDot: {
    width: '7px',
    height: '7px',
    borderRadius: radius.circle,
    backgroundColor: colors.suggestFill,
    flexShrink: 0,
  },
  badgeWrapper: { position: 'relative', display: 'inline-block' },
  cornerBadge: {
    position: 'absolute',
    top: '-8px',
    right: '-8px',
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.circle,
    border: border.danger,
    backgroundColor: colors.surface,
    color: colors.danger,
    fontSize: fontSize.small,
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    boxShadow: shadow.button,
  },
  keyFacts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
    backgroundColor: neutral.sageWashCool,
    border: `1px solid ${neutral.sageLine}`,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    marginBottom: space.xxxl,
  },
  keyFactsHeadingRow: { display: 'flex', alignItems: 'center', gap: space.md },
  keyFactsHeading: { fontSize: fontSize.tiny, textTransform: 'uppercase', letterSpacing: '0.04em', color: neutral.sage, fontWeight: 700 },
  keyFactsLoading: { margin: 0, fontSize: fontSize.body, color: colors.textFaintest, fontStyle: 'italic' },
  keyFactsFailed: { margin: `0 0 ${space.sm}`, fontSize: fontSize.label, color: colors.danger, lineHeight: 1.5 },
  keyFactsEntry: { listStyle: 'disc' },
  disputeButton: {
    fontSize: fontSize.label,
    fontFamily,
    color: colors.textFaintest,
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    textDecoration: 'underline',
    transition: 'opacity 0.12s ease',
  },
  keyFactsList: { margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  keyFactsItem: { fontSize: '0.98rem', color: colors.inkPlain, lineHeight: 1.4, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.md },
  subheading: { fontSize: '1.2rem', color: colors.ink, margin: '1.5rem 0 0.5rem 0' },
  chipRow: { display: 'flex', gap: space.md, flexWrap: 'wrap', alignItems: 'center', marginBottom: space.md },
  moreText: { fontSize: fontSize.label, color: colors.textFaintest, fontStyle: 'italic' },
  nudgeBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    backgroundColor: neutral.warm50,
    border: `1px dashed ${neutral.warm200}`,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    marginBottom: space.xl,
  },
  nudgeHeading: { fontSize: fontSize.body, color: '#5A5A52', fontStyle: 'italic' },
  nudgeList: { margin: 0, paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: space.xs },
  nudgeItem: { fontSize: fontSize.body, color: '#7A7A70' },
  stickyBarWrapper: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.appBg,
    borderTop: `1px solid ${neutral.warmLineDeep}`,
    boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
    padding: '0.6rem 0',
    zIndex: 20,
  },
  stickyBarInner: { maxWidth: maxWidth.page, margin: '0 auto', padding: '0 1.5rem' },
  addForm: { display: 'flex', alignItems: 'flex-end', gap: space.md },
  addInput: { flex: 1, fontSize: fontSize.base, padding: '0.6rem', borderRadius: radius.md, border: border.default },
  addButton: {
    fontSize: fontSize.base,
    padding: '0.6rem 1.1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
  },
  groupTagBanner: { fontSize: fontSize.body, color: colors.ink, marginBottom: space.xxxl },
  factErrorBanner: { fontSize: fontSize.body, color: neutral.redDeep, marginBottom: space.xxxl },
  suggestBanner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    fontSize: fontSize.body,
    color: colors.suggestDeep,
    backgroundColor: colors.suggestBg,
    border: border.suggest,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    marginBottom: space.xxxl,
  },
  suggestButtonRow: { display: 'flex', gap: space.md },
  suggestYesButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
  },
  suggestNoButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: border.suggestFill,
    backgroundColor: 'transparent',
    color: colors.suggest,
    cursor: 'pointer',
  },
  empty: { color: colors.textSubtle },
  notesHeaderRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
  notesToggle: {
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.ink,
    cursor: 'pointer',
    padding: 0,
    fontFamily,
    whiteSpace: 'nowrap',
  },
  notesList: { display: 'flex', flexDirection: 'column', gap: space.xl },
  noteCardWrapper: { position: 'relative' },
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: '1.25rem',
    boxShadow: shadow.card,
  },
  noteContent: { margin: '0 0 0.5rem 0', fontSize: '1.05rem', color: colors.inkPlain, lineHeight: 1.5 },
  noteMetaRow: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  noteDate: { fontSize: fontSize.label, color: colors.textFaintest },
  noteSourceButton: {
    fontSize: fontSize.tiny,
    padding: '0.2rem 0.55rem',
    borderRadius: '5px',
    border: border.event,
    backgroundColor: colors.eventBg,
    color: colors.event,
    cursor: 'pointer',
    fontFamily,
  },
  noteSourceTag: {
    fontSize: fontSize.tiny,
    padding: '0.2rem 0.55rem',
    borderRadius: '5px',
    border: `1px solid ${neutral.warm200}`,
    backgroundColor: neutral.warm100,
    color: colors.textSubtle,
    fontFamily,
  },
  noteBadgeRow: { position: 'absolute', top: '-6px', right: '-6px', display: 'flex', gap: '0.3rem' },
  noteBadge: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.circle,
    border: `1px solid ${neutral.grey500}`,
    backgroundColor: colors.surface,
    color: colors.textBody,
    padding: 0,
    cursor: 'pointer',
    boxShadow: shadow.button,
  },
  noteDeleteBadge: { borderColor: colors.danger, color: colors.danger },
  noteEditForm: { display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  noteEditInput: { fontSize: fontSize.bodyLg, padding: '0.5rem', borderRadius: radius.sm, border: border.default },
  noteEditButtonRow: { display: 'flex', gap: space.md },
  noteSaveButton: {
    fontSize: fontSize.label,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.sm,
    border: border.primary,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
  },
  noteCancelButton: {
    fontSize: fontSize.label,
    padding: '0.3rem 0.7rem',
    borderRadius: radius.sm,
    border: `1px solid ${neutral.grey500}`,
    backgroundColor: 'transparent',
    color: colors.textMuted,
    cursor: 'pointer',
  },
  dangerZone: {
    marginTop: '2.5rem',
    paddingTop: space.xxl,
    borderTop: `1px solid ${neutral.warmLineDeep}`,
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
  },
  dangerHeading: { fontSize: fontSize.tiny, textTransform: 'uppercase', letterSpacing: '0.04em', color: neutral.sage, fontWeight: 700 },
  dangerButtonRow: { display: 'flex', gap: space.lg, flexWrap: 'wrap' },
  dangerSecondaryButton: {
    fontSize: fontSize.label,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.sm,
    border: `1px solid ${neutral.grey500}`,
    backgroundColor: 'transparent',
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
  dangerDeleteButton: {
    fontSize: fontSize.label,
    padding: '0.5rem 0.9rem',
    borderRadius: radius.sm,
    border: border.danger,
    backgroundColor: 'transparent',
    color: colors.danger,
    cursor: 'pointer',
    fontFamily,
  },
  mergeResultsList: { display: 'flex', flexDirection: 'column', gap: '0.35rem', maxHeight: '220px', overflowY: 'auto' },
  mergeResultButton: {
    textAlign: 'left',
    fontSize: fontSize.body,
    padding: '0.5rem 0.7rem',
    borderRadius: radius.sm,
    border: border.suggest,
    backgroundColor: colors.surface,
    color: colors.inkPlain,
    cursor: 'pointer',
    fontFamily,
  },
}
