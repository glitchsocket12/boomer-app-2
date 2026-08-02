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
  created_at: string
}

export type PetOwner = { id: string; name: string }

export const PET_COLUMNS =
  'id, name, species, breed, birth_date, adopted_date, deceased_date, notes, attributes, created_at'

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
    created_at: row.created_at,
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

export async function loadPet(petId: string): Promise<Pet | null> {
  const { data } = await supabase.from('pets').select(PET_COLUMNS).eq('id', petId).maybeSingle()
  return data ? normalize(data) : null
}

function ownerName(row: any): string {
  return row.last_name ? `${row.name} ${row.last_name}` : row.name
}

export async function loadPetOwners(petId: string): Promise<PetOwner[]> {
  const { data } = await supabase.from('person_pets').select('people(id, name, last_name)').eq('pet_id', petId)
  if (!data) return []
  return (data as any[])
    .map((r) => r.people)
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: ownerName(p) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Every pet's owners in one round trip, keyed by pet id — the People list needs this for all pets
// at once and must not fire a query per pet.
export async function loadOwnersByPetId(): Promise<Record<string, PetOwner[]>> {
  const { data } = await supabase.from('person_pets').select('pet_id, people(id, name, last_name)')
  const byPet: Record<string, PetOwner[]> = {}
  for (const row of (data ?? []) as any[]) {
    if (!row.people) continue
    ;(byPet[row.pet_id] ??= []).push({ id: row.people.id, name: ownerName(row.people) })
  }
  for (const owners of Object.values(byPet)) owners.sort((a, b) => a.name.localeCompare(b.name))
  return byPet
}

// Real deletion, for the pet's own page — distinct from unlinkPet, which only detaches it from one
// profile. person_pets rows cascade on the FK.
export async function deletePet(petId: string): Promise<void> {
  const { error } = await supabase.from('pets').delete().eq('id', petId)
  if (error) console.error('Pet delete failed', error)
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

export const PET_FALLBACK_EMOJI = '🐾'

// Species is free text, so this is a best-effort keyword match over species AND breed together —
// "pup", "goldendoodle" and "black lab" all need to land on the dog. ORDER IS LOAD-BEARING: each
// entry wins on the first substring hit, so anything whose keyword contains another entry's keyword
// must come first — fish before cat ("catfish"), dog before cow ("bulldog"), snake before the
// rodents ("rattlesnake"), "guinea pig" before "pig". Falls back to a paw, which reads as "this is
// a pet" rather than a wrong guess, so an unmatched species is never actually wrong.
const SPECIES_EMOJI: [string, string[]][] = [
  ['🐟', ['fish', 'betta', 'guppy', 'koi', 'tetra', 'cichlid', 'molly', 'oscar']],
  ['🐕', ['dog', 'pup', 'doggo', 'doggy', 'hound', 'terrier', 'retriever', 'poodle', 'doodle', 'shepherd', 'lab', 'corgi', 'beagle', 'dachshund', 'chihuahua', 'husky', 'collie', 'spaniel', 'pug', 'mutt', 'boxer', 'mastiff', 'dane']],
  ['🐈', ['cat', 'kitten', 'kitty', 'tabby', 'siamese', 'persian', 'feline']],
  ['🐹', ['guinea pig', 'hamster', 'gerbil', 'chinchilla', 'degu']],
  ['🐍', ['snake', 'python', 'viper', 'boa constrictor']],
  ['🐁', ['mouse', 'mice', 'rat']],
  ['🦎', ['lizard', 'gecko', 'dragon', 'iguana', 'chameleon', 'skink', 'monitor']],
  ['🐢', ['turtle', 'tortoise', 'terrapin']],
  ['🐸', ['frog', 'toad', 'axolotl', 'newt']],
  ['🐰', ['rabbit', 'bunny', 'hare']],
  ['🐴', ['horse', 'pony', 'mare', 'gelding', 'stallion', 'filly', 'mustang', 'appaloosa']],
  ['🦜', ['parrot', 'macaw', 'cockatoo', 'cockatiel', 'parakeet', 'budgie', 'lovebird', 'conure']],
  ['🐔', ['chicken', 'hen', 'rooster', 'chick']],
  ['🦆', ['duck', 'goose', 'gosling']],
  ['🐦', ['bird', 'finch', 'canary', 'dove', 'pigeon']],
  ['🐐', ['goat']],
  ['🐖', ['pig', 'hog']],
  ['🐄', ['cow', 'calf', 'heifer', 'steer', 'bull']],
  ['🐑', ['sheep', 'lamb', 'ram']],
  ['🕷️', ['spider', 'tarantula']],
  ['🦀', ['crab']],
  ['🦔', ['hedgehog']],
]

// A keyword counts only if it lines up with a word boundary on at least ONE side. Plain substring
// matching read "wallaby" as a dog (it contains "lab"); requiring boundaries on BOTH sides would
// miss "bulldog" and "goldendoodle", which are exactly the words people type. One side is the rule
// that gets all three right.
function mentions(haystack: string, keyword: string): boolean {
  return new RegExp(`\\b${keyword}|${keyword}\\b`).test(haystack)
}

export function petEmoji(pet: Pick<Pet, 'species' | 'breed'>): string {
  const haystack = `${pet.species ?? ''} ${pet.breed ?? ''}`.toLowerCase()
  if (!haystack.trim()) return PET_FALLBACK_EMOJI
  for (const [emoji, keywords] of SPECIES_EMOJI) {
    if (keywords.some((k) => mentions(haystack, k))) return emoji
  }
  return PET_FALLBACK_EMOJI
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
