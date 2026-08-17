import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../lib/pagedSelect'
import SearchBox from '../components/SearchBox'
import ReviewNoteField from '../components/ReviewNoteField'
import MatchCallout from '../components/MatchCallout'
import { useResolvedCardScroll } from '../lib/resolvedCardScroll'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'

type Candidate = {
  id: string
  full_name: string | null
  birthday_month: number | null
  birthday_day: number | null
  birthday_year: number | null
  matched_person_id: string | null
  match_confidence: 'high' | 'none'
}
type PersonRef = { id: string; name: string; last_name: string | null }
type ExistingReminder = { person_id: string; month: number; day: number; year: number | null }

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatBirthday(month: number | null, day: number | null, year: number | null): string {
  if (!month || !day) return 'Unknown date'
  const base = `${MONTH_NAMES[month - 1]} ${day}`
  return year ? `${base}, ${year}` : base
}

function personLabel(p: PersonRef): string {
  return p.last_name ? `${p.name} ${p.last_name}` : p.name
}

// Card-per-candidate review queue for calendar-sourced birthdays (2026-07-26) — mirrors
// ImportReview.tsx's accept/reject idiom, but simplified: no tags/groups/location, just a name +
// date and where it should land. Nothing writes to `people`/`reminders` without an explicit Accept.
export default function BirthdayImportReview({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [allPeople, setAllPeople] = useState<PersonRef[]>([])
  const [existingReminders, setExistingReminders] = useState<ExistingReminder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [candidatesRes, peopleRes, remindersRes] = await Promise.all([
      supabase
        .from('birthday_import_candidates')
        .select('id, full_name, birthday_month, birthday_day, birthday_year, matched_person_id, match_confidence')
        .eq('status', 'pending')
        .order('full_name'),
      fetchAllRows((from, to) =>
        supabase.from('people').select('id, name, last_name').order('name').order('id').range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase.from('reminders').select('person_id, month, day, year').eq('label', 'Birthday').order('id').range(from, to)
      ),
    ])
    setCandidates((candidatesRes.data as Candidate[]) ?? [])
    setAllPeople((peopleRes.data as PersonRef[]) ?? [])
    setExistingReminders((remindersRes.data as ExistingReminder[]) ?? [])
    setLoading(false)
  }

  function handleResolved(id: string) {
    setCandidates((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Review birthdays</h1>
      <p style={styles.intro}>
        Found on your connected Birthdays calendar. Pick who each one belongs to, then accept or
        reject — nothing is saved until you say yes.
      </p>

      {loading ? (
        <p style={styles.body}>Loading…</p>
      ) : candidates.length === 0 ? (
        <p style={styles.body}>Nothing left to review.</p>
      ) : (
        candidates.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            allPeople={allPeople}
            existingReminder={c.matched_person_id ? existingReminders.find((r) => r.person_id === c.matched_person_id) ?? null : null}
            onResolved={() => handleResolved(c.id)}
          />
        ))
      )}
    </div>
  )
}

