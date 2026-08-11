import { useState, useRef, useEffect, type RefObject, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { border, colors, fontFamily, fontSize, maxWidth, neutral, radius, space } from '../lib/theme'
import VoiceInputButton from '../components/VoiceInputButton'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import { EventChip, GroupChip } from '../components/Chips'
import RefreshButton from '../components/RefreshButton'
import { summarize } from '../lib/summarize'
import RelationshipSuggestionBanners, {
  toStagedNewPersonSuggestions,
  type RelationshipSuggestion,
  type NewPersonSuggestion,
} from '../components/RelationshipSuggestions'
import MentionedPeopleSuggestionBanners, {
  type MentionedPersonSuggestion,
} from '../components/MentionedPeopleSuggestions'
import DevOnboardingReset from '../components/DevOnboardingReset'
import { useGroupRoster, type GroupLabelFn } from '../lib/groupRoster'
import {
  loadHomeSuggestions,
  acceptConnectionSuggestion,
  dismissConnectionSuggestion,
  suggestionKey,
  SAMPLE_SIZE,
  type HomeSuggestion,
} from '../lib/suggestConnections'
import { dismissSuggestion } from '../lib/dismissedSuggestions'
import { acceptCoParentGap, acceptCoupleGap } from '../lib/suggestRelationshipGaps'
import { acceptEventGroupSuggestion } from '../lib/suggestEventGroups'
import {
  loadFamilyTagSuggestions,
  acceptFamilyTagSuggestion,
  dismissFamilyTagSuggestion,
  type FamilyTagSuggestion,
} from '../lib/suggestFamilyTag'

export type PersonRef = { id: string; name: string }
export type EventRef = { id: string; summary: string }
export type GroupRef = { id: string; name: string }
export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  people?: PersonRef[]
  events?: EventRef[]
  groups?: GroupRef[]
}

const DUNBAR_LIMIT = 150

