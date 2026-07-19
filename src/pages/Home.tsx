import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import VoiceInputButton from '../components/VoiceInputButton'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import { EventChip, GroupChip } from '../components/Chips'
import { summarize } from '../lib/summarize'

type PersonRef = { id: string; name: string }
type EventRef = { id: string; summary: string }
type GroupRef = { id: string; name: string }
type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  people?: PersonRef[]
  events?: EventRef[]
  groups?: GroupRef[]
}

export default function Home({
  onSelectPerson,
  onSelectEvent,
  onSelectGroup,
}: {
  onSelectPerson: (person: PersonRef) => void
  onSelectEvent: (event: EventRef) => void
  onSelectGroup: (group: GroupRef) => void
}) {
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [stats, setStats] = useState<{ people: number; events: number; groups: number; notes: number } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])

  useEffect(() => {
    supabase.functions
      .invoke('suggest-prompts', {})
      .then(({ data }) => {
        if (data?.suggestions?.length) setSuggestions(data.suggestions)
      })
      .finally(() => setSuggestionsLoading(false))
  }, [])

  // Head-only count queries — cheap, no rows transferred, just the total for each table.
  useEffect(() => {
    Promise.all([
      supabase.from('people').select('id', { count: 'exact', head: true }),
      supabase.from('moments').select('id', { count: 'exact', head: true }),
      supabase.from('groups').select('id', { count: 'exact', head: true }),
      supabase.from('notes').select('id', { count: 'exact', head: true }),
    ]).then(([people, events, groups, notes]) => {
      setStats({
        people: people.count ?? 0,
        events: events.count ?? 0,
        groups: groups.count ?? 0,
        notes: notes.count ?? 0,
      })
    })
  }, [])

  function handleSuggestionClick(text: string) {
    setSuggestions([])
    sendMessage(text)
  }

  function handleSend() {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput('')
    sendMessage(text)
  }

  // Shared by both the text-box Send button and a clicked suggestion card — a suggestion
  // now actually starts the conversation (sent as the opening message) instead of just
  // appearing as inert app text the user then has to reply to themselves.
  async function sendMessage(text: string) {
    if (sending) return

    const newThread: ChatMessage[] = [...thread, { role: 'user', content: text }]
    setThread(newThread)
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

    // A single message can now describe several distinct events at once, so converse returns
    // a list of moment IDs touched this turn rather than just one.
    const events = (
      await Promise.all(
        ((data.momentIds ?? []) as string[]).map(async (id) => {
          const { data: moment } = await supabase.from('moments').select('occasion, raw_description').eq('id', id).single()
          return moment ? { id, summary: summarize(moment.occasion, moment.raw_description) } : null
        })
      )
    ).filter((e): e is EventRef => e !== null)

    setThread([...newThread, { role: 'assistant', content: data.reply, people: data.people ?? [], events, groups: data.groups ?? [] }])
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Boomer</h1>

      {thread.length === 0 && (
        <>
          {stats && (stats.people > 0 || stats.events > 0 || stats.groups > 0 || stats.notes > 0) && (
            <div style={styles.statsRow}>
              <div style={styles.statTile}>
                <div style={styles.statNumber}>{stats.people}</div>
                <div style={styles.statLabel}>People</div>
              </div>
              <div style={styles.statTile}>
                <div style={styles.statNumber}>{stats.events}</div>
                <div style={styles.statLabel}>Events</div>
              </div>
              <div style={styles.statTile}>
                <div style={styles.statNumber}>{stats.groups}</div>
                <div style={styles.statLabel}>Groups</div>
              </div>
              <div style={styles.statTile}>
                <div style={styles.statNumber}>{stats.notes}</div>
                <div style={styles.statLabel}>Notes</div>
              </div>
            </div>
          )}
          <p style={styles.emptyState}>Ask about anyone or any moment, or just tell me what's on your mind.</p>
          {suggestionsLoading && (
            <div style={styles.suggestionsLoadingRow}>
              <span style={styles.spinner} />
              Finding a few things to ask about — give it a second before tapping away…
            </div>
          )}
          {!suggestionsLoading && suggestions.length > 0 && (
            <div style={styles.suggestionList}>
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => handleSuggestionClick(s)} style={styles.suggestionCard}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div style={styles.thread}>
        {thread.map((m, i) => (
          <div key={i}>
            <div style={m.role === 'user' ? styles.userBubble : styles.assistantBubble}>{m.content}</div>
            {((m.people && m.people.length > 0) || (m.events && m.events.length > 0) || (m.groups && m.groups.length > 0)) && (
              <div style={styles.peopleRow}>
                {m.people?.map((p) => (
                  <button key={p.id} onClick={() => onSelectPerson(p)} style={styles.personChip}>
                    {p.name}
                  </button>
                ))}
                {m.events?.map((e) => (
                  <EventChip key={e.id} label={e.summary} onClick={() => onSelectEvent(e)} />
                ))}
                {m.groups?.map((g) => (
                  <GroupChip key={g.id} label={g.name} onClick={() => onSelectGroup(g)} />
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && <div style={styles.assistantBubble}>…</div>}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        <AutoGrowTextarea
          value={input}
          onChange={setInput}
          onEnter={handleSend}
          placeholder="Ask, share, or add a detail…"
          style={styles.input}
          disabled={sending}
        />
        <VoiceInputButton
          disabled={sending}
          onTranscribed={(text) => setInput((prev) => (prev ? `${prev} ${text}` : text))}
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
  statsRow: { display: 'flex', gap: '0.75rem', marginTop: '1.25rem' },
  statTile: {
    flex: 1,
    textAlign: 'center',
    backgroundColor: '#F4F8F5',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '0.75rem 0.5rem',
  },
  statNumber: { fontSize: '1.5rem', color: '#2E4034', fontWeight: 'bold', lineHeight: 1.2 },
  statLabel: { fontSize: '0.8rem', color: '#666', marginTop: '0.15rem' },
  suggestionsLoadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    marginTop: '1.25rem',
    padding: '0.85rem 1rem',
    borderRadius: '10px',
    border: '1px solid #E5E3DE',
    color: '#777',
    fontSize: '0.95rem',
    lineHeight: 1.4,
  },
  spinner: {
    flexShrink: 0,
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    border: '2px solid #CFE0D6',
    borderTopColor: '#2E4034',
    animation: 'spin 0.8s linear infinite',
  },
  suggestionList: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1.25rem' },
  suggestionCard: {
    fontFamily: 'Georgia, serif',
    fontSize: '1rem',
    textAlign: 'left',
    padding: '0.85rem 1rem',
    borderRadius: '10px',
    border: '1px solid #CFE0D6',
    backgroundColor: '#F4F8F5',
    color: '#2E4034',
    cursor: 'pointer',
    lineHeight: 1.4,
  },
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
  inputRow: { display: 'flex', alignItems: 'flex-end', gap: '0.75rem', marginTop: '1rem', borderTop: '1px solid #E5E3DE', paddingTop: '1rem' },
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