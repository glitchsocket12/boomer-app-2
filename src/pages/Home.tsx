import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type PersonRef = { id: string; name: string }
type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  people?: PersonRef[]
}

export default function Home({ onSelectPerson }: { onSelectPerson: (person: PersonRef) => void }) {
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])

  async function handleSend() {
    if (!input.trim() || sending) return

    const newThread: ChatMessage[] = [...thread, { role: 'user', content: input.trim() }]
    setThread(newThread)
    setInput('')
    setSending(true)

    // Only send role + content to the AI — it doesn't need the "people" chip data
    const apiMessages = newThread.map((m) => ({ role: m.role, content: m.content }))

    const { data, error } = await supabase.functions.invoke('converse', {
      body: { messages: apiMessages },
    })

    setSending(false)

    if (error || !data) {
      setThread([...newThread, { role: 'assistant', content: "Sorry, something went wrong. Let's try again." }])
      return
    }

    setThread([...newThread, { role: 'assistant', content: data.reply, people: data.people ?? [] }])
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Boomer</h1>

      {thread.length === 0 && (
        <p style={styles.emptyState}>Ask about anyone or any moment, or just tell me what's on your mind.</p>
      )}

      <div style={styles.thread}>
        {thread.map((m, i) => (
          <div key={i}>
            <div style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>{m.content}</div>
            {m.people && m.people.length > 0 && (
              <div style={styles.peopleRow}>
                {m.people.map((p) => (
                  <button key={p.id} onClick={() => onSelectPerson(p)} style={styles.personChip}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && <div style={styles.assistantBubble}>…</div>}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask, share, or add a detail…"
          style={styles.input}
          disabled={sending}
        />
        <button onClick={handleSend} disabled={sending} style={styles.button}>
          Send
        </button>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Georgia, serif', display: 'flex', flexDirection: 'column', minHeight: '75vh' },
  heading: { fontSize: '2rem', color: '#2E4034', marginBottom: '0.5rem', textAlign: 'center' },
  emptyState: { color: '#777', textAlign: 'center', marginTop: '1rem' },
  thread: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', paddingBottom: '1rem' },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#2E4034',
    color: '#FFF',
    padding: '0.65rem 1rem',
    borderRadius: '12px',
    maxWidth: '80%',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF',
    color: '#222',
    padding: '0.65rem 1rem',
    borderRadius: '12px',
    maxWidth: '80%',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  peopleRow: { display: 'flex', gap: '0.5rem', marginTop: '0.4rem', flexWrap: 'wrap' },
  personChip: {
    fontSize: '0.9rem',
    padding: '0.35rem 0.8rem',
    borderRadius: '999px',
    border: '1px solid #2E4034',
    backgroundColor: 'transparent',
    color: '#2E4034',
    cursor: 'pointer',
  },
  inputRow: { display: 'flex', gap: '0.75rem', marginTop: '1rem', borderTop: '1px solid #E5E3DE', paddingTop: '1rem' },
  input: { flex: 1, fontSize: '1.1rem', padding: '0.65rem', borderRadius: '8px', border: '1px solid #CCC' },
  button: {
    fontSize: '1.1rem',
    padding: '0.65rem 1.25rem',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#2E4034',
    color: '#FFF',
    cursor: 'pointer',
  },
}