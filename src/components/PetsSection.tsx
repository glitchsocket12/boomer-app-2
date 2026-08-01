import { useEffect, useState } from 'react'
import {
  createAndLinkPet,
  isMemorial,
  linkPet,
  loadAllPets,
  loadPetsForPerson,
  formatPetDates,
  formatPetLine,
  unlinkPet,
  updatePet,
  type Pet,
} from '../lib/pets'
import { LabeledValueEditor } from './ContactInfoSection'
import AutoGrowTextarea from './AutoGrowTextarea'
import EditButton from './EditButton'
import SearchAddPicker from './SearchAddPicker'
import { border, colors, fontFamily, fontSize, radius } from '../lib/theme'

// Collapsible "Pets" card on a person's profile (2026-08-01). Deliberately shaped like
// ContactInfoSection: its own isolated query rather than folding into PersonDetail's main select,
// so a database where the pets migration hasn't been run yet degrades to an empty card instead of
// blanking the whole profile page.
//
// A pet is a shared record, not a field on this person — the picker at the bottom searches every
// pet on the account, so tagging the spouse's dog onto this profile is the same gesture as adding
// a brand-new one, and removing it here only unlinks.
export default function PetsSection({
  personId,
  readOnly = false,
  pets: petsOverride,
}: {
  personId: string
  readOnly?: boolean
  // When supplied, no query fires at all — the logged-out demo renders from static data and makes
  // zero Supabase calls.
  pets?: Pet[]
}) {
  const [loading, setLoading] = useState(!petsOverride)
  const [available, setAvailable] = useState(true)
  const [pets, setPets] = useState<Pet[]>(petsOverride ?? [])
  const [allPets, setAllPets] = useState<Pet[]>([])
  const [open, setOpen] = useState((petsOverride ?? []).length > 0)
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Pet[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (petsOverride) {
      setPets(petsOverride)
      setOpen(petsOverride.length > 0)
      setLoading(false)
      return
    }
    load()
  }, [personId])

  async function load() {
    setLoading(true)
    const [mine, all] = await Promise.all([loadPetsForPerson(personId), loadAllPets()])
    setAvailable(mine.available)
    setPets(mine.pets)
    setAllPets(all)
    setOpen(mine.pets.length > 0)
    setLoading(false)
  }

  function startEditing() {
    setDrafts(pets.map((p) => ({ ...p, attributes: [...p.attributes] })))
    setEditing(true)
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    for (const draft of drafts) {
      const original = pets.find((p) => p.id === draft.id)
      if (!original) continue
      const name = draft.name.trim()
      // A blank name would leave an unfindable pet on the profile — keep what was there.
      await updatePet(draft.id, {
        name: name || original.name,
        species: draft.species?.trim() || null,
        breed: draft.breed?.trim() || null,
        birth_date: draft.birth_date || null,
        adopted_date: draft.adopted_date || null,
        deceased_date: draft.deceased_date || null,
        notes: draft.notes?.trim() || null,
        attributes: draft.attributes,
      })
    }
    setSaving(false)
    setEditing(false)
    await load()
  }

  async function handleAddExisting(petId: string) {
    await linkPet(personId, petId)
    await load()
  }

  async function handleCreate(name: string) {
    await createAndLinkPet(personId, { name })
    await load()
  }

  async function handleUnlink(petId: string) {
    await unlinkPet(personId, petId)
    setDrafts((d) => d.filter((p) => p.id !== petId))
    await load()
  }

  function updateDraft(petId: string, patch: Partial<Pet>) {
    setDrafts((d) => d.map((p) => (p.id === petId ? { ...p, ...patch } : p)))
  }

  if (loading) return null
  // Migration not run yet — hide entirely rather than offer an Add box that would silently no-op.
  if (!available) return null
  if (readOnly && pets.length === 0) return null

  const linkedIds = new Set(pets.map((p) => p.id))
  const pickerItems = allPets
    .filter((p) => !linkedIds.has(p.id))
    .map((p) => ({ id: p.id, label: formatPetLine(p) }))

  return (
    <div style={styles.section}>
      <div style={styles.headingRow}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={styles.toggleButton}>
          {open ? '▾' : '▸'} Pets
        </button>
        {!readOnly && open && !editing && pets.length > 0 && <EditButton label="Edit pets" onClick={startEditing} />}
      </div>

      {open && !editing && (
        <div style={styles.displayList}>
          {pets.map((pet) => (
            <div key={pet.id} style={styles.displayPet}>
              <p style={isMemorial(pet) ? { ...styles.petName, ...styles.memorialName } : styles.petName}>
                {formatPetLine(pet)}
                {isMemorial(pet) && <span style={styles.memorialTag}> · In memory</span>}
              </p>
              {formatPetDates(pet) && <p style={styles.petMeta}>{formatPetDates(pet)}</p>}
              {pet.attributes.map((a, i) => (
                <p key={i} style={styles.petMeta}>
                  {a.label}: {a.value}
                </p>
              ))}
              {pet.notes && <p style={styles.petNotes}>{pet.notes}</p>}
            </div>
          ))}
          {pets.length === 0 && (
            <p style={styles.emptyText}>No pets on file yet.{!readOnly && ' Search below to add one.'}</p>
          )}
          {!readOnly && (
            <div style={styles.pickerWrap}>
              <SearchAddPicker
                items={pickerItems}
                placeholder="Add a pet…"
                browseAll
                onSelect={(item) => handleAddExisting(item.id)}
                onCreateNew={handleCreate}
                createLabel={(q) => `+ Add "${q}" as a new pet`}
                emptyText="No other pets on file — type a name to add one."
              />
            </div>
          )}
        </div>
      )}

      {open && editing && (
        <div style={styles.editForm}>
          {drafts.map((pet) => (
            <div key={pet.id} style={styles.editPet}>
              <label style={styles.fieldLabel}>Name</label>
              <input
                type="text"
                value={pet.name}
                onChange={(e) => updateDraft(pet.id, { name: e.target.value })}
                style={styles.input}
              />
              <label style={styles.fieldLabel}>Kind of animal</label>
              <input
                type="text"
                value={pet.species ?? ''}
                onChange={(e) => updateDraft(pet.id, { species: e.target.value })}
                placeholder="Dog, cat, horse, parrot…"
                style={styles.input}
              />
              <label style={styles.fieldLabel}>Breed</label>
              <input
                type="text"
                value={pet.breed ?? ''}
                onChange={(e) => updateDraft(pet.id, { breed: e.target.value })}
                placeholder="Optional"
                style={styles.input}
              />

              <label style={styles.fieldLabel}>Birthday</label>
              <input
                type="date"
                value={pet.birth_date ?? ''}
                onChange={(e) => updateDraft(pet.id, { birth_date: e.target.value || null })}
                style={styles.input}
              />
              <label style={styles.fieldLabel}>Adopted</label>
              <input
                type="date"
                value={pet.adopted_date ?? ''}
                onChange={(e) => updateDraft(pet.id, { adopted_date: e.target.value || null })}
                style={styles.input}
              />
              <label style={styles.fieldLabel}>Passed away</label>
              <input
                type="date"
                value={pet.deceased_date ?? ''}
                onChange={(e) => updateDraft(pet.id, { deceased_date: e.target.value || null })}
                style={styles.input}
              />

              <LabeledValueEditor
                label="Details"
                items={pet.attributes}
                onChange={(attributes) => updateDraft(pet.id, { attributes })}
                labelPlaceholder="Label (Vet, Barn…)"
                valuePlaceholder="Anything worth remembering"
              />

              <label style={styles.fieldLabel}>Notes</label>
              <AutoGrowTextarea
                value={pet.notes ?? ''}
                onChange={(v) => updateDraft(pet.id, { notes: v })}
                placeholder="Anything else about this pet…"
                style={styles.textarea}
              />

              {/* Unlink, not delete — this pet may also be on a spouse's profile. */}
              <button type="button" onClick={() => handleUnlink(pet.id)} style={styles.removeButton}>
                Remove from this profile
              </button>
            </div>
          ))}

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
  section: {
    backgroundColor: colors.surface,
    border: border.inkPale,
    borderRadius: radius.lg,
    padding: '0.85rem 1rem',
    margin: '0 0 1rem',
  },
  headingRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  toggleButton: {
    background: 'none',
    border: 'none',
    color: colors.ink,
    fontSize: fontSize.base,
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily,
    padding: 0,
  },
  displayList: { marginTop: '0.6rem' },
  displayPet: { marginBottom: '0.7rem' },
  petName: { fontSize: fontSize.body, color: colors.inkPlain, margin: '0 0 0.15rem', fontWeight: 'bold' },
  memorialName: { color: colors.textMuted, fontWeight: 'normal' },
  memorialTag: { fontSize: fontSize.small, color: colors.textFaint, fontStyle: 'italic', fontWeight: 'normal' },
  petMeta: { fontSize: fontSize.label, color: colors.textMuted, margin: '0 0 0.15rem' },
  petNotes: { fontSize: fontSize.label, color: colors.textBody, margin: '0.2rem 0 0', whiteSpace: 'pre-wrap' },
  emptyText: { fontSize: fontSize.label, color: colors.textFaintest, margin: 0 },
  pickerWrap: { marginTop: '0.75rem' },
  editForm: { marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  editPet: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    paddingBottom: '0.85rem',
    marginBottom: '0.5rem',
    borderBottom: border.light,
  },
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
  removeButton: {
    alignSelf: 'flex-start',
    marginTop: '0.6rem',
    background: 'none',
    border: 'none',
    color: colors.danger,
    fontSize: fontSize.label,
    fontFamily,
    cursor: 'pointer',
    padding: 0,
  },
  buttonRow: { display: 'flex', gap: '0.6rem', marginTop: '0.25rem' },
  saveButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.ink,
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
