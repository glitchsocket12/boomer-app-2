import { describe, expect, it } from 'vitest'
import { normalizeEnvelope, SAVE_TOOL, SAVE_TOOL_NAME } from './converseTool.ts'

// Every case here is "the model returned something the schema said it wouldn't". That is a real
// possibility rather than paranoia: this tool is forced but NOT strict, so `tool_choice` guarantees
// the call happens and nothing guarantees the shape. It bit within minutes of shipping —
// `relevant_people` came back as a non-array and killed the whole write pass with
// `.map is not a function`, after the reply had already been streamed to the user.
describe('normalizeEnvelope', () => {
  it('wraps a bare value where a list was expected, rather than discarding it', () => {
    // "Manuel" plainly means ["Manuel"]. Dropping it to satisfy a type would lose the very content
    // this change exists to protect.
    const out = normalizeEnvelope({ relevant_people: 'Manuel' })
    expect(out.relevant_people).toEqual(['Manuel'])
  })

  it('turns null and undefined list fields into empty arrays', () => {
    const out = normalizeEnvelope({ relevant_people: null, moments: undefined })
    expect(out.relevant_people).toEqual([])
    expect(out.moments).toEqual([])
  })

  it('fills in every list field the model omitted entirely', () => {
    const out = normalizeEnvelope({ reply: 'Just answering a question.' })
    for (const field of [
      'new_people',
      'renames',
      'last_name_updates',
      'nickname_updates',
      'how_you_know_updates',
      'former_name_updates',
      'relevant_people',
      'person_group_tags',
      'group_details',
      'mentioned_names',
      'pets',
      'moments',
      'family_signals',
    ]) {
      expect(Array.isArray(out[field]), `${field} should be an array`).toBe(true)
    }
  })

  it('leaves well-formed input untouched', () => {
    const moments = [{ moment_id: null, new_moment: true, notes: [{ person: null, note: 'Rotated tires.' }] }]
    const out = normalizeEnvelope({ reply: 'Got it.', moments })
    expect(out.moments[0].notes).toEqual([{ person: null, note: 'Rotated tires.' }])
    expect(out.reply).toBe('Got it.')
  })

  it('normalizes the lists nested inside each moment', () => {
    // The same `.map is not a function` crash is reachable one level down, and a moment is where
    // the user's actual words live.
    const out = normalizeEnvelope({
      moments: [{ notes: { person: null, note: 'Only one note, not in a list.' }, moment_groups: 'Air Force' }],
    })
    expect(out.moments[0].notes).toEqual([{ person: null, note: 'Only one note, not in a list.' }])
    expect(out.moments[0].moment_groups).toEqual(['Air Force'])
    expect(out.moments[0].moment_tags).toEqual([])
  })

  it('normalizes the lists nested inside pets and name updates', () => {
    const out = normalizeEnvelope({
      pets: [{ name: 'Biscuit', owners: 'Manuel' }],
      nickname_updates: [{ person: 'Bob', nicknames: 'Bobby' }],
      family_signals: [{ subject: 'me', relationship: 'sibling', person_names: 'Sam' }],
    })
    expect(out.pets[0].owners).toEqual(['Manuel'])
    expect(out.pets[0].attributes).toEqual([])
    expect(out.nickname_updates[0].nicknames).toEqual(['Bobby'])
    expect(out.family_signals[0].person_names).toEqual(['Sam'])
  })

  it('survives null entries inside the lists without throwing', () => {
    const out = normalizeEnvelope({ moments: [null], pets: [null], family_signals: [null] })
    expect(out.moments).toEqual([null])
    expect(out.pets).toEqual([null])
  })

  it('treats an empty string as nothing rather than wrapping it', () => {
    expect(normalizeEnvelope({ relevant_people: '' }).relevant_people).toEqual([])
  })
})

// The tool definition sits in the prompt cache prefix, ahead of the system prompt, so its shape is
// load-bearing for cost as well as correctness.
describe('SAVE_TOOL', () => {
  it('requires only the reply, so a pure question can omit every write field', () => {
    expect(SAVE_TOOL.input_schema.required).toEqual(['reply'])
  })

  it('is named consistently with the constant the prompt and tool_choice both use', () => {
    expect(SAVE_TOOL.name).toBe(SAVE_TOOL_NAME)
  })

  it('stays under the strict-mode optional-parameter cap, in case strict is ever retried', () => {
    // 27 optionals was a hard 400 (limit 24) on 2026-09-04. Nothing enforces this while `strict` is
    // off, so this test is the reminder that adding an optional field has a ceiling.
    const countOptional = (schema: any): number => {
      if (!schema || typeof schema !== 'object') return 0
      let n = 0
      if (schema.type === 'array') return countOptional(schema.items)
      if (schema.properties) {
        const required: string[] = schema.required ?? []
        for (const [key, child] of Object.entries<any>(schema.properties)) {
          if (!required.includes(key)) n++
          n += countOptional(child)
        }
      }
      return n
    }
    expect(countOptional(SAVE_TOOL.input_schema)).toBeLessThanOrEqual(24)
  })
})
