import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type SuggestedPerson = { name: string | null; email: string | null; matched_person_id: string | null; confidence: 'high' | 'none' }
type Candidate = {
  id: string
  occasion: string | null
  location: string | null
  when_text: string | null
  event_date: string | null
  raw_description: string | null
  suggested_people: SuggestedPerson[]
}

// Card-per-candidate review queue, reusing the accept/reject visual idiom + colors from
// RelationshipSuggestions.tsx. Nothing here ever writes to `moments` without an explicit Accept —
// same "suggest, don't assert" rule as every other AI-suggestion flow in this app.
export default function ImportReview({ onBack, backLabel }: { onBack: () => void; backLabel: string }) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('moment_import_candidates')
      .select('id, occasion, location, when_text, event_date, raw_description, suggested_people')
      .eq('status', 'pending')
      .order('event_date', { ascending: false, nullsFirst: false })
    setCandidates((data as unknown as Candidate[]) ?? [])
    setLoading(false)
  }

  function handleResolved(id: string) {
    setCandidates((prev) => prev.filter((c) => c.id !== id))
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Review calendar events</h1>
      <p style={styles.intro}>
        Found on your connected calendars. Edit anything that's off, then accept or reject — nothing
        is saved until you say yes.
      </p>

      {loading ? (
        <p style={styles.body}>Loading…</p>
      ) : candidates.length === 0 ? (
        <p style={styles.body}>Nothing left to review.</p>
      ) : (
        candidates.map((c) => <CandidateCard key={c.id} candidate={c} onResolved={() => handleResolved(c.id)} />)
      )}
    </div>
  )
}

function CandidateCard({ candidate, onResolved }: { candidate: Candidate; onResolved: () => void }) {
  const [occasion, setOccasion] = useState(candidate.occasion ?? '')
  const [location, setLocation] = useState(candidate.location ?? '')
  const [whenText, setWhenText] = useState(candidate.when_text ?? '')
  const [eventDate, setEventDate] = useState(candidate.event_date ?? '')
  const [included, setIncluded] = useState<Set<number>>(new Set(candidate.suggested_people.map((_, i) => i)))
  const [saving, setSaving] = useState(false)

  function toggle(i: number) {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function handleAccept() {
    setSaving(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data: newMoment, error } = await supabase
      .from('moments')
      .insert({
        user_id: user?.id,
        raw_description: candidate.raw_description ?? '',
        occasion: occasion || null,
        location: location || null,
        when_text: whenText || null,
        event_date: eventDate || null,
      })
      .select()
      .single()

    if (error || !newMoment) {
      setSaving(false)
      return
    }

    // Checked entries with no matched_person_id are net-new — the same "create then note" shape
    // update-moment/index.ts uses for a mentioned person it can't resolve.
    for (const i of included) {
      const person = candidate.suggested_people[i]
      let personId = person.matched_person_id
      if (!personId && person.name) {
        const [first, ...rest] = person.name.trim().split(' ')
        const { data: newPerson } = await supabase
          .from('people')
          .insert({ user_id: user?.id, name: first, last_name: rest.length > 0 ? rest.join(' ') : null })
          .select()
          .single()
        personId = newPerson?.id ?? null
      }
      if (personId) {
        await supabase.from('notes').insert({ person_id: personId, moment_id: newMoment.id, content: 'Was there.' })
      }
    }

    await supabase
      .from('moment_import_candidates')
      .update({ status: 'accepted', reviewed_at: new Date().toISOString() })
      .eq('id', candidate.id)

    setSaving(false)
    onResolved()
  }

  async function handleReject() {
    setSaving(true)
    await supabase
      .from('moment_import_candidates')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
      .eq('id', candidate.id)
    setSaving(false)
    onResolved()
  }

  return (
    <div style={styles.card}>
      <div style={styles.fieldGroup}>
        <input value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Occasion" style={styles.input} disabled={saving} />
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location" style={styles.input} disabled={saving} />
        <input
          value={whenText}
          onChange={(e) => setWhenText(e.target.value)}
          placeholder="When, e.g. August 2026"
          style={styles.input}
          disabled={saving}
        />
        <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={styles.input} disabled={saving} />
      </div>

      {candidate.raw_description && <p style={styles.description}>{candidate.raw_description}</p>}

      {candidate.suggested_people.length > 0 && (
        <div style={styles.peopleRow}>
          {candidate.suggested_people.map((p, i) => (
            <label key={i} style={included.has(i) ? styles.personChipOn : styles.personChipOff}>
              <input type="checkbox" checked={included.has(i)} onChange={() => toggle(i)} disabled={saving} />
              {p.name ?? p.email ?? 'Unknown'}
              {p.confidence === 'none' && <span style={styles.newBadge}> (new)</span>}
            </label>
          ))}
        </div>
      )}

      <div style={styles.suggestButtonRow}>
        <button type="button" onClick={handleAccept} style={styles.suggestYesButton} disabled={saving}>
          {saving ? '…' : 'Accept'}
        </button>
        <button type="button" onClick={handleReject} style={styles.suggestNoButton} disabled={saving}>
          Reject
        </button>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '840px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: {
    background: 'none',
    border: 'none',
    color: '#2E4034',
    fontSize: '1rem',
    cursor: 'pointer',
    marginBottom: '1rem',
    padding: 0,
  },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  intro: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
  body: { fontSize: '0.9rem', color: '#666' },
  card: {
    backgroundColor: '#FFF',
    borderRadius: '10px',
    padding: '1.25rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
    marginBottom: '1rem',
  },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.75rem' },
  input: {
    fontSize: '0.95rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid #CCC',
    fontFamily: 'Georgia, serif',
  },
  description: { fontSize: '0.88rem', color: '#666', lineHeight: 1.5, margin: '0 0 0.75rem' },
  peopleRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.9rem' },
  personChipOn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: '#F4F8F5',
    color: '#2E4034',
    cursor: 'pointer',
  },
  personChipOff: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.85rem',
    padding: '0.3rem 0.7rem',
    borderRadius: '999px',
    border: '1px solid #CCC',
    backgroundColor: '#FAFAFA',
    color: '#999',
    cursor: 'pointer',
  },
  newBadge: { fontStyle: 'italic' },
  suggestButtonRow: { display: 'flex', gap: '0.5rem' },
  suggestYesButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
  suggestNoButton: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.85rem',
    borderRadius: '6px',
    border: '1px solid #B08B2E',
    backgroundColor: 'transparent',
    color: '#8A6A1F',
    cursor: 'pointer',
    fontFamily: 'Georgia, serif',
  },
}