export type LeaderboardEntry = { id: string; name: string; count: number }

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export default function Home({
  onSelectPerson,
  onSelectEvent,
  onSelectGroup,
  onSelectDunbar,
  onSelectNudges,
  onNavigateTab,
  onOpenImportReview,
  onOpenBirthdayReview,
  onOpenContactImportReview,
  onOpenContactSelection,
}: {
  onSelectPerson: (person: PersonRef) => void
  onSelectEvent: (event: EventRef) => void
  onSelectGroup: (group: GroupRef) => void
  onSelectDunbar: () => void
  onSelectNudges: () => void
  onNavigateTab: (tab: 'people' | 'events' | 'groups') => void
  onOpenImportReview: () => void
  onOpenBirthdayReview: () => void
  onOpenContactImportReview: () => void
  onOpenContactSelection: () => void
}) {
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(true)
  const [stats, setStats] = useState<{ people: number; events: number; groups: number; notes: number } | null>(null)
  const [recallAssists, setRecallAssists] = useState<number | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [pendingImportCount, setPendingImportCount] = useState(0)
  const [pendingBirthdayImportCount, setPendingBirthdayImportCount] = useState(0)
  const [pendingContactSelectedCount, setPendingContactSelectedCount] = useState(0)
  const [pendingContactUndecidedCount, setPendingContactUndecidedCount] = useState(0)
  const [relationshipSuggestions, setRelationshipSuggestions] = useState<RelationshipSuggestion[]>([])
  const [newPersonSuggestions, setNewPersonSuggestions] = useState<NewPersonSuggestion[]>([])
  const [mentionedPeopleSuggestions, setMentionedPeopleSuggestions] = useState<MentionedPersonSuggestion[]>([])
  const [connectionSuggestions, setConnectionSuggestions] = useState<HomeSuggestion[]>([])
  const [familyTagSuggestions, setFamilyTagSuggestions] = useState<FamilyTagSuggestion[]>([])
  const [suggestionActionError, setSuggestionActionError] = useState<string | null>(null)
  const groupRoster = useGroupRoster()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])

  useEffect(() => {
    loadSuggestions(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Plain visits serve the DB-cached suggestions (no AI call unless new moments/notes were
  // recorded since); regeneration only happens via the explicit refresh icon in that case.
  function loadSuggestions(refresh: boolean) {
    setSuggestionsLoading(true)
    supabase.functions
      .invoke('suggest-prompts', { body: { refresh } })
      .then(({ data }) => {
        if (data?.suggestions?.length) setSuggestions(data.suggestions)
      })
      .finally(() => setSuggestionsLoading(false))
  }

  // Head-only count queries — cheap, no rows transferred, just the total for each table.
  useEffect(() => {
    Promise.all([
      supabase.from('people').select('id', { count: 'exact', head: true }).eq('is_self', false),
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
    supabase
      .from('moment_import_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingImportCount(count ?? 0))
    // birthday_import_candidates is a newer table (2026-07-26) — count query fails open to 0 via
    // the same `?? 0` fallback if the migration hasn't been applied yet.
    supabase
      .from('birthday_import_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingBirthdayImportCount(count ?? 0))
    // Deliberately count 'selected' here, not raw 'pending' — a founder mid-way through curating a
    // large contacts file shouldn't feel nagged about the ones they haven't gotten to yet. The
    // still-undecided count gets its own lower-key secondary line instead (see HomeView below).
    supabase
      .from('contact_import_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'selected')
      .then(({ count }) => setPendingContactSelectedCount(count ?? 0))
    supabase
      .from('contact_import_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingContactUndecidedCount(count ?? 0))
  }, [])

  // Free/deterministic, so it's cheap to just recompute on every Home visit rather than caching —
  // see lib/suggestConnections.ts for the four signals this pools together.
  useEffect(() => {
    loadHomeSuggestions().then(setConnectionSuggestions)
  }, [])

  // Same "cheap enough to recompute every visit" reasoning as loadConnectionSuggestions —
  // deterministic name-pattern check, no AI call. Fails open to an empty list (see
  // loadFamilyTagSuggestions) until the group_type_suggestion_dismissed migration is applied.
  useEffect(() => {
    loadFamilyTagSuggestions().then(setFamilyTagSuggestions)
  }, [])

  // "Working as intended" stats: recall assists (matched lookups logged by `converse`, see
  // supabase/functions/converse/index.ts) and the leaderboard (notes added per person), both
  // scoped to the current calendar month.
  useEffect(() => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    supabase
      .from('search_log')
      .select('id', { count: 'exact', head: true })
      .eq('matched', true)
      .gte('created_at', startOfMonth)
      .then(({ count }) => setRecallAssists(count ?? 0))

    supabase
      .from('notes')
      .select('person_id, people(id, name, last_name)')
      .not('person_id', 'is', null)
      .gte('created_at', startOfMonth)
      .then(({ data }) => {
        const counts = new Map<string, LeaderboardEntry>()
        for (const row of (data as unknown as { person_id: string; people: { id: string; name: string; last_name: string | null } | null }[]) ?? []) {
          if (!row.people) continue
          const fullName = row.people.last_name ? `${row.people.name} ${row.people.last_name}` : row.people.name
          const existing = counts.get(row.person_id)
          if (existing) existing.count += 1
          else counts.set(row.person_id, { id: row.person_id, name: fullName, count: 1 })
        }
        setLeaderboard([...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3))
      })
  }, [])

  function handleSuggestionClick(text: string) {
    setSuggestions([])
    sendMessage(text)
  }

  // Only drop the suggestion from local state once the write is confirmed — previously this
  // removed it optimistically and never checked for an error, so a failed write (silently)
  // left nothing saved, and since the suggestions recompute from the DB fresh on every visit,
  // the same suggestion just reappeared next time (bug reported 2026-08-03). Every branch below
  // keeps that contract, including the three question types added 2026-08-08.
  async function runSuggestionAction(suggestion: HomeSuggestion, write: () => Promise<{ error: string | null }>) {
    setSuggestionActionError(null)
    const { error } = await write()
    if (error) {
      setSuggestionActionError(`Couldn't save that — ${error}`)
      return
    }
    const key = suggestionKey(suggestion)
    setConnectionSuggestions((prev) => prev.filter((s) => suggestionKey(s) !== key))
  }

  // State holds the whole ordered candidate pool; only a batch of it is ever on screen. Because
  // runSuggestionAction filters the answered card out of state, the next one slides up on that
  // same render — no reload, no refetch, which is the whole of item 58.
  const visibleConnectionSuggestions = connectionSuggestions.slice(0, SAMPLE_SIZE)

  async function handleAcceptConnection(suggestion: HomeSuggestion) {
    await runSuggestionAction(suggestion, () => {
      switch (suggestion.kind) {
        case 'person_group':
          return acceptConnectionSuggestion(suggestion.person.id, suggestion.group.id)
        case 'family_coparent':
          return acceptCoParentGap(suggestion)
        case 'family_couple':
          return acceptCoupleGap(suggestion)
        case 'event_group':
          return acceptEventGroupSuggestion(suggestion.momentId, suggestion.groupId)
      }
    })
  }

  // person_group keeps writing to groups.dismissed_person_ids so a "No" here still holds when that
  // group's own page is opened later; the newer types have no such column and use the shared
  // dismissed_suggestions table instead (see lib/dismissedSuggestions.ts).
  async function handleDismissConnection(suggestion: HomeSuggestion) {
    await runSuggestionAction(suggestion, () => {
      switch (suggestion.kind) {
        case 'person_group':
          return dismissConnectionSuggestion(suggestion.person.id, suggestion.group.id)
        case 'family_coparent':
          return dismissSuggestion('family_coparent', suggestion.parentId, suggestion.childId)
        case 'family_couple':
          return dismissSuggestion('family_couple', suggestion.aId, suggestion.bId)
        case 'event_group':
          return dismissSuggestion('event_group', suggestion.momentId, suggestion.groupId)
      }
    })
  }

  async function handleAcceptFamilyTag(suggestion: FamilyTagSuggestion) {
    setSuggestionActionError(null)
    const { error } = await acceptFamilyTagSuggestion(suggestion.id)
    if (error) {
      setSuggestionActionError(`Couldn't save that — ${error}`)
      return
    }
    setFamilyTagSuggestions((prev) => prev.filter((s) => s !== suggestion))
  }

  async function handleDismissFamilyTag(suggestion: FamilyTagSuggestion) {
    setSuggestionActionError(null)
    const { error } = await dismissFamilyTagSuggestion(suggestion.id)
    if (error) {
      setSuggestionActionError(`Couldn't save that — ${error}`)
      return
    }
    setFamilyTagSuggestions((prev) => prev.filter((s) => s !== suggestion))
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

  return (
    <HomeView
      thread={thread}
      sending={sending}
      input={input}
      onInputChange={setInput}
      onSend={handleSend}
      onSuggestionClick={handleSuggestionClick}
      stats={stats}
      recallAssists={recallAssists}
      leaderboard={leaderboard}
      suggestions={suggestions}
      suggestionsLoading={suggestionsLoading}
      onRefreshSuggestions={() => loadSuggestions(true)}
      relationshipSuggestions={relationshipSuggestions}
      setRelationshipSuggestions={setRelationshipSuggestions}
      newPersonSuggestions={newPersonSuggestions}
      setNewPersonSuggestions={setNewPersonSuggestions}
      mentionedPeopleSuggestions={mentionedPeopleSuggestions}
      setMentionedPeopleSuggestions={setMentionedPeopleSuggestions}
      groupLabel={groupRoster.label}
      connectionSuggestions={visibleConnectionSuggestions}
      onAcceptConnection={handleAcceptConnection}
      onDismissConnection={handleDismissConnection}
      familyTagSuggestions={familyTagSuggestions}
      onAcceptFamilyTag={handleAcceptFamilyTag}
      onDismissFamilyTag={handleDismissFamilyTag}
      suggestionActionError={suggestionActionError}
      onSelectPerson={onSelectPerson}
      onSelectEvent={onSelectEvent}
      onSelectGroup={onSelectGroup}
      onSelectDunbar={onSelectDunbar}
      onSelectNudges={onSelectNudges}
      onNavigateTab={onNavigateTab}
      pendingImportCount={pendingImportCount}
      onOpenImportReview={onOpenImportReview}
      pendingBirthdayImportCount={pendingBirthdayImportCount}
      onOpenBirthdayReview={onOpenBirthdayReview}
      pendingContactSelectedCount={pendingContactSelectedCount}
      onOpenContactImportReview={onOpenContactImportReview}
      pendingContactUndecidedCount={pendingContactUndecidedCount}
      onOpenContactSelection={onOpenContactSelection}
      bottomRef={bottomRef}
      devTools={<DevOnboardingReset />}
    />
  )
}

// Pure render — everything it needs comes in as props. Split out (2026-07-22) so the landing-page
// demo can render the exact same dashboard/chat UI fed by static data, with no Supabase/Edge
// Function calls anywhere in this component. `readOnly` hides the mic button (which would
// otherwise call the `transcribe` Edge Function) and `devTools` is a slot the real container fills
// with the auth-only DevOnboardingReset control — the demo simply doesn't pass it.
export function HomeView({
  thread,
  sending,
  input,
  onInputChange,
  onSend,
  onSuggestionClick,
  stats,
  recallAssists,
  leaderboard,
  suggestions,
  suggestionsLoading,
  onRefreshSuggestions,
  relationshipSuggestions,
  setRelationshipSuggestions,
  newPersonSuggestions,
  setNewPersonSuggestions,
  // Optional with a no-op default so the landing-page demo (DemoHome.tsx) doesn't have to pass
  // suggestion plumbing it can never produce — it makes no Edge Function calls at all.
  mentionedPeopleSuggestions = [],
  setMentionedPeopleSuggestions = () => {},
  groupLabel = (_id, fallbackName) => fallbackName,
  connectionSuggestions = [],
  onAcceptConnection,
  onDismissConnection,
  familyTagSuggestions = [],
  onAcceptFamilyTag,
  onDismissFamilyTag,
  suggestionActionError = null,
  onSelectPerson,
  onSelectEvent,
  onSelectGroup,
  onSelectDunbar,
  onSelectNudges,
  onNavigateTab,
  pendingImportCount = 0,
  onOpenImportReview,
  pendingBirthdayImportCount = 0,
  onOpenBirthdayReview,
  pendingContactSelectedCount = 0,
  onOpenContactImportReview,
  pendingContactUndecidedCount = 0,
  onOpenContactSelection,
  bottomRef,
  devTools,
  readOnly = false,
}: {
  thread: ChatMessage[]
  sending: boolean
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onSuggestionClick: (text: string) => void
  stats: { people: number; events: number; groups: number; notes: number } | null
  recallAssists: number | null
  leaderboard: LeaderboardEntry[]
  suggestions: string[]
  suggestionsLoading: boolean
  onRefreshSuggestions: () => void
  relationshipSuggestions: RelationshipSuggestion[]
  setRelationshipSuggestions: Dispatch<SetStateAction<RelationshipSuggestion[]>>
  newPersonSuggestions: NewPersonSuggestion[]
  setNewPersonSuggestions: Dispatch<SetStateAction<NewPersonSuggestion[]>>
  mentionedPeopleSuggestions?: MentionedPersonSuggestion[]
  setMentionedPeopleSuggestions?: Dispatch<SetStateAction<MentionedPersonSuggestion[]>>
  // Qualifies a subgroup as "Parent / Child". Defaults to the bare name for the landing-page demo.
  groupLabel?: GroupLabelFn
  connectionSuggestions?: HomeSuggestion[]
  onAcceptConnection?: (suggestion: HomeSuggestion) => void
  onDismissConnection?: (suggestion: HomeSuggestion) => void
  familyTagSuggestions?: FamilyTagSuggestion[]
  onAcceptFamilyTag?: (suggestion: FamilyTagSuggestion) => void
  onDismissFamilyTag?: (suggestion: FamilyTagSuggestion) => void
  suggestionActionError?: string | null
  onSelectPerson: (person: PersonRef) => void
  onSelectEvent: (event: EventRef) => void
  onSelectGroup: (group: GroupRef) => void
  onSelectDunbar: () => void
  onSelectNudges: () => void
  onNavigateTab: (tab: 'people' | 'events' | 'groups') => void
  pendingImportCount?: number
  onOpenImportReview?: () => void
  pendingBirthdayImportCount?: number
  onOpenBirthdayReview?: () => void
  pendingContactSelectedCount?: number
  onOpenContactImportReview?: () => void
  pendingContactUndecidedCount?: number
  onOpenContactSelection?: () => void
  bottomRef: RefObject<HTMLDivElement | null>
  devTools?: ReactNode
  readOnly?: boolean
}) {
  return (
    <div style={styles.page}>
      <h1 style={styles.heading}>Boomer</h1>

      {thread.length === 0 && (
        <>
          {pendingImportCount > 0 && onOpenImportReview && (
            <button onClick={onOpenImportReview} style={styles.importNudge}>
              <span>
                {pendingImportCount} event{pendingImportCount === 1 ? '' : 's'} found from your calendar
              </span>
              <span>→</span>
            </button>
          )}

          {pendingBirthdayImportCount > 0 && onOpenBirthdayReview && (
            <button onClick={onOpenBirthdayReview} style={styles.importNudge}>
              <span>
                {pendingBirthdayImportCount} birthday{pendingBirthdayImportCount === 1 ? '' : 's'} found from your calendar
              </span>
              <span>→</span>
            </button>
          )}

          {pendingContactSelectedCount > 0 && onOpenContactImportReview && (
            <button onClick={onOpenContactImportReview} style={styles.importNudge}>
              <span>
                {pendingContactSelectedCount} contact{pendingContactSelectedCount === 1 ? '' : 's'} selected, ready to review
              </span>
              <span>→</span>
            </button>
          )}

          {pendingContactUndecidedCount > 0 && onOpenContactSelection && (
            <button onClick={onOpenContactSelection} style={styles.importNudgeSecondary}>
              <span>
                {pendingContactUndecidedCount} more contact{pendingContactUndecidedCount === 1 ? '' : 's'} to look through
              </span>
              <span>→</span>
            </button>
          )}

          {stats && (stats.people > 0 || stats.events > 0 || stats.groups > 0 || stats.notes > 0) && (
            <div style={styles.statsRow}>
              <button onClick={() => onNavigateTab('people')} style={{ ...styles.statTile, cursor: 'pointer' }}>
                <div style={styles.statNumber}>{stats.people}</div>
                <div style={styles.statLabel}>People</div>
              </button>
              <button onClick={() => onNavigateTab('events')} style={{ ...styles.statTile, cursor: 'pointer' }}>
                <div style={styles.statNumber}>{stats.events}</div>
                <div style={styles.statLabel}>Events</div>
              </button>
              <button onClick={() => onNavigateTab('groups')} style={{ ...styles.statTile, cursor: 'pointer' }}>
                <div style={styles.statNumber}>{stats.groups}</div>
                <div style={styles.statLabel}>Groups</div>
              </button>
              <div style={styles.statTile}>
                <div style={styles.statNumber}>{stats.notes}</div>
                <div style={styles.statLabel}>Datapoints</div>
              </div>
            </div>
          )}

          {stats && stats.people > 0 && (
            <div style={styles.signalsSection}>
              <div style={styles.signalCardsRow}>
                <button onClick={onSelectDunbar} style={styles.signalCard}>
                  {stats.people > DUNBAR_LIMIT ? (
                    <>
                      <div style={styles.signalNumber}>{stats.people - DUNBAR_LIMIT}</div>
                      <div style={styles.signalTitle}>People you'd have lost track of</div>
                      <div style={styles.signalSubtext}>beyond the ~150 minds can track unaided</div>
                    </>
                  ) : (
                    <>
                      <div style={styles.signalNumber}>{stats.people} of ~150</div>
                      <div style={styles.signalTitle}>Relationships you're keeping track of</div>
                      <div style={styles.signalSubtext}>most people can track about 150 unaided</div>
                    </>
                  )}
                </button>
                <div style={styles.signalCard}>
                  <div style={styles.signalNumber}>{recallAssists ?? '—'}</div>
                  <div style={styles.signalTitle}>Recall assists this month</div>
                  <div style={styles.signalSubtext}>times a search surfaced a forgotten detail</div>
                </div>
              </div>

              <div style={styles.leaderboardCard}>
                <h3 style={styles.leaderboardTitle}>Most reinforced this month</h3>
                <p style={styles.leaderboardSubtitle}>People you've added the most detail about recently</p>
                {leaderboard.length > 0 ? (
                  leaderboard.map((entry, i) => (
                    <button
                      key={entry.id}
                      onClick={() => onSelectPerson({ id: entry.id, name: entry.name })}
                      style={styles.leaderboardRow}
                    >
                      <span style={styles.leaderboardRank}>{i + 1}</span>
                      <span style={styles.leaderboardAvatar}>{initials(entry.name)}</span>
                      <span style={styles.leaderboardName}>{entry.name}</span>
                      <span style={styles.leaderboardCount}>{entry.count} update{entry.count === 1 ? '' : 's'}</span>
                    </button>
                  ))
                ) : (
                  <p style={styles.leaderboardEmpty}>No updates yet this month — add a detail to someone's profile to start building this list.</p>
                )}
                <button onClick={onSelectNudges} style={styles.leaderboardFooter}>
                  See who's due for an update →
                </button>
              </div>

              {connectionSuggestions.length > 0 && (
                <div style={styles.leaderboardCard}>
                  <h3 style={styles.leaderboardTitle}>Connections to make</h3>
                  <p style={styles.leaderboardSubtitle}>Things that look true from your own data, but were never written down</p>
                  {connectionSuggestions.map((s) => (
                    <div key={suggestionKey(s)} style={styles.connectionRow}>
                      <span style={styles.connectionText}>
                        {s.kind === 'person_group' && (
                          <>
                            Add{' '}
                            <button onClick={() => onSelectPerson(s.person)} style={styles.connectionLink}>
                              {s.person.name}
                              {s.person.last_name ? ` ${s.person.last_name}` : ''}
                            </button>{' '}
                            to{' '}
                            <button onClick={() => onSelectGroup(s.group)} style={styles.connectionLink}>
                              {groupLabel(s.group.id, s.group.name)}
                            </button>
                            ?
                          </>
                        )}
                        {s.kind === 'family_coparent' && (
                          <>
                            Is{' '}
                            <button
                              onClick={() => onSelectPerson({ id: s.parentId, name: s.parentName })}
                              style={styles.connectionLink}
                            >
                              {s.parentName}
                            </button>{' '}
                            also a parent of{' '}
                            <button
                              onClick={() => onSelectPerson({ id: s.childId, name: s.childName })}
                              style={styles.connectionLink}
                            >
                              {s.childName}
                            </button>
                            ?
                          </>
                        )}
                        {s.kind === 'family_couple' && (
                          <>
                            Are{' '}
                            <button
                              onClick={() => onSelectPerson({ id: s.aId, name: s.aName })}
                              style={styles.connectionLink}
                            >
                              {s.aName}
                            </button>{' '}
                            and{' '}
                            <button
                              onClick={() => onSelectPerson({ id: s.bId, name: s.bName })}
                              style={styles.connectionLink}
                            >
                              {s.bName}
                            </button>{' '}
                            married? They share a child ({s.childName}).
                          </>
                        )}
                        {s.kind === 'event_group' && (
                          <>
                            Tag{' '}
                            <button
                              onClick={() => onSelectEvent({ id: s.momentId, summary: s.momentTitle })}
                              style={styles.connectionLink}
                            >
                              {s.momentTitle}
                            </button>{' '}
                            as{' '}
                            <button
                              onClick={() => onSelectGroup({ id: s.groupId, name: s.groupName })}
                              style={styles.connectionLink}
                            >
                              {groupLabel(s.groupId, s.groupName)}
                            </button>
                            ? Everyone who was there is a member.
                          </>
                        )}
                      </span>
                      <div style={styles.connectionButtons}>
                        <button onClick={() => onAcceptConnection?.(s)} style={styles.connectionYesButton}>
                          Yes
                        </button>
                        <button onClick={() => onDismissConnection?.(s)} style={styles.connectionNoButton}>
                          No
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {familyTagSuggestions.length > 0 && (
                <div style={styles.leaderboardCard}>
                  <h3 style={styles.leaderboardTitle}>Family groups</h3>
                  <p style={styles.leaderboardSubtitle}>Groups whose name looks like a family — tag them as Family?</p>
                  {familyTagSuggestions.map((s) => (
                    <div key={s.id} style={styles.connectionRow}>
                      <span style={styles.connectionText}>
                        Tag{' '}
                        <button onClick={() => onSelectGroup({ id: s.id, name: s.name })} style={styles.connectionLink}>
                          {groupLabel(s.id, s.name)}
                        </button>{' '}
                        as Family?
                      </span>
                      <div style={styles.connectionButtons}>
                        <button onClick={() => onAcceptFamilyTag?.(s)} style={styles.connectionYesButton}>
                          Yes
                        </button>
                        <button onClick={() => onDismissFamilyTag?.(s)} style={styles.connectionNoButton}>
                          No
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {suggestionActionError && <p style={styles.suggestionActionError}>{suggestionActionError}</p>}
            </div>
          )}

          {devTools}

          <p style={styles.emptyState}>Ask about anyone or any moment, or just tell me what's on your mind.</p>
          {suggestionsLoading && (
            <div style={styles.suggestionsLoadingRow}>
              <span style={styles.spinner} />
              Finding a few things to ask about — give it a second before tapping away…
            </div>
          )}
          {!suggestionsLoading && suggestions.length > 0 && (
            <div style={styles.suggestionList}>
              <span style={styles.suggestionsHeadingRow}>
                <span style={styles.suggestionsHeading}>A few ideas</span>
                <RefreshButton label="Refresh suggestions" refreshing={suggestionsLoading} onClick={onRefreshSuggestions} />
              </span>
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => onSuggestionClick(s)} style={styles.suggestionCard}>
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
                  <GroupChip key={g.id} label={groupLabel(g.id, g.name)} onClick={() => onSelectGroup(g)} />
                ))}
              </div>
            )}
          </div>
        ))}
        {sending && <div style={styles.assistantBubble}>…</div>}
        <div ref={bottomRef} />
      </div>

      <RelationshipSuggestionBanners
        relationshipSuggestions={relationshipSuggestions}
        setRelationshipSuggestions={setRelationshipSuggestions}
        newPersonSuggestions={newPersonSuggestions}
        setNewPersonSuggestions={setNewPersonSuggestions}
      />

      <MentionedPeopleSuggestionBanners
        suggestions={mentionedPeopleSuggestions}
        setSuggestions={setMentionedPeopleSuggestions}
      />

      <div style={styles.stickyBarWrapper}>
        <div style={styles.stickyBarInner}>
          <div style={styles.inputRow}>
            <AutoGrowTextarea
              value={input}
              onChange={onInputChange}
              onEnter={onSend}
              placeholder="Ask, share, or add a detail…"
              style={styles.input}
              disabled={sending}
            />
            {!readOnly && (
              <VoiceInputButton
                disabled={sending}
                onTranscribed={(text) => onInputChange(input ? `${input} ${text}` : text)}
              />
            )}
            <button onClick={onSend} disabled={sending} style={styles.button}>
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '2rem 1.5rem 6rem', fontFamily, display: 'flex', flexDirection: 'column', minHeight: '75vh' },
  heading: { fontSize: fontSize.h1, color: colors.ink, marginBottom: space.md, textAlign: 'center' },
  emptyState: { color: colors.textSubtle, textAlign: 'center', marginTop: space.xl },
  importNudge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    fontSize: fontSize.bodyLg,
    padding: '0.85rem 1rem',
    borderRadius: radius.lg,
    border: border.inkPale,
    backgroundColor: colors.inkWash,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
    marginTop: space.xxl,
  },
  importNudgeSecondary: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    fontSize: fontSize.label,
    padding: '0.6rem 1rem',
    borderRadius: radius.lg,
    border: '1px solid #E5E5E5',
    backgroundColor: 'transparent',
    color: colors.textFaintest,
    cursor: 'pointer',
    fontFamily,
    marginTop: space.md,
  },
  statsRow: { display: 'flex', gap: space.lg, marginTop: space.xxl },
  statTile: {
    flex: 1,
    textAlign: 'center',
    backgroundColor: colors.inkWash,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.75rem 0.5rem',
    fontFamily,
  },
  statNumber: { fontSize: fontSize.h2, color: colors.ink, fontWeight: 'bold', lineHeight: 1.2 },
  statLabel: { fontSize: fontSize.small, color: colors.textMuted, marginTop: '0.15rem' },
  signalsSection: { marginTop: space.xxl, display: 'flex', flexDirection: 'column', gap: space.lg },
  signalCardsRow: { display: 'flex', gap: space.lg },
  signalCard: {
    flex: 1,
    textAlign: 'left',
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    cursor: 'pointer',
    fontFamily,
  },
  signalNumber: { fontSize: '1.4rem', color: colors.ink, fontWeight: 'bold', lineHeight: 1.2 },
  signalTitle: { fontSize: fontSize.body, color: neutral.grey900, marginTop: '0.3rem', lineHeight: 1.3 },
  signalSubtext: { fontSize: '0.78rem', color: colors.textFaint, marginTop: space.xxs, lineHeight: 1.3 },
  leaderboardCard: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '1rem 1.1rem',
  },
  leaderboardTitle: { fontSize: fontSize.base, color: colors.ink, margin: 0 },
  leaderboardSubtitle: { fontSize: '0.82rem', color: colors.textFaint, margin: '0.2rem 0 0.85rem' },
  leaderboardRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.7rem',
    width: '100%',
    padding: '0.4rem 0',
    background: 'none',
    border: 'none',
    borderTop: '1px solid #F0EEE8',
    cursor: 'pointer',
    fontFamily,
    textAlign: 'left',
  },
  leaderboardRank: { fontSize: fontSize.label, color: neutral.grey400, width: '1rem', flexShrink: 0 },
  leaderboardAvatar: {
    flexShrink: 0,
    width: '2rem',
    height: '2rem',
    borderRadius: radius.circle,
    backgroundColor: colors.inkWash,
    border: border.inkPale,
    color: colors.ink,
    fontSize: fontSize.tiny,
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardName: { flex: 1, fontSize: fontSize.bodyLg, color: colors.textStrong },
  leaderboardCount: { fontSize: fontSize.small, color: colors.textSubtle },
  leaderboardEmpty: { fontSize: '0.88rem', color: colors.textFaint, lineHeight: 1.4, margin: '0.3rem 0 0.6rem' },
  leaderboardFooter: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    marginTop: space.lg,
    paddingTop: space.lg,
    background: 'none',
    border: 'none',
    borderTop: '1px solid #F0EEE8',
    color: colors.ink,
    fontSize: fontSize.body,
    fontFamily,
    cursor: 'pointer',
  },
  connectionRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.lg,
    flexWrap: 'wrap',
    padding: '0.5rem 0',
    borderTop: '1px solid #F0EEE8',
  },
  connectionText: { fontSize: fontSize.body, color: neutral.grey900, lineHeight: 1.5 },
  connectionLink: {
    background: 'none',
    border: 'none',
    padding: 0,
    color: colors.ink,
    fontWeight: 'bold',
    fontSize: 'inherit',
    fontFamily,
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  connectionButtons: { display: 'flex', gap: space.md, flexShrink: 0 },
  suggestionActionError: { fontSize: fontSize.body, color: neutral.redDeep, marginTop: space.md },
  connectionYesButton: {
    fontSize: fontSize.label,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
    fontFamily,
  },
  connectionNoButton: {
    fontSize: fontSize.label,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.sm,
    border: border.suggestFill,
    backgroundColor: 'transparent',
    color: colors.suggest,
    cursor: 'pointer',
    fontFamily,
  },
  suggestionsLoadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    marginTop: space.xxl,
    padding: '0.85rem 1rem',
    borderRadius: radius.lg,
    border: '1px solid #E5E3DE',
    color: colors.textSubtle,
    fontSize: fontSize.bodyLg,
    lineHeight: 1.4,
  },
  spinner: {
    flexShrink: 0,
    width: '16px',
    height: '16px',
    borderRadius: radius.circle,
    border: '2px solid #CFE0D6',
    borderTopColor: colors.ink,
    animation: 'spin 0.8s linear infinite',
  },
  suggestionList: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: space.xxl },
  suggestionsHeadingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  suggestionsHeading: { fontSize: fontSize.label, color: colors.textFaint, textTransform: 'uppercase', letterSpacing: '0.03em' },
  suggestionCard: {
    fontFamily,
    fontSize: fontSize.base,
    textAlign: 'left',
    padding: '0.85rem 1rem',
    borderRadius: radius.lg,
    border: border.inkPale,
    backgroundColor: colors.inkWash,
    color: colors.ink,
    cursor: 'pointer',
    lineHeight: 1.4,
  },
  thread: { flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem', overflowY: 'auto', paddingBottom: space.xl },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: colors.primary,
    color: colors.surface,
    padding: '0.65rem 1rem',
    borderRadius: radius.xl,
    maxWidth: '80%',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    color: colors.textStrong,
    padding: '0.65rem 1rem',
    borderRadius: radius.xl,
    maxWidth: '80%',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
  },
  peopleRow: { display: 'flex', gap: space.md, marginTop: '0.4rem', flexWrap: 'wrap' },
  personChip: {
    fontSize: fontSize.body,
    padding: '0.35rem 0.8rem',
    borderRadius: radius.pill,
    border: border.primary,
    backgroundColor: 'transparent',
    color: colors.ink,
    cursor: 'pointer',
  },
  stickyBarWrapper: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.appBg,
    borderTop: '1px solid #E2DFD6',
    boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
    padding: '0.6rem 0',
    zIndex: 20,
  },
  stickyBarInner: { maxWidth: maxWidth.page, margin: '0 auto', padding: '0 1.5rem' },
  inputRow: { display: 'flex', alignItems: 'flex-end', gap: space.lg },
  input: { flex: 1, fontSize: fontSize.lead, padding: '0.65rem', borderRadius: radius.md, border: border.default },
  button: {
    fontSize: fontSize.lead,
    padding: '0.65rem 1.25rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.surface,
    cursor: 'pointer',
  },
}
