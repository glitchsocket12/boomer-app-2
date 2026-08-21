import { useEffect, useState } from 'react'
import {
  deletePet,
  formatPetDates,
  isMemorial,
  loadEventsForPet,
  loadPet,
  loadPetOwners,
  petEmoji,
  updatePet,
  type Pet,
  type PetEventRef,
  type PetOwner,
} from '../lib/pets'
import { LabeledValueEditor } from '../components/ContactInfoSection'
import { EventChip, PersonChip } from '../components/Chips'
import { summarize } from '../lib/summarize'
import AutoGrowTextarea from '../components/AutoGrowTextarea'
import EditButton from '../components/EditButton'
import { border, colors, fontFamily, fontSize, maxWidth, radius, shadow } from '../lib/theme'

// A pet's own page (2026-08-01, item 73 follow-up). Founder's call: pets show up in the People list
// with a species emoji, and tapping one lands here rather than on an owner's profile — so a pet is
// a record you can navigate TO, the same as a group or an event.
//
// All pet editing lives here, not on PersonDetail's Pets card. That mirrors how groups and events
// already work (chips on a profile, editing on the detail page) and means there's exactly one pet
// edit form to maintain rather than two that can drift apart.
export default function PetDetail({
  petId,
  petName,
  onBack,
  backLabel,
  onSelectPerson,
  onSelectEvent,
  onRenamed,
  onDeleted,
}: {
  petId: string
  petName: string
  onBack: () => void
  backLabel: string
  onSelectPerson: (person: { id: string; name: string }) => void
  onSelectEvent: (event: { id: string; summary: string }) => void
  onRenamed: (name: string) => void
  onDeleted: () => void
}) {
  const [pet, setPet] = useState<Pet | null>(null)
  const [owners, setOwners] = useState<PetOwner[]>([])
  // The reverse of EventDetail's pet chips (2026-08-20). Empty both when this pet went to nothing
  // and when moment_pets isn't migrated yet — the section just doesn't render either way, which is
  // the right degradation for a read-only list with no control on it.
  const [events, setEvents] = useState<PetEventRef[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Pet | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)

  useEffect(() => {
    load()
  }, [petId])

  async function load() {
    setLoading(true)
    const [loadedPet, loadedOwners, loadedEvents] = await Promise.all([
      loadPet(petId),
      loadPetOwners(petId),
      loadEventsForPet(petId),
    ])
    setPet(loadedPet)
    setOwners(loadedOwners)
    setEvents(loadedEvents.events)
    setLoading(false)
  }

  function startEditing() {
    if (!pet) return
    setDraft({ ...pet, attributes: [...pet.attributes] })
    setEditing(true)
  }

  async function handleSave() {
    if (!draft || !pet) return
    setSaving(true)
    const name = draft.name.trim() || pet.name
    await updatePet(pet.id, {
      name,
      species: draft.species?.trim() || null,
      breed: draft.breed?.trim() || null,
      birth_date: draft.birth_date || null,
      adopted_date: draft.adopted_date || null,
      deceased_date: draft.deceased_date || null,
      notes: draft.notes?.trim() || null,
      attributes: draft.attributes,
    })
    setSaving(false)
    setEditing(false)
    // Keep the breadcrumb and "← Back to …" in step with a rename, same as the other detail pages.
    if (name !== pet.name) onRenamed(name)
    await load()
  }

  async function handleDelete() {
    await deletePet(petId)
    onDeleted()
  }

  if (loading) return <p style={styles.loading}>Loading…</p>

  if (!pet) {
    return (
      <div style={styles.page}>
        <button onClick={onBack} style={styles.backButton}>
          ← Back to {backLabel}
        </button>
        <p style={styles.empty}>This pet isn't on file anymore.</p>
      </div>
    )
  }

  const dates = formatPetDates(pet)
  const kind = [pet.breed, pet.species].filter(Boolean).join(' · ')

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>
        ← Back to {backLabel}
      </button>

      <div style={styles.headingRow}>
        <h1 style={isMemorial(pet) ? { ...styles.heading, ...styles.memorialHeading } : styles.heading}>
          <span style={styles.emoji}>{petEmoji(pet)}</span> {petName}
        </h1>
        {!editing && <EditButton label="Edit pet" onClick={startEditing} />}
      </div>

      {!editing && (
        <>
          {kind && <p style={styles.kindLine}>{kind}</p>}
          {isMemorial(pet) && <p style={styles.memorialLine}>In memory{dates ? ` · ${dates}` : ''}</p>}
          {!isMemorial(pet) && dates && <p style={styles.datesLine}>{dates}</p>}

          {pet.attributes.length > 0 && (
            <div style={styles.card}>
              {pet.attributes.map((a, i) => (
                <p key={i} style={styles.detailLine}>
                  <span style={styles.detailLabel}>{a.label}:</span> {a.value}
                </p>
              ))}
            </div>
          )}

          {pet.notes && (
            <div style={styles.card}>
              <p style={styles.notesText}>{pet.notes}</p>
            </div>
          )}

          <h2 style={styles.subheading}>Belongs to</h2>
          {owners.length > 0 ? (
            <div style={styles.chipRow}>
              {owners.map((o) => (
                <PersonChip key={o.id} label={o.name} onClick={() => onSelectPerson({ id: o.id, name: o.name })} />
              ))}
            </div>
          ) : (
            <p style={styles.empty}>
              Not on anyone's profile right now — open a person and add {pet.name} from their Pets section.
            </p>
          )}

          {/* Hidden entirely when empty, unlike "Belongs to" above — an owner-less pet is a state
              worth explaining, but "hasn't been tagged to anything yet" isn't, and the tagging is
              done over on the event anyway. */}
          {events.length > 0 && (
            <>
              <h2 style={styles.subheading}>Was at these events</h2>
              <div style={styles.chipRow}>
                {events.map((e) => {
                  const label = summarize(e.occasion, e.raw_description)
                  return <EventChip key={e.id} label={label} onClick={() => onSelectEvent({ id: e.id, summary: label })} />
                })}
              </div>
            </>
          )}

          <h2 style={styles.subheading}>Pet</h2>
          {!deleteConfirming ? (
            <button type="button" onClick={() => setDeleteConfirming(true)} style={styles.dangerLink}>
              Delete {pet.name}
            </button>
          ) : (
            <div style={styles.confirmBox}>
              <p style={styles.confirmText}>
                Delete {pet.name} everywhere? This removes them from every profile they're on. To take them off just
                one person's profile instead, use "Remove from this profile" there.
              </p>
              <div style={styles.buttonRow}>
                <button type="button" onClick={handleDelete} style={styles.deleteButton}>
                  Yes, delete
                </button>
                <button type="button" onClick={() => setDeleteConfirming(false)} style={styles.cancelButton}>
                  Keep {pet.name}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {editing && draft && (
        <div style={styles.editForm}>
          <label style={styles.fieldLabel}>Name</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            style={styles.input}
          />
          <label style={styles.fieldLabel}>Kind of animal</label>
          <input
            type="text"
            value={draft.species ?? ''}
            onChange={(e) => setDraft({ ...draft, species: e.target.value })}
            placeholder="Dog, cat, horse, parrot…"
            style={styles.input}
          />
          <label style={styles.fieldLabel}>Breed</label>
          <input
            type="text"
            value={draft.breed ?? ''}
            onChange={(e) => setDraft({ ...draft, breed: e.target.value })}
            placeholder="Optional"
            style={styles.input}
          />
          <label style={styles.fieldLabel}>Birthday</label>
          <input
            type="date"
            value={draft.birth_date ?? ''}
            onChange={(e) => setDraft({ ...draft, birth_date: e.target.value || null })}
            style={styles.input}
          />
          <label style={styles.fieldLabel}>Adopted</label>
          <input
            type="date"
            value={draft.adopted_date ?? ''}
            onChange={(e) => setDraft({ ...draft, adopted_date: e.target.value || null })}
            style={styles.input}
          />
          <label style={styles.fieldLabel}>Passed away</label>
          <input
            type="date"
            value={draft.deceased_date ?? ''}
            onChange={(e) => setDraft({ ...draft, deceased_date: e.target.value || null })}
            style={styles.input}
          />

          <LabeledValueEditor
            label="Details"
            items={draft.attributes}
            onChange={(attributes) => setDraft({ ...draft, attributes })}
            labelPlaceholder="Label (Vet, Barn…)"
            valuePlaceholder="Anything worth remembering"
          />

          <label style={styles.fieldLabel}>Notes</label>
          <AutoGrowTextarea
            value={draft.notes ?? ''}
            onChange={(v) => setDraft({ ...draft, notes: v })}
            placeholder="Anything else about this pet…"
            style={styles.textarea}
          />

          <div style={styles.buttonRow}>
            <button type="button" onClick={handleSave} disabled={saving} style={styles.saveButton}>
              {saving ? '…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} style={styles.cancelButton}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: maxWidth.page, margin: '0 auto', padding: '2rem 1.5rem', fontFamily },
  loading: { textAlign: 'center', marginTop: '3rem', fontFamily },
  backButton: {
    background: 'none',
    border: 'none',
    color: colors.textMuted,
    fontSize: fontSize.body,
    fontFamily,
    cursor: 'pointer',
    padding: 0,
    marginBottom: '1rem',
  },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' },
  heading: { fontSize: fontSize.h1, color: colors.ink, margin: 0 },
  memorialHeading: { color: colors.textMuted },
  emoji: { fontStyle: 'normal' },
  kindLine: { fontSize: fontSize.lead, color: colors.textBody, margin: '0.35rem 0 0' },
  datesLine: { fontSize: fontSize.body, color: colors.textMuted, margin: '0.35rem 0 0' },
  memorialLine: { fontSize: fontSize.body, color: colors.textFaint, fontStyle: 'italic', margin: '0.35rem 0 0' },
  card: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    margin: '1rem 0 0',
    boxShadow: shadow.card,
  },
  detailLine: { fontSize: fontSize.body, color: colors.inkPlain, margin: '0 0 0.3rem' },
  detailLabel: { color: colors.textMuted },
  notesText: { fontSize: fontSize.body, color: colors.inkPlain, margin: 0, whiteSpace: 'pre-wrap' },
  subheading: { fontSize: fontSize.lead, color: colors.ink, margin: '1.75rem 0 0.6rem' },
  chipRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  empty: { color: colors.textSubtle, fontSize: fontSize.body },
  dangerLink: {
    background: 'none',
    border: 'none',
    color: colors.danger,
    fontSize: fontSize.body,
    fontFamily,
    cursor: 'pointer',
    padding: 0,
  },
  confirmBox: {
    backgroundColor: colors.surface,
    border: border.danger,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
  },
  confirmText: { fontSize: fontSize.body, color: colors.inkPlain, margin: '0 0 0.75rem' },
  editForm: { marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' },
  fieldLabel: { fontSize: fontSize.small, color: colors.textMuted, marginTop: '0.5rem' },
  input: {
    fontSize: fontSize.bodyLg,
    padding: '0.5rem 0.65rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  textarea: {
    fontSize: fontSize.body,
    padding: '0.5rem 0.65rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
    width: '100%',
    boxSizing: 'border-box',
  },
  buttonRow: { display: 'flex', gap: '0.6rem', marginTop: '0.75rem' },
  saveButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  deleteButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.danger,
    color: colors.onFill,
    cursor: 'pointer',
    fontFamily,
  },
  cancelButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: border.default,
    backgroundColor: colors.surface,
    color: colors.textMuted,
    cursor: 'pointer',
    fontFamily,
  },
}
