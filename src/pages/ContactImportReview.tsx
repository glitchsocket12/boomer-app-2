import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upsertReminder } from '../lib/reminders'
import SearchBox from '../components/SearchBox'

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
type PersonRef = { id: string; name: string; last_name: string | null }

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
export default function ContactImportReview({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [allPeople, setAllPeople] = useState<PersonRef[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const [candidatesRes, peopleRes] = await Promise.all([
      supabase
        .from('contact_import_candidates')
        .select(
          'id, full_name, first_name, last_name, middle_name, nickname, organization, job_title, phones, emails, addresses, urls, social_profiles, birthday_month, birthday_day, birthday_year, anniversary_month, anniversary_day, anniversary_year, note_text, related_names, matched_person_id, match_confidence'
        )
        .eq('status', 'selected')
        .order('full_name'),
      supabase.from('people').select('id, name, last_name').order('name'),
    ])
    setCandidates((candidatesRes.data as Candidate[]) ?? [])
    setAllPeople((peopleRes.data as PersonRef[]) ?? [])
    setLoading(false)
  }

  function handleResolved(id: string) {
    setCandidates((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Review contacts</h1>
      <p style={styles.intro}>
        These are the contacts you chose to bring in. Confirm who each one is, then accept or
        reject — nothing is saved to a profile until you say yes.
      </p>

      {loading ? (
        <p style={styles.body}>Loading…</p>
      ) : candidates.length === 0 ? (
        <p style={styles.body}>Nothing left to review.</p>
      ) : (
        candidates.map((c) => (
          <CandidateCard key={c.id} candidate={c} allPeople={allPeople} onResolved={() => handleResolved(c.id)} />
        ))
      )}
    </div>
  )
}

function CandidateCard({
  candidate,
  allPeople,
  onResolved,
}: {
  candidate: Candidate
  allPeople: PersonRef[]
  onResolved: () => void
}) {
  const [linkedPersonId, setLinkedPersonId] = useState<string | null>(candidate.matched_person_id)
  const [pickerOpen, setPickerOpen] = useState(candidate.match_confidence !== 'high')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedLabel, setSavedLabel] = useState<string | null>(null)

  const linkedPerson = allPeople.find((p) => p.id === linkedPersonId) ?? null
  const birthdayLabel = formatDate(candidate.birthday_month, candidate.birthday_day, candidate.birthday_year)
  const anniversaryLabel = formatDate(candidate.anniversary_month, candidate.anniversary_day, candidate.anniversary_year)

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return allPeople.filter((p) => personLabel(p).toLowerCase().includes(q)).slice(0, 8)
  }, [search, allPeople])

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

  async function handleAccept() {
    setSaving(true)
    let personId: string | null = linkedPersonId

    if (!personId) {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: newPerson, error } = await supabase
        .from('people')
        .insert({
          user_id: user?.id,
          name: candidate.first_name || candidate.full_name.split(' ')[0],
          last_name: candidate.last_name,
          middle_name: candidate.middle_name,
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
    } else {
      const { data: existingPerson } = await supabase
        .from('people')
        .select('organization, job_title, phones, emails, addresses, urls, social_profiles')
        .eq('id', personId)
        .maybeSingle()
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
      await upsertReminder(personId as string, 'Birthday', {
        month: candidate.birthday_month,
        day: candidate.birthday_day,
        year: candidate.birthday_year,
      })
    }
    if (candidate.anniversary_month && candidate.anniversary_day) {
      await upsertReminder(personId as string, 'Anniversary', {
        month: candidate.anniversary_month,
        day: candidate.anniversary_day,
        year: candidate.anniversary_year,
      })
    }

    const noteContent = buildNoteContent()
    if (noteContent) {
      await supabase.from('notes').insert({ person_id: personId, content: noteContent, source: 'contacts_import' })
    }

    await markReviewed('accepted', personId)
    setSaving(false)
    setSavedLabel(linkedPerson ? personLabel(linkedPerson) : candidate.full_name)
  }

  async function handleReject() {
    setSaving(true)
    await markReviewed('rejected', linkedPersonId)
    setSaving(false)
    onResolved()
  }

  if (savedLabel) {
    return (
      <div style={styles.card}>
        <p style={styles.confirmText}>Saved contact info for {savedLabel}</p>
      </div>
    )
  }

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
          <p style={styles.body}>
            Goes to: <strong>{personLabel(linkedPerson)}</strong>{' '}
            <button type="button" onClick={() => setPickerOpen(true)} style={styles.linkButton}>
              change
            </button>
          </p>
        ) : (
          <div>
            <p style={styles.body}>
              {linkedPerson ? 'Confirm who this belongs to:' : "Couldn't match this to anyone on file — add as a new person, or link to someone existing:"}
            </p>
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
            {!linkedPerson && (
              <p style={styles.body}>
                Leaving this blank and accepting will add <strong>{candidate.full_name}</strong> as a new person.
              </p>
            )}
            {linkedPerson && (
              <button
                type="button"
                onClick={() => {
                  setLinkedPersonId(candidate.matched_person_id)
                  setPickerOpen(false)
                }}
                style={styles.linkButton}
              >
                cancel
              </button>
            )}
          </div>
        )}
      </div>

      <div style={styles.buttonRow}>
        <button type="button" onClick={handleAccept} disabled={saving} style={styles.acceptButton}>
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
  page: { maxWidth: '840px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: { background: 'none', border: 'none', color: '#2E4034', fontSize: '1rem', cursor: 'pointer', marginBottom: '1rem', padding: 0 },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  intro: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
  body: { fontSize: '0.9rem', color: '#666', lineHeight: 1.5, margin: '0 0 0.5rem' },
  card: {
    backgroundColor: '#FFF',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  cardTitle: { fontSize: '1.1rem', color: '#2E4034', margin: '0 0 0.25rem', fontWeight: 'bold' },
  metaText: { fontSize: '0.85rem', color: '#666', margin: '0 0 0.25rem' },
  linkSection: { margin: '0.75rem 0' },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    textDecoration: 'underline',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontFamily: 'Georgia, serif',
    padding: 0,
  },
  searchResults: { display: 'flex', flexDirection: 'column', gap: '0.25rem', marginBottom: '0.5rem' },
  searchResultRow: {
    textAlign: 'left',
    fontSize: '0.9rem',
    padding: '0.4rem 0.6rem',
    borderRadius: '6px',
    border: '1px solid #E5E5E5',
    backgroundColor: '#FAFAFA',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  buttonRow: { display: 'flex', gap: '0.6rem' },
  acceptButton: {
    fontSize: '0.9rem',
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  rejectButton: {
    fontSize: '0.9rem',
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    backgroundColor: '#FFF',
    color: '#B04A3B',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  confirmText: { color: '#3A7A4A', fontSize: '0.95rem', margin: 0 },
}
