import { supabase } from './supabase'

type SignupMetadata = {
  first_name?: string
  last_name?: string
  birthday?: string // 'YYYY-MM-DD', from the sign-up form's date input
}

// Sign-up (Login.tsx) already collects first/last name + birthday and stores them as auth
// user metadata. This turns that metadata into a real self person + birthday reminder, so a
// new user skips Circle.tsx's "which profile is you?" onboarding entirely. No-ops (leaves that
// onboarding screen intact) for anyone without first_name in their metadata — accounts created
// before this existed, or if a self person somehow already exists.
export async function ensureSelfPersonFromSignupMetadata(userId: string, metadata: SignupMetadata) {
  if (!metadata.first_name) return

  const { data: existingSelf, error: selfCheckError } = await supabase
    .from('people')
    .select('id')
    .eq('is_self', true)
    .maybeSingle()
  if (selfCheckError) {
    console.error('ensureSelfPersonFromSignupMetadata: failed to check for an existing self person', selfCheckError)
    return
  }
  if (existingSelf) return

  const { data: newPerson, error: insertError } = await supabase
    .from('people')
    .insert({ user_id: userId, name: metadata.first_name, last_name: metadata.last_name || null, is_self: true })
    .select('id')
    .single()
  if (insertError || !newPerson) {
    console.error('ensureSelfPersonFromSignupMetadata: failed to create the self person', insertError)
    return
  }

  if (metadata.birthday) {
    const [, monthStr, dayStr] = metadata.birthday.split('-')
    const { error: reminderError } = await supabase
      .from('reminders')
      .insert({ person_id: newPerson.id, label: 'Birthday', month: Number(monthStr), day: Number(dayStr) })
    if (reminderError) {
      console.error('ensureSelfPersonFromSignupMetadata: failed to create the birthday reminder', reminderError)
    }
  }
}
