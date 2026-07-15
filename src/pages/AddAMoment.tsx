import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type Message = { role: 'user' | 'assistant'; content: string }

export default function AddAMoment() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [finished, setFinished] = useState(false)
  const [savedPeople, setSavedPeople] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  // Keep the chat scrolled to the latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || sending) return

    const newMessages: Message[] = [...messages, { role: 'user', content: input.trim() }]
    setMessages(newMessages)
    setInput('')
    setSending(true)

    // Ask our secure Edge Function to talk to Claude on our behalf
    const { data, error } = await supabase.functions.invoke('chat', {
      body: { messages: newMessages },
    })

    setSending(false)

    if (error || !data) {
      setMessages([...newMessages, { role: 'assistant', content: "Sorry, something went wrong. Let's try again." }])
      return
    }

    // Pull the actual text Claude wrote out of the response
    const textBlock = data.content?.find((block: any) => block.type === 'text')
    const reply = textBlock?.text ?? ''

    // Check if Claude decided it has enough detail and sent back a structured summary
    const parsed = tryParseCompletion(reply)

    if (parsed) {
      await saveMoment(newMessages, parsed)
      setFinished(true)
      setSavedPeople(parsed.people)
    } else {
      setMessages([...newMessages, { role: 'assistant', content: reply }])
    }
  }

  function tryParseCompletion(text: string) {
    try {
      const obj = JSON.parse(text.trim())
      if (obj.done === true && Array.isArray(obj.notes)) return obj
      return null
    } catch {
      return null
    }
  }

  async function saveMoment(
    conversation: Message[],
    parsed: {
      people: string[]
      occasion?: string | null
      location?: string | null
      when_text?: string | null
      details?: Record<string, any> | null
      notes: { person: string; note: string }[]
    }
  ) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // 1. Save a record of this moment, including the event/location context
    const rawText = conversation.map((m) => m.content).join('\n')
    const { data: moment } = await supabase
      .from('moments')
      .insert({
        user_id: user?.id,
        raw_description: rawText,
        occasion: parsed.occasion ?? null,
        location: parsed.location ?? null,
        when_text: parsed.when_text ?? null,
        details: parsed.details ?? null,
      })
      .select()
      .single()

    // 2. For each person mentioned: find them if they already exist, or create them
    const { data: existingPeople } = await supabase.from('people').select('id, name').eq('user_id', user?.id)

    const nameToId: { [name: string]: string } = {}
    for (const p of existingPeople ?? []) {
      nameToId[p.name.toLowerCase()] = p.id
    }

    for (const fullName of parsed.people) {
      const key = fullName.toLowerCase()
      if (!nameToId[key]) {
        // If Claude gave us a full name like "Manuel Garcia," split it into first/last
        const [first, ...rest] = fullName.trim().split(' ')
        const lastName = rest.length > 0 ? rest.join(' ') : null

        const { data: newPerson } = await supabase
          .from('people')
          .insert({ user_id: user?.id, name: first, last_name: lastName })
          .select()
          .single()
        if (newPerson) nameToId[key] = newPerson.id
      }
    }

    // 3. Save each note, tied to the right person and this moment
    for (const note of parsed.notes) {
      const personId = nameToId[note.person.toLowerCase()]
      if (personId && moment) {
        await supabase.from('notes').insert({
          person_id: personId,
          moment_id: moment.id,
          content: note.note,
        })
      }
    }
  }

  function startOver() {
    setMessages([])
    setFinished(false)
    setSavedPeople([])
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Add a Moment</h1>

      {messages.length === 0 && !finished && (
        <p style={styles.prompt}>Tell me about something that happened recently — who was there, what you talked about.</p>
      )}

      <div style={styles.chatBox}>
        {messages.map((m, i) => (
          <div key={i} style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>
            {m.content}
          </div>
        ))}
        {sending && <div style={styles.assistantBubble}>…</div>}
        <div ref={bottomRef} />
      </div>

      {finished ? (
        <div style={styles.doneBox}>
          <p>Saved! Notes were added for: {savedPeople.join(', ')}.</p>
          <button onClick={startOver} style={styles.button}>Add another moment</button>
        </div>
      ) : (
        <div style={styles.inputRow}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type here…"
            style={styles.input}
            disabled={sending}
          />
          <button onClick={sendMessage} disabled={sending} style={styles.button}>
            Send
          </button>
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '600px', margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'Georgia, serif' },
  heading: { fontSize: '2rem', color: '#2E4034', marginBottom: '1rem' },
  prompt: { color: '#555', marginBottom: '1rem' },
  chatBox: { display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem', maxHeight: '400px', overflowY: 'auto' },
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
  inputRow: { display: 'flex', gap: '0.75rem' },
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
  doneBox: { textAlign: 'center', color: '#2E4034' },
}