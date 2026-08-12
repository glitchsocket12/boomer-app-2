import { describe, expect, it } from 'vitest'
import { parseVcf } from './vcard.ts'

// The contacts import is a 1000-card pass the founder reviews once — a parser that quietly loses a
// phone number or mislabels a spouse is worse than one that errors, because nobody re-checks. These
// cases are the shapes iCloud.com and Mac Contacts.app actually export.

const card = (body: string) => `BEGIN:VCARD\r\nVERSION:3.0\r\n${body}\r\nEND:VCARD\r\n`

describe('parseVcf — names', () => {
  it('splits a structured N into first/middle/last and keeps FN as the display name', () => {
    const [c] = parseVcf(card('N:Volin;Jake;Robert;;\r\nFN:Jake Volin\r\nNICKNAME:Jakey'))
    expect(c).toMatchObject({
      fullName: 'Jake Volin',
      firstName: 'Jake',
      middleName: 'Robert',
      lastName: 'Volin',
      nickname: 'Jakey',
    })
  })

  it('builds a full name from the parts when FN is missing', () => {
    const [c] = parseVcf(card('N:Volin;Jake;;;'))
    expect(c.fullName).toBe('Jake Volin')
  })

  it('skips a card with no name at all — a business entry is not a person', () => {
    expect(parseVcf(card('ORG:Denver Plumbing\r\nTEL:+13035551212'))).toEqual([])
  })

  it('reads several cards out of one file', () => {
    const file = card('FN:One Person') + card('FN:Two Person')
    expect(parseVcf(file).map((c) => c.fullName)).toEqual(['One Person', 'Two Person'])
  })

  it('returns nothing for an empty file', () => {
    expect(parseVcf('')).toEqual([])
  })
})

describe('parseVcf — phones, emails and labels', () => {
  it('labels a phone from its TYPE, ignoring the generic ones', () => {
    const [c] = parseVcf(card('FN:Jake Volin\r\nTEL;type=CELL;type=VOICE;type=pref:+12086482849'))
    expect(c.phones).toEqual([{ label: 'Cell', value: '+12086482849' }])
  })

  it('handles multiple TYPE values packed into one quoted param', () => {
    const [c] = parseVcf(card('FN:Jake Volin\r\nTEL;TYPE="home,voice":303-555-1212'))
    expect(c.phones).toEqual([{ label: 'Home', value: '303-555-1212' }])
  })

  it('falls back to "Other" when there is no usable type', () => {
    const [c] = parseVcf(card('FN:Jake Volin\r\nEMAIL:jake@example.com'))
    expect(c.emails).toEqual([{ label: 'Other', value: 'jake@example.com' }])
  })

  it('keeps every phone rather than only the first', () => {
    const [c] = parseVcf(card('FN:Jake Volin\r\nTEL;type=CELL:111\r\nTEL;type=HOME:222'))
    expect(c.phones).toHaveLength(2)
  })
})

describe('parseVcf — addresses', () => {
  it('reads the components of an ADR and joins the two street lines', () => {
    const [c] = parseVcf(card('FN:Jake Volin\r\nADR;type=HOME:;Apt 4;12208 Bandon Dr;Parker;CO;80134;USA'))
    expect(c.addresses).toEqual([
      { label: 'Home', street: 'Apt 4, 12208 Bandon Dr', city: 'Parker', state: 'CO', zip: '80134', country: 'USA' },
    ])
  })

  it('leaves missing components null rather than empty strings', () => {
    const [c] = parseVcf(card('FN:Jake Volin\r\nADR;type=WORK:;;;Denver;CO;;'))
    expect(c.addresses[0]).toMatchObject({ street: null, city: 'Denver', zip: null, country: null })
  })
})

