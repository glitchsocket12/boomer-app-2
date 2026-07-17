import { useState } from 'react'
import { supabase } from '../lib/supabase'
import VoiceInputButton from './VoiceInputButton'
import AutoGrowTextarea from './AutoGrowTextarea'

type Message = { role: 'user' | 'assistant'; content: string }

type GroupUpdate = {
  done: boolean
  rename: string | null
  add_people: string[]
  remove_people: string[]
  add_event_ids: string[]
  remove_event_ids: string[]
}

export default function UpdateGroupChat({
  groupId,
  onSaved,
}: {
  groupId: string
  onSaved: (update: { rename: string | null }) => void
}) {
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

    const { data, error } = await supabase.functions.invoke('update-group', {
      body: { groupId, messages: newMessages },
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

    let parsed: GroupUpdate | null = null
    try {
      const start = reply.indexOf('{')
      const end = reply.lastIndexOf('}')
      const obj = JSON.parse(reply.slice(start, end + 1))
      if (obj.done === true) parsed = obj
    } catch {
      // not a completion yet, just a follow-up question
    }

    if (parsed) {
      await applyUpdate(parsed)
      setDone(true)
    } else {
      setMessages([...newMessages, { role: 'assistant', content: reply }])
    }
  }

  async function applyUpdate(update: GroupUpdate) {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (update.rename && update.rename.trim()) {
      await supabase.from('groups').update({ name: update.rename.trim() }).eq('id', groupId)
    }

    if ((update.add_people?.length ?? 0) > 0) {
      const { data: existingPeople } = await supabase.from('people').select('id, name').eq('user_id', user?.id)
      const nameToId: { [name: string]: string } = {}
      for (const p of existingPeople ?? []) nameToId[p.name.toLowerCase()] = p.id

      for (const name of update.add_people) {
        const key = name.toLowerCase()
        let personId = nameToId[key]
        if (!personId) {
          const { data: newPerson } = await supabase.from('people').insert({ user_id: user?.id, name }).select().single()
          if (newPerson) personId = newPerson.id
        }
        if (personId) {
          await supabase
            .from('person_groups')
            .upsert({ person_id: personId, group_id: groupId }, { onConflict: 'person_id,group_id', ignoreDuplicates: true })
        }
      }
    }

    if ((update.remove_people?.length ?? 0) > 0) {
      const { data: existingPeople } = await supabase.from('people').select('id, name').eq('user_id', user?.id)
      const nameToId: { [name: string]: string } = {}
      for (const p of existingPeople ?? []) nameToId[p.name.toLowerCase()] = p.id

      for (const name of update.remove_people) {
        const personId = nameToId[name.toLowerCase()]
        if (personId) {
          await supabase.from('person_groups').delete().eq('person_id', personId).eq('group_id', groupId)
        }
      }
    }

    for (const momentId of update.add_event_ids ?? []) {
      await supabase
        .from('moment_groups')
        .upsert({ moment_id: momentId, group_id: groupId }, { onConflict: 'moment_id,group_id', ignoreDuplicates: true })
    }

    for (const momentId of update.remove_event_ids ?? []) {
      await supabase.from('moment_groups').delete().eq('moment_id', momentId).eq('group_id', groupId)
    }

    // Membership/events changed — the cached AI summary is now stale, so clear and regenerate it.
    await supabase.from('groups').update({ summary: null }).eq('id', groupId)
    await supabase.functions.invoke('summarize-group', { body: { groupId } })

    onSaved({ rename: update.rename?.trim() || null })
  }

  if (done) {
    return (
      <div>
        <p style={styles.doneText}>Got it — updated the group.</p>
        <button
          onClick={() => {
            setDone(false)
            setMessages([])
          }}
          style={styles.addAnotherLink}
        >
          + Make another change
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
        <AutoGrowTextarea
          value={input}
          onChange={setInput}
          onEnter={sendMessage}
          placeholder="Add someone, tag an event, rename it..."
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
  inputRow: { display: 'flex', alignItems: 'flex-end', gap: '0.5rem', marginTop: '0.25rem' },
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
