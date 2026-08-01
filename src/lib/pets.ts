import { supabase } from './supabase'

// Pets are their own records joined to one or more people via person_pets (2026-08-01), so the
// family dog is edited once and shows on both spouses' profiles. This module is the single write
// path — PetsSection, and later the merge/delete handlers on PersonDetail, all go through it.

export type PetAttribute = { label: string; value: string }

export type Pet = {
  id: string
  name: string
  species: string | null
  breed: string | null
  birth_date: string | null
  adopted_date: string | null
  deceased_date: string | null
  notes: string | null
  attributes: PetAttribute[]
}

export const PET_COLUMNS = 'id, name, species, breed, birth_date, adopted_date, deceased_date, notes, attributes'

const EMPTY: Pet[] = []

function normalize(row: any): Pet {
  return {
    id: row.id,
    name: row.name,
    species: row.species ?? null,
    breed: row.breed ?? null,
    birth_date: row.birth_date ?? null,
    adopted_date: row.adopted_date ?? null,
    deceased_date: row.deceased_date ?? null,
    notes: row.notes ?? null,
    attributes: Array.isArray(row.attributes) ? row.attributes : [],
  }
}

// Living pets first, then in-memory ones, each alphabetical. A memorial shouldn't sit at the top of
// someone's profile above the pets they still have.
function sortPets(pets: Pet[]): Pet[] {
  return pets.sort((a, b) => {
    if (isMemorial(a) !== isMemorial(b)) return isMemorial(a) ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

// Isolated and fail-open, same reasoning as ContactInfoSection's contact-column query: the pets
// tables depend on a migration the founder runs by hand, so a pre-migration database 400s this one
// query instead of blanking the profile page. Safe to embed `pets` here precisely BECAUSE the query
// is standalone — the rule this respects is "never embed a new table into a page-critical select."
//
// `available` distinguishes "this person has no pets" from "the tables don't exist yet". They look
// identical in the data but must not look identical in the UI: offering an Add-a-pet box against a
// missing table would swallow the write and tell the founder nothing, which is exactly the silent-
// failure class this codebase treats as the house bug. When it's false, the card hides itself.
export async function loadPetsForPerson(personId: string): Promise<{ pets: Pet[]; available: boolean }> {
  const { data, error } = await supabase.from('person_pets').select(`pets(${PET_COLUMNS})`).eq('person_id', personId)
  if (error || !data) return { pets: EMPTY, available: !error }
  return { pets: sortPets((data as any[]).map((row) => row.pets).filter(Boolean).map(normalize)), available: true }
}

// Every pet on the account — the source for the "add a pet" picker, which doubles as the
// attach-the-spouse's-dog path.
export async function loadAllPets(): Promise<Pet[]> {
  const { data } = await supabase.from('pets').select(PET_COLUMNS).order('name')
  if (!data) return EMPTY
  return (data as any[]).map(normalize)
}

export async function createAndLinkPet(personId: string, fields: Partial<Pet> & { name: string }): Promise<Pet | null> {
  const { data: session } = await supabase.auth.getUser()
  const userId = session.user?.id
  if (!userId) return null
  const { data, error } = await supabase
    .from('pets')
    .insert({
      user_id: userId,
      name: fields.name,
      species: fields.species ?? null,
      breed: fields.breed ?? null,
      birth_date: fields.birth_date ?? null,
      adopted_date: fields.adopted_date ?? null,
      deceased_date: fields.deceased_date ?? null,
      notes: fields.notes ?? null,
      attributes: fields.attributes ?? [],
    })
    .select(PET_COLUMNS)
    .single()
  if (error || !data) {
    console.error('Pet insert failed', error)
    return null
  }
  await linkPet(personId, data.id)
  return normalize(data)
}

export async function linkPet(personId: string, petId: string): Promise<void> {
  const { error } = await supabase
    .from('person_pets')
    .upsert({ person_id: personId, pet_id: petId }, { onConflict: 'person_id,pet_id', ignoreDuplicates: true })
  if (error) console.error('Pet link failed', error)
}

// Detachment, not deletion — the pet may also be a spouse's. Deleting the record outright would
// take it off their profile too. Same non-destructive rule as untagging a group.
export async function unlinkPet(personId: string, petId: string): Promise<void> {
  const { error } = await supabase.from('person_pets').delete().eq('person_id', personId).eq('pet_id', petId)
  if (error) console.error('Pet unlink failed', error)
}

export async function updatePet(petId: string, fields: Partial<Pet>): Promise<void> {
  const { error } = await supabase.from('pets').update(fields).eq('id', petId)
  if (error) console.error('Pet update failed', error)
}

// --- Pure formatters (unit-tested in pets.test.ts) ----------------------------------------------

export function isMemorial(pet: Pick<Pet, 'deceased_date'>): boolean {
  return !!pet.deceased_date
}

// "Biscuit — golden retriever (dog)", "Mochi — cat", "Nemo". Breed leads because it's the more
// specific fact; species stays as the parenthetical so "golden retriever (dog)" still reads right
// and a breed-less pet degrades to just its species.
export function formatPetLine(pet: Pick<Pet, 'name' | 'species' | 'breed'>): string {
  const breed = pet.breed?.trim()
  const species = pet.species?.trim()
  if (breed && species) return `${pet.name} — ${breed} (${species})`
  if (breed || species) return `${pet.name} — ${breed || species}`
  return pet.name
}

// Parses with "T00:00:00" (no "Z") for the same local-midnight reasoning as src/lib/dates.ts —
// a bare "YYYY-MM-DD" through new Date() is UTC midnight and reads as the previous day west of
// Greenwich.
function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

function yearOf(iso: string): string {
  return iso.slice(0, 4)
}

// Alive: "Born June 3, 2019 · Adopted August 12, 2019". Passed away: "2019–2024", or just
// "Passed away March 2, 2024" when no birth date is on file. Deliberately understated — this line
// sits under a name someone loved.
export function formatPetDates(pet: Pick<Pet, 'birth_date' | 'adopted_date' | 'deceased_date'>): string | null {
  if (pet.deceased_date) {
    if (pet.birth_date) return `${yearOf(pet.birth_date)}–${yearOf(pet.deceased_date)}`
    return `Passed away ${formatDay(pet.deceased_date)}`
  }
  const parts: string[] = []
  if (pet.birth_date) parts.push(`Born ${formatDay(pet.birth_date)}`)
  if (pet.adopted_date) parts.push(`Adopted ${formatDay(pet.adopted_date)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