describe('parseVcf — dates', () => {
  it('reads a full birthday in both hyphenated and compact form', () => {
    expect(parseVcf(card('FN:A B\r\nBDAY:1990-05-12'))[0].birthday).toEqual({ month: 5, day: 12, year: 1990 })
    expect(parseVcf(card('FN:A B\r\nBDAY:19900512'))[0].birthday).toEqual({ month: 5, day: 12, year: 1990 })
  })

  it('reads a year-omitted birthday', () => {
    expect(parseVcf(card('FN:A B\r\nBDAY:--05-12'))[0].birthday).toEqual({ month: 5, day: 12, year: null })
    expect(parseVcf(card('FN:A B\r\nBDAY:--0512'))[0].birthday).toEqual({ month: 5, day: 12, year: null })
  })

  it("treats Apple's 1604 sentinel as no year, not as a real 17th-century birthday", () => {
    expect(parseVcf(card('FN:A B\r\nBDAY:1604-05-12'))[0].birthday).toEqual({ month: 5, day: 12, year: null })
  })

  it('returns null for an unparseable date instead of a NaN month', () => {
    expect(parseVcf(card('FN:A B\r\nBDAY:sometime'))[0].birthday).toBeNull()
  })

  it("picks up an anniversary from Apple's grouped X-ABDATE + label pair", () => {
    const [c] = parseVcf(
      card('FN:A B\r\nitem1.X-ABDATE;type=pref:2015-09-19\r\nitem1.X-ABLabel:_$!<Anniversary>!$_')
    )
    expect(c.anniversary).toEqual({ month: 9, day: 19, year: 2015 })
  })

  it('ignores a grouped date whose label is something else', () => {
    const [c] = parseVcf(card('FN:A B\r\nitem1.X-ABDATE:2015-09-19\r\nitem1.X-ABLabel:Graduation'))
    expect(c.anniversary).toBeNull()
  })
})

describe('parseVcf — related names', () => {
  it("unwraps Apple's built-in label markers", () => {
    const [c] = parseVcf(
      card('FN:Jake Volin\r\nitem1.X-ABRELATEDNAMES:Caroline Volin\r\nitem1.X-ABLabel:_$!<Spouse>!$_')
    )
    expect(c.relatedNames).toEqual([{ label: 'Spouse', name: 'Caroline Volin' }])
  })

  it('passes a custom typed label through unchanged', () => {
    const [c] = parseVcf(card('FN:Jake Volin\r\nitem2.X-ABRELATEDNAMES:Josh\r\nitem2.X-ABLabel:Brother'))
    expect(c.relatedNames).toEqual([{ label: 'Brother', name: 'Josh' }])
  })

  it('resolves the pair even when the label line comes FIRST', () => {
    // Nothing in the spec fixes the order, and the second pass is what makes it not matter.
    const [c] = parseVcf(card('FN:Jake Volin\r\nitem1.X-ABLabel:Brother\r\nitem1.X-ABRELATEDNAMES:Josh'))
    expect(c.relatedNames).toEqual([{ label: 'Brother', name: 'Josh' }])
  })

  it('labels an unlabelled related name "Other" rather than dropping it', () => {
    const [c] = parseVcf(card('FN:Jake Volin\r\nitem1.X-ABRELATEDNAMES:Josh'))
    expect(c.relatedNames).toEqual([{ label: 'Other', name: 'Josh' }])
  })
})

describe('parseVcf — text handling', () => {
  it('rejoins folded lines so a long note is not cut in half', () => {
    const [c] = parseVcf(card('FN:A B\r\nNOTE:This note is long enough that Contacts\r\n  wrapped it'))
    expect(c.note).toBe('This note is long enough that Contacts wrapped it')
  })

  it('unescapes newlines, commas and semicolons in free text', () => {
    const [c] = parseVcf(card('FN:A B\r\nNOTE:Line one\\nLine two\\, and\\; more'))
    expect(c.note).toBe('Line one\nLine two, and; more')
  })

  it('keeps an escaped semicolon inside a structured component instead of splitting on it', () => {
    const [c] = parseVcf(card('FN:A B\r\nORG:Smith\\; Jones LLC'))
    expect(c.organization).toBe('Smith; Jones LLC')
  })

  it('joins the two parts of a structured ORG', () => {
    const [c] = parseVcf(card('FN:A B\r\nORG:US Air Force;22 AS'))
    expect(c.organization).toBe('US Air Force / 22 AS')
  })
})
