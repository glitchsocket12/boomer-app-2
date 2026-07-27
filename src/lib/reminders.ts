import { supabase } from './supabase'

export type ReminderDate = { month: number | null; day: number | null; year: number | null }

// Extracted from BirthdayImportReview.tsx's original upsertBirthday (select-then-update-or-insert,
// keyed on person_id + label — reminders has no DB unique constraint, so this is an app-level
// upsert). Generalized to take a label so the same helper covers both 'Birthday' and 'Anniversary',
// used by ContactImportReview.tsx's accept handler and PersonDetail.tsx's Contact Info editor.
export async function upsertReminder(personId: string, label: 'Birthday' | 'Anniversary', date: ReminderDate): Promise<void> {
  const { data: existing } = await supabase
    .from('reminders')
    .select('id')
    .eq('person_id', personId)
    .eq('label', label)
    .maybeSingle()

  if (existing) {
    await supabase.from('reminders').update({ month: date.month, day: date.day, year: date.year }).eq('id', existing.id)
  } else {
    await supabase.from('reminders').insert({ person_id: personId, label, month: date.month, day: date.day, year: date.year })
  }
}
