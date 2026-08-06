// "How is this person related to …?" — pick a second person and get the relationship named, with
// the chain that justifies it. The family tree could always DRAW two people three branches apart;
// this is what lets it say "first cousin once removed" out loud.
//
// No queries: the graph and the roster are both already in memory by the time a tile can be tapped,
// so the answer is computed synchronously as soon as a name is picked.
//
// Rendered as a sibling of the tree's ChoiceSheet, deliberately OUTSIDE the horizontally scrolling
// canvas — inside it, a drag across this sheet would scroll the tree underneath and trip the tile
// tap guard at the same time.

import { useEffect, useMemo, useRef, useState } from 'react'
import { calculateRelationship, describeKinPath, genderAlternatives, type KinGraph } from '../lib/relationshipCalculator'
import ClarifyGenderPrompt from './ClarifyGenderPrompt'
import SearchBox from './SearchBox'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow, space } from '../lib/theme'

const MAX_RESULTS = 8

export default function RelationshipCompare({
  graph,
  from,
  people,
  selfId = null,
  onClose,
  onSelectPerson,
  onSetGender,
  savingGenderId = null,
}: {
  graph: KinGraph
  from: { id: string; name: string }
  people: { id: string; label: string }[]
  /** When the person being compared FROM is the account holder, the answer reads "your …". */
  selfId?: string | null
  onClose: () => void
  onSelectPerson?: (id: string, name: string) => void
  // Absent in read-only surfaces (the demo) — without it the answer just keeps its vaguer wording
  // rather than offering a button that can't save.
  onSetGender?: (personId: string, gender: 'male' | 'female') => void
  savingGenderId?: string | null
}) {
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<{ id: string; label: string } | null>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const inputRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    inputRef.current?.querySelector('input')?.focus()
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people.filter((p) => p.id !== from.id && p.label.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
  }, [query, people, from.id])

  const kinship = target ? calculateRelationship(graph, from.id, target.id) : null
  const path = kinship ? describeKinPath(graph, kinship) : ''
  const subject = from.id === selfId ? 'you' : from.name

  // The answer above is only as precise as the data behind it. When it landed on a genderless word
  // purely because this person's gender isn't on file, the moment they've just READ the vaguer
  // answer is the moment they most want to correct it — so ask right here rather than sending them
  // off to a profile to find a dropdown.
  const [genderAnswered, setGenderAnswered] = useState(false)
  const genderAlt =
    onSetGender && target && !genderAnswered ? genderAlternatives(graph, from.id, target.id) : null

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`How is ${from.name} related to someone?`}>
        <div style={styles.headerRow}>
          <div>
            <h2 style={styles.title}>How is {from.name} related to…?</h2>
            <p style={styles.subtitle}>Pick anyone on file and I'll work out the connection.</p>
          </div>
          <button type="button" onClick={onClose} style={styles.closeButton} aria-label="Close">
            ×
          </button>
        </div>

        {!target && (
          <div ref={inputRef} style={styles.searchWrap}>
            <SearchBox value={query} onChange={setQuery} placeholder="Search for a person" />
            {matches.length > 0 && (
              <div style={styles.results}>
                {matches.map((p) => (
                  <button key={p.id} type="button" style={styles.result} onClick={() => setTarget(p)}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            {query.trim() !== '' && matches.length === 0 && <p style={styles.empty}>Nobody on file by that name.</p>}
          </div>
        )}

        {target && kinship && (
          <div style={styles.answer}>
            {kinship.kind === 'unrelated' ? (
              <p style={styles.headline}>
                No connection on record between {from.name} and {target.label}.
              </p>
            ) : (
              <p style={styles.headline}>
                {target.label} is {subject === 'you' ? 'your' : `${subject}'s`} <strong>{kinship.label}</strong>.
              </p>
            )}
            {path && <p style={styles.path}>{path}</p>}
            {kinship.inferredFromSiblingRow && (
              <p style={styles.caveat}>Worked out from a recorded sibling link — no shared parent is on file.</p>
            )}
            {genderAlt && target && onSetGender && (
              <div style={styles.clarify}>
                <ClarifyGenderPrompt
                  question={{
                    personId: target.id,
                    personName: target.label,
                    possessive: subject === 'you' ? 'your' : `${subject}'s`,
                    male: genderAlt.male,
                    female: genderAlt.female,
                  }}
                  onAnswer={(id, gender) => {
                    setGenderAnswered(true)
                    onSetGender(id, gender)
                  }}
                  onSkip={() => setGenderAnswered(true)}
                  saving={savingGenderId === target.id}
                />
              </div>
            )}
            <div style={styles.actions}>
              <button
                type="button"
                style={styles.action}
                onClick={() => {
                  setTarget(null)
                  setQuery('')
                  setGenderAnswered(false)
                }}
              >
                Compare someone else
              </button>
              {onSelectPerson && (
                <button type="button" style={styles.action} onClick={() => onSelectPerson(target.id, target.label)}>
                  Open {target.label}'s profile
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    boxSizing: 'border-box',
    zIndex: 1000,
  },
  sheet: {
    width: '100%',
    maxWidth: maxWidth.dialog,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    boxShadow: shadow.modal,
    padding: space.xl,
    boxSizing: 'border-box',
    fontFamily,
  },
  headerRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.lg },
  title: { fontSize: fontSize.h3, color: colors.ink, margin: 0 },
  subtitle: { fontSize: fontSize.body, color: colors.textMuted, margin: `${space.xxs} 0 0` },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: fontSize.h2,
    lineHeight: 1,
    color: colors.textMuted,
    cursor: 'pointer',
    padding: '0.25rem 0.4rem',
  },
  searchWrap: { paddingTop: space.xl },
  results: { display: 'flex', flexDirection: 'column', gap: space.xs, marginTop: `-${space.xxl}` },
  result: {
    width: '100%',
    minHeight: '44px',
    padding: '0.6rem 0.9rem',
    backgroundColor: 'transparent',
    color: colors.ink,
    border: border.default,
    borderRadius: radius.md,
    fontSize: fontSize.base,
    fontFamily,
    textAlign: 'left',
    cursor: 'pointer',
  },
  empty: { fontSize: fontSize.body, color: colors.textMuted, margin: `-${space.xxl} 0 0` },
  answer: { paddingTop: space.xl },
  headline: { fontSize: fontSize.lead, color: colors.ink, margin: 0, lineHeight: 1.5 },
  path: { fontSize: fontSize.body, color: colors.textMuted, margin: `${space.md} 0 0`, lineHeight: 1.6 },
  caveat: { fontSize: fontSize.small, color: colors.textFaintest, margin: `${space.sm} 0 0` },
  // The shared banner carries its own bottom margin (it's normally last in a stack); inside this
  // sheet it has the actions row under it, so the spacing is added above instead.
  clarify: { marginTop: space.xl },
  actions: { display: 'flex', flexDirection: 'column', gap: space.md, paddingTop: space.xl },
  action: {
    width: '100%',
    minHeight: '44px',
    padding: '0.7rem 1rem',
    backgroundColor: 'transparent',
    color: colors.ink,
    border: border.default,
    borderRadius: radius.md,
    fontSize: fontSize.base,
    fontFamily,
    textAlign: 'center',
    cursor: 'pointer',
  },
}
