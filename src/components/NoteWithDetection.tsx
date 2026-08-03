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
    if (data.changed) {
      onSaved(subjectType === 'group' ? { rename: data.rename ?? null } : undefined)
    }
  }

  // Fire-and-forget, non-blocking — the note itself is already safely saved by the time this
  // runs, so a network hiccup or a parse failure here just means suggestions don't show up this
  // turn, not that anything the user said is lost.
  async function runDetection(history: Message[]) {
    const { data, error: fnError } = await supabase.functions.invoke(functionName, {
      body: { [idField]: subjectId, messages: history },
    })
    if (fnError || !data) return
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
    onSaved(subjectType === 'group' ? { rename: null } : undefined)
    runDetection([{ role: 'user', content: trimmed }])
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
        <VoiceInputButton disabled={saving} onTranscribed={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))} />
        <button type="button" onClick={handleSubmit} disabled={saving || !text.trim()} style={styles.button}>
          {saving ? '…' : 'Add'}
        </button>
      </div>
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
    backgroundColor: colors.ink,
    color: colors.onFill,
    cursor: 'pointer',
  },
  errorText: { fontSize: fontSize.body, color: neutral.redDeep, margin: 0 },
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
