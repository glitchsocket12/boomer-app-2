import { useState, type FormEvent } from 'react'
import SearchBox from './SearchBox'
import { border, colors, fontFamily, fontSize, neutral, radius, space } from '../lib/theme'
import type { CircleCategory, LinkOptions } from '../lib/writeRelationship'

type PersonOption = { id: string; label: string }

// One "Add family member" control for the whole family tree, replacing the row of one-"+"-per-
// relationship-type pickers it grew into (founder, 2026-08-03: "I still don't see how to add a step
// parent" — with seven labelled "+" buttons wrapping across the page, the one you wanted was
// genuinely hard to find).
//
// Order: pick the relationship first, then type the name (founder, 2026-08-04). That way the panel
// opens on the question the old "+" buttons used to answer, so the relationship you're adding is
// always visible — and picking it first is what decides whether there's a follow-up "through whom"
// question to answer before the name is even relevant.
export type RelationshipChoice = {
  key: string
  label: string
  category: CircleCategory
  opts?: LinkOptions
  // Set when the relationship only exists THROUGH a specific person rather than through the tree's
  // centered person — a grandparent is a parent OF one of your parents, a step-parent is married TO
  // one of them, a step-sibling is the child OF one of your step-parents. That second question is
  // what keeps the app from guessing (the founder's own concern about step-siblings: it has to know
  // which parent they actually descend from, or it starts mismatching people). When `through` is
  // present the relationship is written against the chosen person, not against the root.
  throughPrompt?: string
  through?: { id: string; name: string }[]
  // Shown in the dropdown when `through` is empty, so the option stays visible and explains itself
  // instead of silently disappearing — the same "where did it go?" problem in a smaller form.
  unavailableNote?: string
}

export type AddFamilyMemberRequest = {
  category: CircleCategory
  subjectId: string
  subjectName: string
  opts?: LinkOptions
  existing?: PersonOption
  newName?: string
}

