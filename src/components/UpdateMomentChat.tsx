import { useState } from 'react'
import { supabase } from '../lib/supabase'
import VoiceInputButton from './VoiceInputButton'

type Message = { role: 'user' | 'assistant'; content: string }

export default function UpdateMomentChat({ momentId, onSaved }: { momentId: string; onSaved: () => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)

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

    if (error || !data) {
      setMessages([...newMessages, { role: 'assistant', content: "Sorry, something went wrong. Let's try again." }])
      return
    }

    const textBlock = data.content?.find((b: any) => b.type === 'text')
    const reply = textBlock?.text ?? ''

    if (!reply.trim()) {
      setMessages([...newMessages, { role: 'assistant', content: "Sorry, I didn't get a response there — please try again." }])
      return
    }

    let parsed: { done: boolean; new_people: string[]; additional_notes: { person: string; note: string }[] } | null = null
    try {
      const start = reply.indexOf('{')
      const end = reply.lastIndexOf('}')
      const obj = JSON.parse(reply.slice(start, end + 1))
      if (obj.done === true) parsed = obj
    } catch {
      // not a completion yet, just a follow-up question
    }

    if (parsed) {
      await saveUpdates(parsed)
      setDone(true)
    } else {
      setMessages([...newMessages, { role: 'assistant', content: reply }])
    }
  }

  async function saveUpdates(parsed: { new_people: string[]; additional_notes: { person: string; note: string }[] }) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { data: existingPeople } = await supabase.from('people').select('id, name').eq('user_id', user?.id)
    const nameToId: { [name: string]: string } = {}
    for (const p of existingPeople ?? []) nameToId[p.name.toLowerCase()] = p.id

    for (const name of parsed.new_people ?? []) {
      const key = name.toLowerCase()
      if (!nameToId[key]) {
        const { data: newPerson } = await supabase
          .from('people')
          .insert({ user_id: user?.id, name })
          .select()
          .single()
        if (newPerson) nameToId[key] = newPerson.id
      }
    }

    for (const note of parsed.additional_notes ?? []) {
      const personId = nameToId[note.person.toLowerCase()]
      if (personId) {
        await supabase.from('notes').insert({
          person_id: personId,
          moment_id: momentId,
          content: note.note,
        })
      }
    }

    onSaved()
  }

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
      </div>
    )
  }

  return (
    <div style={styles.box}>
      {messages.map((m, i) => (
        <div key={i} style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>
          {m.content}
        </div>
      ))}
      {sending && <div style={styles.assistantBubble}>…</div>}
      <div style={styles.inputRow}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
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
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#2E4034', color: '#FFF', padding: '0.5rem 0.85rem', borderRadius: '10px', maxWidth: '85%', fontSize: '0.95rem' },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: '#F1F1EE', color: '#222', padding: '0.5rem 0.85rem', borderRadius: '10px', maxWidth: '85%', fontSize: '0.95rem' },
  inputRow: { display: 'flex', gap: '0.5rem', marginTop: '0.25rem' },
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