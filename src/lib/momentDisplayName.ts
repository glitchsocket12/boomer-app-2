import { formatFullDate } from './dates'
import { qualifiedName } from './qualifiedName'
import { summarize } from './summarize'

// The events-side twin of groupDisplayName.ts. A sub-event's own title is usually meaningless on
// its own ("Day 2", "Hot Springs") — it only identifies anything next to the event it sits under —
// so anywhere an event is *picked* from a list it's labelled with its parent chain, exactly the way
// subgroups already are. Founder, 2026-08-16: "we need to match formatting for all sub
// groups/events so I can correctly ID which event I am selecting".
export type MomentRef = {
  id: string
  occasion?: string | null
  raw_description?: string | null
  parent_moment_id?: string | null
}

/** An event's own unqualified title — what every list showed before this file existed. */
export function momentTitle(moment: MomentRef): string {
  return summarize(moment.occasion, moment.raw_description ?? '')
}

/**
 * "Steamboat Trip / Strawberry Park Hot Springs". Build `titleById` from momentTitle over whatever
 * list is on screen; `parentById` comes from fetchMomentParentIds (lib/moments.ts).
 *
 * Parentage is read from the map first because the pages building these labels fetch
 * `parent_moment_id` in an isolated, fail-open query — their main moments select usually doesn't
 * carry the column at all, so the row itself can't be trusted to know it's a sub-event.
 */
export function momentDisplayName(
  moment: MomentRef,
  titleById: ReadonlyMap<string, string>,
  parentById: ReadonlyMap<string, string | null>
): string {
  const parentId = parentById.get(moment.id) ?? moment.parent_moment_id ?? null
  return qualifiedName(moment.id, momentTitle(moment), parentId, titleById, parentById)
}

/**
 * The dropdown-row label: qualified name plus the event's date, e.g.
 * "Steamboat Trip / Strawberry Park Hot Springs — June 12, 2026".
 *
 * The date is what separates the *other* ambiguous case the parent chain can't touch — two
 * top-level events with the same name, which is what a repeating calendar entry produces. Only a
 * real `event_date` is ever shown: formatFullDate falls back to `created_at`, and the day a row was
 * imported is not the day the event happened, so a dateless event gets no date rather than a wrong
 * one.
 */
export function momentPickerLabel(
  moment: MomentRef & { event_date?: string | null; event_end_date?: string | null; created_at?: string },
  titleById: ReadonlyMap<string, string>,
  parentById: ReadonlyMap<string, string | null>
): string {
  const name = momentDisplayName(moment, titleById, parentById)
  if (!moment.event_date) return name
  return `${name} — ${formatFullDate({
    event_date: moment.event_date,
    event_end_date: moment.event_end_date ?? null,
    created_at: moment.created_at ?? '',
  })}`
}