export default function AddFamilyMember({
  rootId,
  rootName,
  people,
  excludeIds = [],
  choices,
  onAdd,
}: {
  rootId: string
  rootName: string
  people: PersonOption[]
  excludeIds?: string[]
  choices: RelationshipChoice[]
  onAdd: (request: AddFamilyMemberRequest) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ existing?: PersonOption; newName?: string } | null>(null)
  const [choiceKey, setChoiceKey] = useState('')
  const [throughId, setThroughId] = useState('')
  const [saving, setSaving] = useState(false)

  function close() {
    setOpen(false)
    setQuery('')
    setPicked(null)
    setChoiceKey('')
    setThroughId('')
    setSaving(false)
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={styles.openButton}>
        + Add family member
      </button>
    )
  }

  const q = query.trim().toLowerCase()
  const results = q ? people.filter((p) => !excludeIds.includes(p.id) && p.label.toLowerCase().includes(q)).slice(0, 8) : []
  const pickedName = picked?.existing?.label ?? picked?.newName ?? ''

  const choice = choices.find((c) => c.key === choiceKey)
  const throughOptions = choice?.through
  // Falls back to the first option rather than leaving it blank, so the second question always has
  // a real answer selected — an unanswered "through whom" would write the relationship nowhere.
  const resolvedThroughId =
    throughOptions && throughOptions.length > 0
      ? throughOptions.some((t) => t.id === throughId)
        ? throughId
        : throughOptions[0].id
      : ''
  const through = throughOptions?.find((t) => t.id === resolvedThroughId)
  const ready = Boolean(choice && picked && (!throughOptions || through))

  // Enter on the name box commits the same way clicking a result does — an exact (case-insensitive)
  // match picks that person, anything else is treated as a new name, matching RelationshipAddPicker.
  function handleNameSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    const exact = results.find((p) => p.label.toLowerCase() === trimmed.toLowerCase())
    setPicked(exact ? { existing: exact } : { newName: trimmed })
  }

  async function handleAdd() {
    if (!ready || !choice || !picked) return
    setSaving(true)
    await onAdd({
      category: choice.category,
      subjectId: through ? through.id : rootId,
      subjectName: through ? through.name : rootName,
      opts: choice.opts,
      existing: picked.existing,
      newName: picked.newName,
    })
    close()
  }

  return (
    <div style={styles.panel}>
      <label style={styles.field}>
        <span style={styles.fieldLabel}>What would you like to add to {rootName}'s family?</span>
        <select
          value={choiceKey}
          onChange={(e) => {
            setChoiceKey(e.target.value)
            setThroughId('')
            // The name only means anything in the context of the relationship it was typed under, so
            // changing the relationship starts the name over rather than carrying a stale pick along.
            setPicked(null)
            setQuery('')
          }}
          style={styles.select}
          disabled={saving}
        >
          <option value="">Choose a relationship…</option>
          {choices.map((c) => {
            const unavailable = Boolean(c.through && c.through.length === 0)
            return (
              <option key={c.key} value={c.key} disabled={unavailable}>
                {unavailable && c.unavailableNote ? `${c.label} — ${c.unavailableNote}` : c.label}
              </option>
            )
          })}
        </select>
      </label>

      {choice && throughOptions && throughOptions.length > 0 && (
        <label style={styles.field}>
          <span style={styles.fieldLabel}>{choice.throughPrompt}</span>
          {throughOptions.length === 1 ? (
            <span style={styles.staticAnswer}>{throughOptions[0].name}</span>
          ) : (
            <select
              value={resolvedThroughId}
              onChange={(e) => {
                setThroughId(e.target.value)
              }}
              style={styles.select}
              disabled={saving}
            >
              {throughOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </label>
      )}

      {/* The name box only appears once there's a relationship to attach it to — asking for a name
          with nothing selected is the ordering the founder asked to reverse. */}
      {choice &&
        (!picked ? (
          <form onSubmit={handleNameSubmit} style={styles.step}>
            <span style={styles.prompt}>Who is {rootName}'s {choice.label.toLowerCase()}?</span>
            <SearchBox value={query} onChange={setQuery} placeholder="Search or type a name…" />
            {q && (
              <div style={styles.options}>
                {results.map((p) => (
                  <button key={p.id} type="button" style={styles.option} onClick={() => setPicked({ existing: p })}>
                    {p.label}
                  </button>
                ))}
                <button type="button" style={styles.createOption} onClick={() => setPicked({ newName: query.trim() })}>
                  + Add "{query.trim()}" as a new person
                </button>
              </div>
            )}
          </form>
        ) : (
          <span style={styles.prompt}>
            {pickedName}
            {picked.newName ? ' (new person)' : ''}
            <button type="button" onClick={() => setPicked(null)} style={styles.changeLink} disabled={saving}>
              change
            </button>
          </span>
        ))}

      {picked ? (
        <div style={styles.buttonRow}>
          <button type="button" onClick={handleAdd} disabled={!ready || saving} style={ready && !saving ? styles.addButton : styles.addButtonDisabled}>
            {saving ? 'Adding…' : 'Add'}
          </button>
          <button type="button" onClick={close} style={styles.cancel} disabled={saving}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={close} style={styles.cancel}>
          Cancel
        </button>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  openButton: {
    fontSize: fontSize.label,
    fontFamily,
    padding: '0.45rem 0.9rem',
    borderRadius: radius.pill,
    border: `1px dashed ${neutral.grey300}`,
    backgroundColor: 'transparent',
    color: colors.textBody,
    cursor: 'pointer',
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    border: `1px solid ${neutral.grey200}`,
    borderRadius: radius.md,
    padding: space.lg,
    backgroundColor: neutral.warm50,
    maxWidth: '340px',
  },
  step: { display: 'flex', flexDirection: 'column', gap: space.sm },
  prompt: { fontSize: fontSize.label, color: colors.ink, display: 'flex', alignItems: 'baseline', gap: space.sm },
  changeLink: {
    background: 'none',
    border: 'none',
    color: colors.textFaintest,
    textDecoration: 'underline',
    fontSize: fontSize.tiny,
    fontFamily,
    cursor: 'pointer',
    padding: 0,
  },
  field: { display: 'flex', flexDirection: 'column', gap: '0.25rem' },
  fieldLabel: { fontSize: fontSize.small, color: colors.textFaintest },
  select: {
    fontSize: fontSize.label,
    fontFamily,
    padding: '0.45rem 0.5rem',
    borderRadius: radius.sm,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  staticAnswer: { fontSize: fontSize.label, color: colors.ink, padding: '0.45rem 0' },
  options: { display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '200px', overflowY: 'auto' },
  option: {
    textAlign: 'left',
    background: colors.surface,
    border: border.default,
    borderRadius: radius.sm,
    padding: '0.35rem 0.55rem',
    cursor: 'pointer',
    fontSize: fontSize.label,
    color: colors.ink,
    fontFamily,
  },
  createOption: {
    textAlign: 'left',
    background: 'none',
    border: `1px dashed ${colors.suggestFill}`,
    borderRadius: radius.sm,
    padding: '0.35rem 0.55rem',
    cursor: 'pointer',
    fontSize: fontSize.label,
    color: colors.suggest,
    fontFamily,
  },
  buttonRow: { display: 'flex', gap: space.md, alignItems: 'center', marginTop: '0.2rem' },
  addButton: {
    fontSize: fontSize.label,
    fontFamily,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
  },
  addButtonDisabled: {
    fontSize: fontSize.label,
    fontFamily,
    padding: '0.4rem 0.85rem',
    borderRadius: radius.sm,
    border: 'none',
    backgroundColor: neutral.grey200,
    color: colors.textFaintest,
    cursor: 'default',
  },
  cancel: {
    fontSize: fontSize.tiny,
    color: colors.textFaintest,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'right',
    fontFamily,
  },
}
