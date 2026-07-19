import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import VoiceInputButton from './VoiceInputButton'
import AutoGrowTextarea from './AutoGrowTextarea'
import RelationshipSuggestionBanners, {
  toStagedNewPersonSuggestions,
  type RelationshipSuggestion,
  type NewPersonSuggestion,
} from './RelationshipSuggestions'

type Message = { role: 'user' | 'assistant'; content: string }

export default function UpdateMomentChat({ momentId, onSaved }: { momentId: string; onSaved: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [relationshipSuggestions, setRelationshipSuggestions] = useState<RelationshipSuggestion[]>([])
  const [newPersonSuggestions, setNewPersonSuggestions] = useState<NewPersonSuggestion[]>([])
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
  }

  const suggestionBanners = (
    <RelationshipSuggestionBanners
      relationshipSuggestions={relationshipSuggestions}
      setRelationshipSuggestions={setRelationshipSuggestions}
      newPersonSuggestions={newPersonSuggestions}
      setNewPersonSuggestions={setNewPersonSuggestions}
    />
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
  box: { marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  thread: { display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '340px', overflowY: 'auto', padding: '0.25rem' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#2E4034', color: '#FFF', padding: '0.5rem 0.85rem', borderRadius: '10px', maxWidth: '85%', fontSize: '0.95rem' },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: '#F1F1EE', color: '#222', padding: '0.5rem 0.85rem', borderRadius: '10px', maxWidth: '85%', fontSize: '0.95rem' },
  inputRow: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem' },
  input: { flex: 1, fontSize: '0.95rem', padding: '0.5rem', borderRadius: '6px', border: '1px solid #CCC' },
  button: { fontSize: '0.95rem', padding: '0.5rem 0.9rem', borderRadius: '6px', border: 'none', backgroundColor: '#2E4034', color: '#FFF', cursor: 'pointer' },
  doneText: { marginTop: '0.75rem', fontSize: '0.95rem', color: '#2E4034' },
  addAnotherLink: {
    fontSize: '0.85rem',
    background: 'none',
    border: 'none',
    color: '#777',
    textDecoration: 'underline',
    cursor: 'pointer',
    padding: 0,
    marginTop: '0.25rem',
  },
}