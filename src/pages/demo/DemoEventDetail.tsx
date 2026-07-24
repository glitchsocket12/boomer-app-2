import { useState } from 'react'
import { EventDetailView, type MomentDetail } from '../EventDetail'
import { DEMO_MOMENTS, DEMO_PEOPLE, DEMO_GROUPS, DEMO_TAGS, DEMO_NOTES } from '../../lib/demoData'

export default function DemoEventDetail({
  eventId,
  onBack,
  backLabel,
  onSelectPerson,
  onSelectGroup,
}: {
  eventId: string
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectGroup: (group: { id: string; name: string }) => void
}) {
  const [notesOpen, setNotesOpen] = useState(false)

  const m = DEMO_MOMENTS.find((mm) => mm.id === eventId)
  if (!m) return null

  // Real notes tied to this moment (person's own words) take priority; attendees who don't have
  // one yet fall back to the same generic "Was there." placeholder the real app auto-inserts on
  // tagging (EventDetail.tsx:134) — so every attendee still shows up, but people who've actually
  // added something no longer get drowned out by a single collapsed "Was there." card.
  const tiedNotes = DEMO_NOTES.filter((note) => note.momentId === m.id)
  const notedAttendeeIds = new Set(tiedNotes.map((note) => note.personId))
  const realNotes = tiedNotes.map((note) => {
    const p = DEMO_PEOPLE.find((pp) => pp.id === note.personId)!
    return { id: note.id, content: note.content, created_at: note.created_at, people: { id: p.id, name: p.name, last_name: p.last_name }, source: note.source }
  })
  const placeholderNotes = m.attendeeIds
    .filter((id) => !notedAttendeeIds.has(id))
    .map((id) => {
      const p = DEMO_PEOPLE.find((pp) => pp.id === id)!
      return { id: `attendee-${m.id}-${id}`, content: 'Was there.', created_at: m.created_at, people: { id: p.id, name: p.name, last_name: p.last_name }, source: null }
    })

  const moment: MomentDetail = {
    id: m.id,
    occasion: m.occasion,
    location: m.location,
    when_text: m.when_text,
    raw_description: m.raw_description,
    summary: m.summary,
    details: null,
    created_at: m.created_at,
    notes: [...realNotes, ...placeholderNotes],
    moment_groups: m.groupIds.map((gid) => {
      const g = DEMO_GROUPS.find((gg) => gg.id === gid)!
      return { groups: { id: g.id, name: g.name } }
    }),
    moment_tags: m.tagIds.map((tid) => {
      const t = DEMO_TAGS.find((tt) => tt.id === tid)!
      return { tags: { id: t.id, name: t.name } }
    }),
    dismissed_person_ids: [],
  }

  return (
    <EventDetailView
      moment={moment}
      onSelectPerson={onSelectPerson}
      onSelectGroup={onSelectGroup}
      onBack={onBack}
      backLabel={backLabel}
      notesOpen={notesOpen}
      onToggleNotesOpen={() => setNotesOpen((v) => !v)}
      readOnly
    />
  )
}