function CandidateCard({
  candidate,
  allPeople,
  existingReminder,
  onResolved,
}: {
  candidate: Candidate
  allPeople: PersonRef[]
  existingReminder: ExistingReminder | null
  onResolved: () => void
}) {
  const [linkedPersonId, setLinkedPersonId] = useState<string | null>(candidate.matched_person_id)
  const [pickerOpen, setPickerOpen] = useState(candidate.match_confidence !== 'high')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedResult, setSavedResult] = useState<{ kind: 'accepted' | 'rejected'; label: string } | null>(null)
  // Parks the collapsed confirmation at the top of the screen, so accept and reject both leave you
  // looking at what you just did with the next birthday underneath it — see lib/resolvedCardScroll.
  const cardRef = useResolvedCardScroll(savedResult !== null)
  // These cards are the thinnest of the four queues — a name and a date — so the free-text box
  // carries the most weight here. See components/ReviewNoteField.tsx.
  const [noteText, setNoteText] = useState('')
  const [transcribing, setTranscribing] = useState(false)

  const linkedPerson = allPeople.find((p) => p.id === linkedPersonId) ?? null
  const dateLabel = formatBirthday(candidate.birthday_month, candidate.birthday_day, candidate.birthday_year)

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return allPeople.filter((p) => personLabel(p).toLowerCase().includes(q)).slice(0, 8)
  }, [search, allPeople])

  const dateChanged =
    existingReminder != null &&
    linkedPersonId === candidate.matched_person_id &&
    (existingReminder.month !== candidate.birthday_month || existingReminder.day !== candidate.birthday_day)

  async function upsertBirthday(personId: string) {
    const { data: existing } = await supabase
      .from('reminders')
      .select('id')
      .eq('person_id', personId)
      .eq('label', 'Birthday')
      .maybeSingle()

    if (existing) {
      await supabase
        .from('reminders')
        .update({ month: candidate.birthday_month, day: candidate.birthday_day, year: candidate.birthday_year })
        .eq('id', existing.id)
    } else {
      await supabase.from('reminders').insert({
        person_id: personId,
        label: 'Birthday',
        month: candidate.birthday_month,
        day: candidate.birthday_day,
        year: candidate.birthday_year,
      })
    }
  }

  async function markReviewed(status: 'accepted' | 'rejected') {
    await supabase
      .from('birthday_import_candidates')
      .update({ status, reviewed_at: new Date().toISOString(), matched_person_id: linkedPersonId })
      .eq('id', candidate.id)
  }

  async function handleAccept() {
    setSaving(true)
    let personId: string | null = linkedPersonId

    if (!personId) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const name = (candidate.full_name ?? 'New person').trim()
      const [first, ...rest] = name.split(' ')
      const { data: newPerson, error } = await supabase
        .from('people')
        .insert({ user_id: user?.id, name: first, last_name: rest.length > 0 ? rest.join(' ') : null })
        .select()
        .single()
      if (error || !newPerson) {
        setSaving(false)
        return
      }
      personId = newPerson.id
    }

    await upsertBirthday(personId as string)

    const typedNote = noteText.trim()
    if (typedNote) {
      await supabase.from('notes').insert({ person_id: personId, content: typedNote, source: 'review_note' })
    }

    await markReviewed('accepted')
    setSaving(false)
    setSavedResult({
      kind: 'accepted',
      label: linkedPerson ? personLabel(linkedPerson) : candidate.full_name ?? 'this person',
    })
  }

  // Collapses to a confirmation like accept does instead of the row just vanishing, so the
  // reviewer can see what they did — and take it back, since nothing else in the app resurfaces a
  // rejected candidate.
  async function handleReject() {
    setSaving(true)
    await markReviewed('rejected')
    setSaving(false)
    setSavedResult({ kind: 'rejected', label: candidate.full_name ?? 'this birthday' })
  }

  // Puts a mis-tapped rejection back in the queue. The row was only flipped to 'rejected', never
  // deleted, so this is the flip in reverse — including the match markReviewed overwrote.
  async function handleUndoReject() {
    setSaving(true)
    await supabase
      .from('birthday_import_candidates')
      .update({ status: 'pending', reviewed_at: null, matched_person_id: candidate.matched_person_id })
      .eq('id', candidate.id)
    setSaving(false)
    setSavedResult(null)
  }

  if (savedResult) {
    return (
      <div ref={cardRef} style={styles.card}>
        <p style={savedResult.kind === 'accepted' ? styles.confirmText : styles.rejectedText}>
          {savedResult.kind === 'accepted'
            ? `Added birthday for ${savedResult.label} — ${dateLabel}`
            : `Rejected — ${savedResult.label}`}
        </p>
        <div style={styles.confirmButtonRow}>
          {savedResult.kind === 'rejected' && (
            <button type="button" onClick={handleUndoReject} disabled={saving} style={styles.secondaryButton}>
              {saving ? '…' : 'Undo'}
            </button>
          )}
          <button type="button" onClick={onResolved} disabled={saving} style={styles.secondaryButton}>
            Done
          </button>
        </div>
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
    <div ref={cardRef} style={styles.card}>
      <p style={styles.cardTitle}>{candidate.full_name ?? 'Unknown name'}</p>
      <p style={styles.dateText}>
        {dateLabel}
        {dateChanged && existingReminder && (
          <span style={styles.changedNote}>
            {' '}(currently {formatBirthday(existingReminder.month, existingReminder.day, existingReminder.year)} on file)
          </span>
        )}
      </p>

      <div style={styles.linkSection}>
        {linkedPerson && !pickerOpen ? (
          <p style={styles.linkedLine}>
            <span style={styles.linkedTick}>✓</span> Goes to{' '}
            <span style={styles.linkedName}>{personLabel(linkedPerson)}</span>{' '}
            <button type="button" onClick={() => setPickerOpen(true)} style={styles.linkButton}>
              change
            </button>
          </p>
        ) : (
          <div>
            {linkedPerson ? (
              <MatchCallout
                candidateName={candidate.full_name ?? 'this birthday'}
                matchName={personLabel(linkedPerson)}
                onConfirm={() => setPickerOpen(false)}
                onNotSame={() => {
                  setLinkedPersonId(null)
                  setSearch('')
                }}
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
  body: { fontSize: fontSize.body, color: colors.textMuted, lineHeight: 1.5, margin: '0 0 0.5rem' },
  card: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  cardTitle: { fontSize: fontSize.lead, color: colors.ink, margin: '0 0 0.25rem', fontWeight: 'bold' },
  dateText: { fontSize: fontSize.bodyLg, color: colors.inkPlain, margin: '0 0 0.75rem' },
  changedNote: { color: colors.danger, fontSize: fontSize.label },
  linkSection: { marginBottom: '0.75rem' },
  linkedLine: { fontSize: fontSize.bodyLg, color: colors.textBody, lineHeight: 1.5, margin: '0 0 0.5rem' },
  linkedTick: { color: colors.success, fontWeight: 700 },
  linkedName: { color: colors.ink, fontWeight: 700 },
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
  // Rejecting isn't a success, so it doesn't get the green — but it isn't an error either.
  rejectedText: { color: colors.textMuted, fontSize: fontSize.bodyLg, margin: '0 0 0.6rem' },
  confirmButtonRow: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap' },
  secondaryButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
  },
}
