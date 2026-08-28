// "That's not right" — the panel that clears every copy of one wrong fact at once.
//
// Founder, 2026-08-26: "at some point I accidentally said something that wasn't true in the notes
// and now it won't forget that info." It won't forget because deleting the note you remember
// writing does not delete the fact. See src/lib/factRetraction.ts for the worked example (two
// separately-captured notes on one profile, plus a mirror note, plus a relationships row, plus a
// cached Key Facts chip regenerated from whatever survives).
//
// Shape of the interaction, chosen by the founder over "just delete it" and "never from chat":
// show everything that would go, pre-ticked, and let them confirm. Nothing disappears unseen, and
// an over-eager match costs one untick rather than a lost note.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { findAssertingNotes, relationshipKindsForCategory, type CandidateNote } from '../lib/factRetraction'
import { removeRelationship } from '../lib/relationshipsTable'
import { border, colors, fontFamily, fontSize, radius, space } from '../lib/theme'

type LinkedPerson = { name: string; personId?: string }

/** A note offered up for removal, with enough context to judge it without leaving the page. */
type Row = CandidateNote & { side: 'subject' | 'mirror'; ownerName: string }

export default function RetractFactPanel({
  personId,
  subjectName,
  factLabel,
  category,
  linkedPeople,
  onCancel,
  onRetracted,
}: {
  personId: string
  /** The profile being stood on, full name — matched against the other person's note text. */
  subjectName: string
  /** The chip as it reads on screen ("Dating Olivia"), quoted back so the question is concrete. */
  factLabel: string
  category: string
  linkedPeople: LinkedPerson[]
  onCancel: () => void
  /** Fired after the deletes land, so the caller can reload notes and regenerate Key Facts. */
  onRetracted: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])
  const [links, setLinks] = useState<{ otherId: string; otherName: string; label: string }[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function gather() {
      const linkedNames = linkedPeople.map((p) => p.name)
      const linkedIds = linkedPeople.map((p) => p.personId).filter((id): id is string => !!id)

      // Bounded by ONE person's own fan-out on each side, so deliberately unpaged — the same
      // reasoning PROJECT_CONTEXT §2 gives for a profile's own notes.
      const [subjectRes, mirrorRes] = await Promise.all([
        supabase.from('notes').select('id, content, person_id').eq('person_id', personId),
        linkedIds.length > 0
          ? supabase.from('notes').select('id, content, person_id').in('person_id', linkedIds)
          : Promise.resolve({ data: [] as CandidateNote[] }),
      ])

      const found = findAssertingNotes({
        subjectName,
        subjectNotes: (subjectRes.data ?? []) as CandidateNote[],
        linkedNames,
        mirrorNotes: (mirrorRes.data ?? []) as CandidateNote[],
      })

      const nameById = new Map(linkedPeople.filter((p) => p.personId).map((p) => [p.personId!, p.name]))
      const next: Row[] = [
        ...found.subject.map((n) => ({ ...n, side: 'subject' as const, ownerName: subjectName })),
        ...found.mirror.map((n) => ({
          ...n,
          side: 'mirror' as const,
          ownerName: nameById.get(n.person_id ?? '') ?? 'the other person',
        })),
      ]

      // The relationships row is the copy that survives note deletion entirely and re-injects
      // itself into Key Facts on the next regeneration — the reason "I deleted the note and it
      // came back" happens. Only discoverable when the fact's person resolved to a real profile.
      const kinds = relationshipKindsForCategory(category)
      const foundLinks: { otherId: string; otherName: string; label: string }[] = []
      if (kinds.length > 0 && linkedIds.length > 0) {
        const { data } = await supabase
          .from('relationships')
          .select('person_a_id, person_b_id, kind')
          .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`)
        for (const row of data ?? []) {
          const otherId = row.person_a_id === personId ? row.person_b_id : row.person_a_id
          if (!linkedIds.includes(otherId)) continue
          const matches = kinds.some((k) => {
            if (k === 'parent-of-subject') return row.kind === 'parent' && row.person_b_id === personId
            if (k === 'subject-is-parent') return row.kind === 'parent' && row.person_a_id === personId
            return row.kind === k
          })
          if (!matches) continue
          foundLinks.push({
            otherId,
            otherName: nameById.get(otherId) ?? 'them',
            label: row.kind === 'parent' ? (row.person_a_id === personId ? 'parent of' : 'child of') : row.kind,
          })
        }
      }

      if (cancelled) return
      setRows(next)
      setLinks(foundLinks)
      // Pre-ticked: the user already said the fact is wrong, so the default is to clear it. The
      // list is here to be overruled, not to be assembled from scratch.
      setChecked(new Set([...next.map((n) => n.id), ...foundLinks.map((l) => `link:${l.otherId}:${l.label}`)]))
      setLoading(false)
    }
    gather()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, category])

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleRemove() {
    setWorking(true)
    const noteIds = rows.filter((r) => checked.has(r.id)).map((r) => r.id)
    if (noteIds.length > 0) await supabase.from('notes').delete().in('id', noteIds)
    for (const link of links) {
      if (!checked.has(`link:${link.otherId}:${link.label}`)) continue
      if (link.label === 'parent of') await removeRelationship(personId, link.otherId, 'parent')
      else if (link.label === 'child of') await removeRelationship(link.otherId, personId, 'parent')
      else await removeRelationship(personId, link.otherId, link.label as 'spouse' | 'partner' | 'sibling')
    }
    setWorking(false)
    onRetracted()
  }

  const nothingFound = !loading && rows.length === 0 && links.length === 0
  const selectedCount = checked.size

  return (
    <div style={styles.panel}>
      <p style={styles.label}>That's not right</p>
      <p style={styles.question}>
        Clearing <span style={styles.fact}>{factLabel}</span> — here's everywhere it's written down.
        Untick anything that should stay.
      </p>

      {loading && <p style={styles.muted}>Looking for every copy…</p>}

      {nothingFound && (
        <p style={styles.muted}>
          Nothing on file says this any more — the chip is a stale cached copy. Refreshing key facts
          will clear it.
        </p>
      )}

      {rows.length > 0 && (
        <ul style={styles.list}>
          {rows.map((row) => (
            <li key={row.id} style={styles.item}>
              <label style={styles.itemLabel}>
                <input type="checkbox" checked={checked.has(row.id)} onChange={() => toggle(row.id)} />
                <span>
                  <span style={styles.noteText}>{row.content}</span>
                  <span style={styles.owner}>
                    {row.side === 'subject' ? 'on this profile' : `on ${row.ownerName}'s profile`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {links.length > 0 && (
        <ul style={styles.list}>
          {links.map((link) => {
            const key = `link:${link.otherId}:${link.label}`
            return (
              <li key={key} style={styles.item}>
                <label style={styles.itemLabel}>
                  <input type="checkbox" checked={checked.has(key)} onChange={() => toggle(key)} />
                  <span>
                    <span style={styles.noteText}>
                      The recorded link: {link.label} {link.otherName}
                    </span>
                    <span style={styles.owner}>
                      survives deleting the notes, and puts the fact back on its own
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <div style={styles.actions}>
        <button
          type="button"
          onClick={handleRemove}
          disabled={working || loading || selectedCount === 0}
          style={styles.removeButton}
        >
          {working ? '…' : nothingFound ? 'Refresh key facts' : `Remove ${selectedCount}`}
        </button>
        <button type="button" onClick={onCancel} disabled={working} style={styles.cancelButton}>
          Cancel
        </button>
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  panel: {
    backgroundColor: colors.surface,
    border: border.default,
    borderRadius: radius.md,
    padding: '0.85rem 0.9rem',
    margin: `${space.sm} 0`,
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.danger,
    margin: '0 0 0.3rem',
  },
  question: { fontSize: fontSize.body, color: colors.ink, lineHeight: 1.45, margin: '0 0 0.6rem' },
  fact: { fontWeight: 700 },
  muted: { fontSize: fontSize.label, color: colors.textMuted, margin: '0 0 0.5rem', lineHeight: 1.5 },
  list: { listStyle: 'none', margin: `0 0 ${space.sm}`, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  item: { margin: 0 },
  itemLabel: { display: 'flex', gap: space.md, alignItems: 'flex-start', cursor: 'pointer' },
  noteText: { display: 'block', fontSize: fontSize.body, color: colors.inkPlain, lineHeight: 1.4 },
  owner: { display: 'block', fontSize: fontSize.label, color: colors.textFaintest },
  actions: { display: 'flex', flexWrap: 'wrap', gap: space.sm, marginTop: '0.5rem' },
  removeButton: {
    fontSize: fontSize.body,
    padding: '0.45rem 0.95rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.danger,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  cancelButton: {
    fontSize: fontSize.body,
    padding: '0.45rem 0.95rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textBody,
    cursor: 'pointer',
    fontFamily,
  },
}
