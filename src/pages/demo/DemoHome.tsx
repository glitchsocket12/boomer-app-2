import { useRef, useState } from 'react'
import { HomeView, type ChatMessage, type PersonRef, type EventRef, type GroupRef, type LeaderboardEntry } from '../Home'
import {
  DEMO_PEOPLE,
  DEMO_GROUPS,
  DEMO_MOMENTS,
  DEMO_NOTES,
  DEMO_CHAT_SUGGESTIONS,
  DEMO_CHAT_FALLBACK,
  demoPersonName,
  matchDemoChat,
} from '../../lib/demoData'

const nonSelfPeople = DEMO_PEOPLE.filter((p) => !p.is_self)

function eventRef(momentId: string): EventRef {
  const m = DEMO_MOMENTS.find((mm) => mm.id === momentId)
  return { id: momentId, summary: m?.occasion ?? 'Untitled moment' }
}

export default function DemoHome({
  onSelectPerson,
  onSelectEvent,
  onSelectGroup,
  onNavigateTab,
}: {
  onSelectPerson: (person: PersonRef) => void
  onSelectEvent: (event: EventRef) => void
  onSelectGroup: (group: GroupRef) => void
  onNavigateTab: (tab: 'people' | 'events' | 'groups') => void
}) {
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // A person-note count leaderboard, exactly like the real Home's "Most reinforced this month" —
  // computed straight from the static dataset instead of a search_log/notes query.
  const noteCounts = new Map<string, number>()
  for (const n of DEMO_NOTES) noteCounts.set(n.personId, (noteCounts.get(n.personId) ?? 0) + 1)
  const leaderboard: LeaderboardEntry[] = [...noteCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, count]) => ({ id, name: demoPersonName(id), count }))

  function handleSend() {
    if (!input.trim()) return
    sendMessage(input.trim())
    setInput('')
  }

  function handleSuggestionClick(text: string) {
    sendMessage(text)
  }

  function sendMessage(text: string) {
    const userMessage: ChatMessage = { role: 'user', content: text }
    const match = matchDemoChat(text)
    const assistantMessage: ChatMessage = match
      ? {
          role: 'assistant',
          content: match.reply.text,
          people: (match.reply.personIds ?? []).map((id) => ({ id, name: demoPersonName(id) })),
          events: match.reply.eventId ? [eventRef(match.reply.eventId)] : [],
        }
      : { role: 'assistant', content: DEMO_CHAT_FALLBACK }
    setThread((prev) => [...prev, userMessage, assistantMessage])
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
  }

  return (
    <HomeView
      thread={thread}
      sending={false}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      onSuggestionClick={handleSuggestionClick}
      stats={{
        people: nonSelfPeople.length,
        events: DEMO_MOMENTS.length,
        groups: DEMO_GROUPS.length,
        notes: DEMO_NOTES.length,
      }}
      recallAssists={6}
      leaderboard={leaderboard}
      suggestions={DEMO_CHAT_SUGGESTIONS.map((s) => s.prompt)}
      suggestionsLoading={false}
      onRefreshSuggestions={() => {}}
      relationshipSuggestions={[]}
      setRelationshipSuggestions={() => {}}
      newPersonSuggestions={[]}
      setNewPersonSuggestions={() => {}}
      onSelectPerson={onSelectPerson}
      onSelectEvent={onSelectEvent}
      onSelectGroup={onSelectGroup}
      onSelectDunbar={() => {}}
      onSelectNudges={() => {}}
      onNavigateTab={onNavigateTab}
      bottomRef={bottomRef}
      readOnly
    />
  )
}
