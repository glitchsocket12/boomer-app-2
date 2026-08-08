import { useState } from 'react'
import { supabase } from '../lib/supabase'
import AutoGrowTextarea from './AutoGrowTextarea'
import VoiceInputButton from './VoiceInputButton'
import RelationshipSuggestionBanners, {
  toStagedNewPersonSuggestions,
  type RelationshipSuggestion,
  type NewPersonSuggestion,
} from './RelationshipSuggestions'
import MentionedPeopleSuggestionBanners, { type MentionedPersonSuggestion } from './MentionedPeopleSuggestions'
import { border, colors, fontSize, neutral, radius, space } from '../lib/theme'

type Message = { role: 'user' | 'assistant'; content: string }

// What update-moment / update-group report actually landing in the database. Every field is
// something a write succeeded on — never something the AI merely proposed.
type Applied = {
  renamed?: string | null
  fieldsSet?: string[]
  peopleCreated?: string[]
  peopleTagged?: string[]
  groupsTagged?: string[]
  peopleAdded?: string[]
  peopleRemoved?: string[]
  eventsTagged?: number
  eventsUntagged?: number
  notesAdded?: number
}

function andList(names: string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Plain-language one line per thing that actually happened. Deliberately built from `applied`
// rather than from what the AI said it would do, so a line can never claim a change that a failed
// write silently dropped.
function checklistLines(applied: Applied, subjectType: 'moment' | 'group', suggestionCount: number): string[] {
  const lines: string[] = []
  if (applied.renamed) {
    lines.push(subjectType === 'moment' ? `Named this event “${applied.renamed}”` : `Renamed this group “${applied.renamed}”`)
  }
  if (applied.fieldsSet?.includes('date')) lines.push('Updated the date')
  if (applied.fieldsSet?.includes('location')) lines.push('Updated where it happened')
  if (applied.peopleCreated?.length) {
    lines.push(`Created a profile for ${andList(applied.peopleCreated)}`)
  }
  if (applied.peopleTagged?.length) {
    lines.push(`Added ${andList(applied.peopleTagged)} to who was there`)
  }
  if (applied.peopleAdded?.length) lines.push(`Added ${andList(applied.peopleAdded)} to this group`)
  if (applied.peopleRemoved?.length) lines.push(`Removed ${andList(applied.peopleRemoved)} from this group`)
  if (applied.groupsTagged?.length) {
    lines.push(`Tagged this to ${andList(applied.groupsTagged)}`)
  }
  if (applied.eventsTagged) lines.push(`Tagged ${applied.eventsTagged === 1 ? 'an event' : `${applied.eventsTagged} events`} to this group`)
  if (applied.eventsUntagged) lines.push(`Untagged ${applied.eventsUntagged === 1 ? 'an event' : `${applied.eventsUntagged} events`}`)
  if (applied.notesAdded) lines.push(`Added ${applied.notesAdded === 1 ? 'a note' : `${applied.notesAdded} notes`} to a profile`)
  if (suggestionCount > 0) {
    lines.push(`${suggestionCount === 1 ? 'One suggestion' : `${suggestionCount} suggestions`} below to look at`)
  }
  return lines
}

// Replaces the old split "Add a note" box + "Remember something else?"/"Edit this group" chat
// (see PROJECT_HISTORY.md's item on why the plain box existed) with one input: the user's exact
// words are saved verbatim the instant they submit (same reliability guarantee the old plain box
// gave), and attendee/relationship detection runs automatically afterward via `update-moment`/
// `update-group` — same AI extraction the old chat did, just without a persistent chat thread for
// the common case of a routine note. A genuine disambiguating question (needsClarification) still
// surfaces as one inline follow-up, scoped to that note only.
export default function NoteWithDetection({
  subjectType,
  subjectId,
  placeholder,
  onSaved,
}: {
  subjectType: 'moment' | 'group'
  subjectId: string
  placeholder: string
  onSaved: (update?: { rename?: string | null }) => void
}) {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clarification, setClarification] = useState<{ question: string; history: Message[] } | null>(null)
  const [clarifyReply, setClarifyReply] = useState('')
  const [clarifySending, setClarifySending] = useState(false)
  const [relationshipSuggestions, setRelationshipSuggestions] = useState<RelationshipSuggestion[]>([])
  const [newPersonSuggestions, setNewPersonSuggestions] = useState<NewPersonSuggestion[]>([])
  const [mentionedPeopleSuggestions, setMentionedPeopleSuggestions] = useState<MentionedPersonSuggestion[]>([])
  // The progress panel. `noteSaved` flips true the instant the note row lands — that checkmark is
  // genuinely earned before the AI call even starts. `detecting` covers the AI call itself, which
  // takes several seconds and previously gave off no signal whatsoever: no spinner, no reply, and
  // a silent return on failure, so the page just sat there looking like it had ignored the note.
  const [noteSaved, setNoteSaved] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [doneLines, setDoneLines] = useState<string[] | null>(null)
  const [assistantReply, setAssistantReply] = useState<string | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [voiceBusy, setVoiceBusy] = useState(false)

  const functionName = subjectType === 'moment' ? 'update-moment' : 'update-group'
  const idField = subjectType === 'moment' ? 'momentId' : 'groupId'

  function applyDetectionResult(data: any) {
    if (data.relationshipSuggestions?.length > 0) {
      setRelationshipSuggestions((prev) => [...prev, ...data.relationshipSuggestions])
    }
    if (data.newPersonSuggestions?.length > 0) {
      setNewPersonSuggestions((prev) => [...prev, ...toStagedNewPersonSuggestions(data.newPersonSuggestions)])
    }
    if (data.mentionedPeopleSuggestions?.length > 0) {
      setMentionedPeopleSuggestions((prev) => [...prev, ...data.mentionedPeopleSuggestions])
    }
    const suggestionCount =
      (data.relationshipSuggestions?.length ?? 0) +
      (data.newPersonSuggestions?.length ?? 0) +
      (data.mentionedPeopleSuggestions?.length ?? 0)
    setDoneLines(checklistLines(data.applied ?? {}, subjectType, suggestionCount))
    if (data.reply) setAssistantReply(data.reply)
    if (data.changed) {
      onSaved(subjectType === 'group' ? { rename: data.rename ?? null } : undefined)
    }
  }

  // The note itself is already safely saved by the time this runs, so a hiccup here never loses
  // what the user said — but it does mean the title/attendees they were expecting didn't happen,
  // which they need to be told rather than left to guess at.
  async function runDetection(history: Message[]) {
    setDetecting(true)
    const { data, error: fnError } = await supabase.functions.invoke(functionName, {
      body: { [idField]: subjectId, messages: history },
    })
    setDetecting(false)
    if (fnError || !data) {
      setDetectError(
        "Your note is saved, but I couldn't pull the details out of it just now. Try adding it again, or fill in the name and people yourself."
      )
      return
    }
    if (data.needsClarification) {
      setClarification({ question: data.reply, history: [...history, { role: 'assistant', content: data.reply }] })
      return
    }
    applyDetectionResult(data)
  }

  async function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed || saving) return
    setSaving(true)
    setError(null)
    // Clear last note's panel up front so an old checklist can't be mistaken for this note's.
    setNoteSaved(false)
    setDoneLines(null)
    setAssistantReply(null)
    setDetectError(null)
    const { error: insertError } =
      subjectType === 'moment'
        ? await supabase.from('notes').insert({ moment_id: subjectId, person_id: null, content: trimmed })
        : await supabase.from('notes').insert({ group_id: subjectId, person_id: null, content: trimmed })
    setSaving(false)
    if (insertError) {
      setError("That didn't save — please try again.")
      return
    }
    setText('')
    setNoteSaved(true)
    onSaved(subjectType === 'group' ? { rename: null } : undefined)
    await runDetection([{ role: 'user', content: trimmed }])
  }

  async function handleClarifyReply() {
    if (!clarification || !clarifyReply.trim() || clarifySending) return
    setClarifySending(true)
    const history: Message[] = [...clarification.history, { role: 'user', content: clarifyReply.trim() }]
    setClarifyReply('')
    const { data, error: fnError } = await supabase.functions.invoke(functionName, {
      body: { [idField]: subjectId, messages: history },
    })
    setClarifySending(false)
    if (fnError || !data) {
      setClarification(null)
      setDetectError("I couldn't follow up on that just now — your note is still saved.")
      return
    }
    if (data.needsClarification) {
      setClarification({ question: data.reply, history: [...history, { role: 'assistant', content: data.reply }] })
      return
    }
    setClarification(null)
    applyDetectionResult(data)
  }

  return (
    <div style={styles.box}>
      {error && <p style={styles.errorText}>{error}</p>}
      <div style={styles.inputRow}>
        <AutoGrowTextarea
          value={text}
          onChange={setText}
          onEnter={handleSubmit}
          placeholder={placeholder}
          style={styles.input}
          disabled={saving}
        />
        <VoiceInputButton
          disabled={saving}
          onBusyChange={setVoiceBusy}
          onTranscribed={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))}
        />
        <button type="button" onClick={handleSubmit} disabled={saving || voiceBusy || !text.trim()} style={styles.button}>
          {saving ? '…' : 'Add'}
        </button>
      </div>

      {/* Progress panel. The first line is true the moment the insert returns; the rest only ever
          describes writes that actually succeeded (see checklistLines). Genuinely live per-item
          ticking isn't possible here — the whole wait is one AI call and the database writes after
          it take well under a second — so rather than fake staged checkmarks on a timer, this shows
          one earned checkmark, an honest pending line, then the real results. */}
      {noteSaved && (
        <div style={styles.progressPanel}>
          <p style={styles.progressDone}>✓ Saved your note</p>
          {detecting && <p style={styles.progressPending}>Reading it and picking out the details…</p>}
          {doneLines?.map((line) => (
            <p key={line} style={styles.progressDone}>
              ✓ {line}
            </p>
          ))}
          {doneLines?.length === 0 && !detectError && (
            <p style={styles.progressPending}>Nothing else to add from that one — your note's saved.</p>
          )}
          {detectError && <p style={styles.errorText}>{detectError}</p>}
          {assistantReply && !clarification && <div style={styles.assistantBubble}>{assistantReply}</div>}
        </div>
      )}
      {clarification && (
        <div style={styles.clarifyBox}>
          <div style={styles.assistantBubble}>{clarification.question}</div>
          <div style={styles.inputRow}>
            <AutoGrowTextarea
              value={clarifyReply}
              onChange={setClarifyReply}
              onEnter={handleClarifyReply}
              placeholder="Your answer…"
              style={styles.input}
              disabled={clarifySending}
            />
            <button
              type="button"
              onClick={handleClarifyReply}
              disabled={clarifySending || !clarifyReply.trim()}
              style={styles.button}
            >
              {clarifySending ? '…' : 'Reply'}
            </button>
          </div>
        </div>
      )}
      <RelationshipSuggestionBanners
        relationshipSuggestions={relationshipSuggestions}
        setRelationshipSuggestions={setRelationshipSuggestions}
        newPersonSuggestions={newPersonSuggestions}
        setNewPersonSuggestions={setNewPersonSuggestions}
        onApplied={() => onSaved(subjectType === 'group' ? { rename: null } : undefined)}
      />
      {subjectType === 'moment' && (
        <MentionedPeopleSuggestionBanners
          suggestions={mentionedPeopleSuggestions}
          setSuggestions={setMentionedPeopleSuggestions}
          onApplied={() => onSaved()}
        />
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  box: { display: 'flex', flexDirection: 'column', gap: space.md },
  inputRow: { display: 'flex', alignItems: 'flex-end', gap: space.md },
  input: { flex: 1, fontSize: fontSize.base, padding: '0.6rem', borderRadius: radius.md, border: border.default },
  button: {
    fontSize: fontSize.base,
    padding: '0.6rem 1.1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
  },
  errorText: { fontSize: fontSize.body, color: neutral.redDeep, margin: 0 },
  progressPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    padding: `${space.md} 0.85rem`,
    borderRadius: radius.md,
    backgroundColor: neutral.warm150,
  },
  progressDone: { fontSize: fontSize.body, color: colors.textStrong, margin: 0 },
  progressPending: { fontSize: fontSize.body, color: colors.textMuted, margin: 0 },
  clarifyBox: { display: 'flex', flexDirection: 'column', gap: space.sm },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: neutral.warm150,
    color: colors.textStrong,
    padding: '0.5rem 0.85rem',
    borderRadius: radius.lg,
    maxWidth: '85%',
    fontSize: fontSize.bodyLg,
  },
}
