import { describe, expect, it } from 'vitest'
import { icsDateToIsoDate, icsEndDateToIsoDate, parseIcs } from './ics.ts'

// Everything the calendar import knows about an event comes through here, and a parser bug shows
// up as a wrong or missing suggestion rather than an error — so the cases below are the real-world
// shapes Google/Apple/Outlook actually emit, not synthetic ones.

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`

describe('parseIcs', () => {
  it('pulls the fields the pipeline uses out of a plain timed event', () => {
    const events = parseIcs(
      wrap(
        [
          'BEGIN:VEVENT',
          'UID:abc123@google.com',
          'SUMMARY:Conor & Shelly wedding',
          'DESCRIPTION:Bring a gift',
          'LOCATION:Red Rocks',
          'DTSTART:20270617T140000Z',
          'DTEND:20270617T220000Z',
          'STATUS:confirmed',
          'END:VEVENT',
        ].join('\r\n')
      )
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      uid: 'abc123@google.com',
      summary: 'Conor & Shelly wedding',
      description: 'Bring a gift',
      location: 'Red Rocks',
      dtstart: '20270617T140000Z',
      dtstartIsDateOnly: false,
      status: 'CONFIRMED',
      isRecurring: false,
      attendees: [],
    })
  })

  it('rejoins folded lines, so a long title is not truncated', () => {
    // RFC5545 wraps past 75 octets; the continuation starts with a single space.
    const events = parseIcs(
      wrap(['BEGIN:VEVENT', 'UID:u1', 'SUMMARY:A very long event title that', '  keeps going', 'END:VEVENT'].join('\r\n'))
    )
    expect(events[0].summary).toBe('A very long event title that keeps going')
  })

  it('unescapes the characters iCal escapes', () => {
    const events = parseIcs(
      wrap(['BEGIN:VEVENT', 'UID:u1', 'DESCRIPTION:Line one\\nLine two\\, with a comma\\; and a semicolon', 'END:VEVENT'].join('\r\n'))
    )
    expect(events[0].description).toBe('Line one\nLine two, with a comma; and a semicolon')
  })

  it('flags a date-only DTSTART both ways it is written', () => {
    const viaParam = parseIcs(wrap(['BEGIN:VEVENT', 'UID:u1', 'DTSTART;VALUE=DATE:20260815', 'END:VEVENT'].join('\r\n')))
    const viaShape = parseIcs(wrap(['BEGIN:VEVENT', 'UID:u2', 'DTSTART:20260815', 'END:VEVENT'].join('\r\n')))
    expect(viaParam[0].dtstartIsDateOnly).toBe(true)
    expect(viaShape[0].dtstartIsDateOnly).toBe(true)
  })

  it('reads attendees with and without a display name, dropping the mailto prefix', () => {
    const events = parseIcs(
      wrap(
        [
          'BEGIN:VEVENT',
          'UID:u1',
          'ATTENDEE;CN=Patrick Mojica;ROLE=REQ-PARTICIPANT:mailto:patrick@example.com',
          'ATTENDEE:MAILTO:noname@example.com',
          'END:VEVENT',
        ].join('\r\n')
      )
    )
    expect(events[0].attendees).toEqual([
      { name: 'Patrick Mojica', email: 'patrick@example.com' },
      { name: null, email: 'noname@example.com' },
    ])
  })

  it('strips the quotes Outlook puts around a CN', () => {
    const events = parseIcs(
      wrap(['BEGIN:VEVENT', 'UID:u1', 'ATTENDEE;CN="Volin, Jake":mailto:jake@example.com', 'END:VEVENT'].join('\r\n'))
    )
    expect(events[0].attendees[0].name).toBe('Volin, Jake')
  })

  it('marks a repeating event and carries a RECURRENCE-ID override', () => {
    const events = parseIcs(
      wrap(
        [
          'BEGIN:VEVENT',
          'UID:u1',
          'RRULE:FREQ=YEARLY',
          'RECURRENCE-ID;VALUE=DATE:20260815',
          'END:VEVENT',
        ].join('\r\n')
      )
    )
    expect(events[0].isRecurring).toBe(true)
    expect(events[0].recurrenceId).toBe('20260815')
  })

  it('reads several events out of one feed', () => {
    const events = parseIcs(
      wrap(
        [
          'BEGIN:VEVENT',
          'UID:u1',
          'SUMMARY:One',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:u2',
          'SUMMARY:Two',
          'END:VEVENT',
        ].join('\r\n')
      )
    )
    expect(events.map((e) => e.summary)).toEqual(['One', 'Two'])
  })

  it('drops a VEVENT with no UID rather than importing something it can never de-duplicate', () => {
    const events = parseIcs(wrap(['BEGIN:VEVENT', 'SUMMARY:Anonymous', 'END:VEVENT'].join('\r\n')))
    expect(events).toEqual([])
  })

  it('ignores properties outside a VEVENT and survives an empty or junk feed', () => {
    expect(parseIcs('')).toEqual([])
    expect(parseIcs('SUMMARY:loose line with no event')).toEqual([])
    expect(parseIcs(wrap('X-WR-CALNAME:My Calendar'))).toEqual([])
  })

  it('handles bare-LF feeds, not just CRLF', () => {
    const events = parseIcs('BEGIN:VEVENT\nUID:u1\nSUMMARY:Lf only\nEND:VEVENT')
    expect(events[0].summary).toBe('Lf only')
  })
})

describe('icsDateToIsoDate', () => {
  it('takes the date straight off a date-only or floating-time value', () => {
    expect(icsDateToIsoDate('20260815')).toBe('2026-08-15')
    expect(icsDateToIsoDate('20260815T140000')).toBe('2026-08-15')
  })

  it('converts a UTC stamp into the given zone, so an evening event does not land a day late', () => {
    // 02:00 UTC on the 16th is 8pm on the 15th in Denver — the bug this branch exists to prevent.
    expect(icsDateToIsoDate('20260816T020000Z', 'America/Denver')).toBe('2026-08-15')
    expect(icsDateToIsoDate('20260816T020000Z', 'UTC')).toBe('2026-08-16')
  })

  it('returns null for a value that is not a date at all', () => {
    expect(icsDateToIsoDate('')).toBeNull()
    expect(icsDateToIsoDate('not-a-date')).toBeNull()
  })
})

describe('icsEndDateToIsoDate', () => {
  it('subtracts the exclusive day from an all-day DTEND', () => {
    // Aug 15-17 all-day is stored DTEND=20260818.
    expect(icsEndDateToIsoDate('20260818', true)).toBe('2026-08-17')
  })

  it('steps back across a month and a year boundary correctly', () => {
    expect(icsEndDateToIsoDate('20260901', true)).toBe('2026-08-31')
    expect(icsEndDateToIsoDate('20270101', true)).toBe('2026-12-31')
  })

  it('leaves a timed DTEND alone — only the all-day form is exclusive', () => {
    expect(icsEndDateToIsoDate('20260817T220000Z', false, 'UTC')).toBe('2026-08-17')
  })

  it('returns null for an unparseable value instead of shifting a bad date', () => {
    expect(icsEndDateToIsoDate('nonsense', true)).toBeNull()
  })
})
