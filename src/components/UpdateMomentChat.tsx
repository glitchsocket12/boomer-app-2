import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import VoiceInputButton from './VoiceInputButton'
import AutoGrowTextarea from './AutoGrowTextarea'
import RelationshipSuggestionBanners, {
  toStagedNewPersonSuggestions,
  type RelationshipSuggestion,
  type NewPersonSuggestion,
} from './RelationshipSuggestions'
import MentionedPeopleSuggestionBanners, { type MentionedPersonSuggestion } from './MentionedPeopleSuggestions'
import { border, colors, fontSize, neutral, radius, space } from '../lib/theme'

type Message = { role: 'user' | 'assistant'; content: string }

export default function UpdateMomentChat({ momentId, onSaved }: { momentId: string; onSaved: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [relationshipSuggestions, setRelationshipSuggestions] = useState<RelationshipSuggestion[]>([])
  const [newPersonSuggestions, setNewPersonSuggestions] = useState<NewPersonSuggestion[]>([])
  const [mentionedPeopleSuggestions, setMentionedPeopleSuggestions] = useState<MentionedPersonSuggestion[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, sending])

  async function sendMessage() {
    if (!input.trim() || sending) return

    const newMessages: Message[] = [...messages, { role: 'user', content: input.trim() }]
    setMessages(newMessages)
    setInput('')
    setSending(true)

    const { data, error } = await supabase.functions.invoke('update-moment', {
      body: { momentId, messages: newMessages },
    })

    setSending(false)

    if (error || !data?.reply) {
      setMessages([...newMessages, { role: 'assistant', content: "Sorry, something went wrong. Let's try again." }])
      return
    }

    // The Edge Function already saved anything new to the database before responding,
    // so nothing here is lost even if the user never replies to this message again.
    setMessages([...newMessages, { role: 'assistant', content: data.reply }])
    if (data.changed) onSaved()
    if (data.done) setDone(true)

    if (data.relationshipSuggestions?.length > 0) {
      setRelationshipSuggestions((prev) => [...prev, ...data.relationshipSuggestions])
    }
    if (data.newPersonSuggestions?.length > 0) {
      setNewPersonSuggestions((prev) => [...prev, ...toStagedNewPersonSuggestions(data.newPersonSuggestions)])
    }
    if (data.mentionedPeopleSuggestions?.length > 0) {
      setMentionedPeopleSuggestions((prev) => [...prev, ...data.mentionedPeopleSuggestions])
    }
  }

  const suggestionBanners = (
    <>
      <RelationshipSuggestionBanners
        relationshipSuggestions={relationshipSuggestions}
        setRelationshipSuggestions={setRelationshipSuggestions}
        newPersonSuggestions={newPersonSuggestions}
        setNewPersonSuggestions={setNewPersonSuggestions}
      />
      {/* onSaved reloads the event page, so a confirmed profile appears under "Who was there"
          straight away rather than after a manual refresh. */}
      <MentionedPeopleSuggestionBanners
        suggestions={mentionedPeopleSuggestions}
        setSuggestions={setMentionedPeopleSuggestions}
        onApplied={onSaved}
      />
    </>
  )

  if (done) {
    return (
      <div>
        <p style={styles.doneText}>Got it — added to this memory.</p>
        <button
          onClick={() => {
            setDone(false)
            setMessages([])
          }}
          style={styles.addAnotherLink}
        >
          + Add another detail
        </button>
        {suggestionBanners}
      </div>
    )
  }

  return (
    <div style={styles.box}>
      {messages.length > 0 && (
        <div style={styles.thread}>
          {messages.map((m, i) => (
            <div key={i} style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>
              {m.content}
            </div>
          ))}
          {sending && <div style={styles.assistantBubble}>…</div>}
          <div ref={bottomRef} />
        </div>
      )}
      {suggestionBanners}
      <div style={styles.inputRow}>
        <AutoGrowTextarea
          value={input}
          onChange={setInput}
          onEnter={sendMessage}
          placeholder="What else do you remember?"
          style={styles.input}
          disabled={sending}
        />
        <VoiceInputButton
          disabled={sending}
          onTranscribed={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))}
        />
        <button onClick={sendMessage} disabled={sending} style={styles.button}>
          Send
        </button>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  box: { marginTop: space.lg, display: 'flex', flexDirection: 'column', gap: space.md },
  thread: { display: 'flex', flexDirection: 'column', gap: space.md, maxHeight: '340px', overflowY: 'auto', padding: space.xs },
  userBubble: { alignSelf: 'flex-end', backgroundColor: colors.ink, color: colors.onFill, padding: '0.5rem 0.85rem', borderRadius: radius.lg, maxWidth: '85%', fontSize: fontSize.bodyLg },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: neutral.warm150, color: colors.textStrong, padding: '0.5rem 0.85rem', borderRadius: radius.lg, maxWidth: '85%', fontSize: fontSize.bodyLg },
  inputRow: { display: 'flex', alignItems: 'flex-end', gap: space.md },
  input: { flex: 1, fontSize: fontSize.bodyLg, padding: space.md, borderRadius: radius.sm, border: border.default },
  button: { fontSize: fontSize.bodyLg, padding: '0.5rem 0.9rem', borderRadius: radius.sm, border: 'none', backgroundColor: colors.ink, color: colors.onFill, cursor: 'pointer' },
  doneText: { marginTop: space.lg, fontSize: fontSize.bodyLg, color: colors.ink },
  addAnotherLink: {
    fontSize: fontSize.label,
    background: 'none',
    border: 'none',
    color: colors.textSubtle,
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: 0,
    marginTop: space.xs,
  },
}