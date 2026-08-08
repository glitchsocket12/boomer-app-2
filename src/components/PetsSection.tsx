import { useEffect, useState } from 'react'
import {
  createAndLinkPet,
  formatPetDates,
  formatPetLine,
  isMemorial,
  linkPet,
  loadAllPets,
  loadPetsForPerson,
  petEmoji,
  unlinkPet,
  type Pet,
} from '../lib/pets'
import SearchAddPicker from './SearchAddPicker'
import { border, colors, fontFamily, fontSize, radius } from '../lib/theme'

// Collapsible "Pets" card on a person's profile (2026-08-01). Deliberately shaped like
// ContactInfoSection: its own isolated query rather than folding into PersonDetail's main select,
// so a database where the pets migration hasn't been run yet degrades to no card at all instead of
// blanking the whole profile page.
//
// This card LISTS and ATTACHES; it doesn't edit. Tapping a pet opens its own page, which owns the
// edit form — same split as groups and events (chips here, editing on the detail page), so there's
// only one pet form to maintain.
//
// A pet is a shared record, not a field on this person — the picker searches every pet on the
// account, so tagging the spouse's dog onto this profile is the same gesture as adding a brand-new
// one, and removing it here only unlinks.
export default function PetsSection({
  personId,
  readOnly = false,
  pets: petsOverride,
  onSelectPet,
}: {
  personId: string
  readOnly?: boolean
  // When supplied, no query fires at all — the logged-out demo renders from static data and makes
  // zero Supabase calls.
  pets?: Pet[]
  onSelectPet?: (pet: { id: string; name: string }) => void
}) {
  const [loading, setLoading] = useState(!petsOverride)
  const [available, setAvailable] = useState(true)
  const [pets, setPets] = useState<Pet[]>(petsOverride ?? [])
  const [allPets, setAllPets] = useState<Pet[]>([])
  const [open, setOpen] = useState((petsOverride ?? []).length > 0)
  const [busy, setBusy] = useState(false)

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

  async function handleAddExisting(petId: string) {
    setBusy(true)
    await linkPet(personId, petId)
    await load()
    setBusy(false)
  }

  async function handleCreate(name: string) {
    setBusy(true)
    const created = await createAndLinkPet(personId, { name })
    await load()
    setBusy(false)
    // Straight onto the new pet's page to fill in the details — same "create a shell, then build it
    // up" flow as "+ Add Person" and "+ Add Event".
    if (created && onSelectPet) onSelectPet({ id: created.id, name: created.name })
  }

  async function handleUnlink(petId: string) {
    setBusy(true)
    await unlinkPet(personId, petId)
    await load()
    setBusy(false)
  }

  if (loading) return null
  // Migration not run yet — hide entirely rather than offer an Add box that would silently no-op.
  if (!available) return null
  if (readOnly && pets.length === 0) return null

  // A permanently-visible bordered card just to show a collapsed "▸ Pets" toggle read as clutter
  // on every profile that doesn't have one (founder feedback 2026-08-07) — most don't. A single
  // quiet line replaces it until there's something to show; clicking it expands into the full
  // card below (picker included), same as it always has.
  if (!readOnly && pets.length === 0 && !open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={styles.quietAdd}>
        + Add pet
      </button>
    )
  }

  const linkedIds = new Set(pets.map((p) => p.id))
  const pickerItems = allPets
    .filter((p) => !linkedIds.has(p.id))
    .map((p) => ({ id: p.id, label: `${petEmoji(p)} ${formatPetLine(p)}` }))

  return (
    <div style={styles.section}>
      <div style={styles.headingRow}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={styles.toggleButton}>
          {open ? '▾' : '▸'} Pets
        </button>
      </div>

      {open && (
        <div style={styles.displayList}>
          {pets.map((pet) => (
            <div key={pet.id} style={styles.petRow}>
              <button
                type="button"
                onClick={() => onSelectPet?.({ id: pet.id, name: pet.name })}
                disabled={!onSelectPet}
                style={
                  isMemorial(pet)
                    ? { ...styles.petButton, ...styles.memorialButton }
                    : styles.petButton
                }
              >
                <span style={styles.petName}>
                  {petEmoji(pet)} {formatPetLine(pet)}
                  {isMemorial(pet) && <span style={styles.memorialTag}> · In memory</span>}
                </span>
                {formatPetDates(pet) && <span style={styles.petMeta}>{formatPetDates(pet)}</span>}
              </button>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleUnlink(pet.id)}
                  disabled={busy}
                  title="Remove from this profile (the pet itself is kept)"
                  aria-label={`Remove ${pet.name} from this profile`}
                  style={styles.removeButton}
                >
                  ×
                </button>
              )}
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
  petRow: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' },
  petButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.1rem',
    flex: 1,
    minWidth: 0,
    background: 'none',
    border: 'none',
    textAlign: 'left',
    padding: '0.3rem 0',
    cursor: 'pointer',
    fontFamily,
  },
  memorialButton: { opacity: 0.75 },
  petName: { fontSize: fontSize.body, color: colors.inkPlain, fontWeight: 'bold' },
  memorialTag: { fontSize: fontSize.small, color: colors.textFaint, fontStyle: 'italic', fontWeight: 'normal' },
  petMeta: { fontSize: fontSize.label, color: colors.textMuted },
  emptyText: { fontSize: fontSize.label, color: colors.textFaintest, margin: 0 },
  removeButton: {
    background: 'none',
    border: 'none',
    color: colors.danger,
    fontSize: fontSize.base,
    cursor: 'pointer',
    padding: '0.3rem',
    flexShrink: 0,
  },
  pickerWrap: { marginTop: '0.75rem' },
  quietAdd: {
    background: 'none',
    border: 'none',
    padding: '0.35rem 0',
    margin: '0 0 1rem',
    color: colors.primary,
    fontSize: fontSize.label,
    fontWeight: 'bold',
    fontFamily,
    cursor: 'pointer',
    display: 'block',
  },
}
