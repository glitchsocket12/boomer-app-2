// Minimal vCard (2.1/3.0/4.0) contact-card parser — extracts only the fields the contacts-import
// pipeline needs (name, org/title, phones, emails, addresses, urls, social profiles, birthday,
// anniversary, related-names, note). Not a full spec implementation, deliberately — same reasoning
// as ics.ts: every real export (iCloud.com, Mac Contacts.app) emits these fields in a handful of
// predictable shapes, and pulling in a full vCard library for this would be overkill. Handles
// Apple's "itemN.X-ABLabel" grouping convention (used for Anniversary and related-names), where a
// human-readable label always arrives on the line AFTER the value line it describes.

export type VCardLabeledValue = { label: string; value: string }
export type VCardAddress = {
  label: string
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
}
export type VCardDate = { month: number; day: number; year: number | null }

export type VCardContact = {
  uid: string | null
  fullName: string
  firstName: string | null
  lastName: string | null
  middleName: string | null
  nickname: string | null
  organization: string | null
  jobTitle: string | null
  phones: VCardLabeledValue[]
  emails: VCardLabeledValue[]
  addresses: VCardAddress[]
  urls: VCardLabeledValue[]
  socialProfiles: VCardLabeledValue[]
  birthday: VCardDate | null
  anniversary: VCardDate | null
  relatedNames: { label: string; name: string }[]
  note: string | null
}

function unescapeText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\")
}

// Folded lines (RFC6350 §3.2, same rule as RFC5545): a continuation line starts with a single
// space or tab that must be stripped before rejoining to the previous line.
function unfold(text: string): string[] {
  const rawLines = text.split(/\r\n|\n|\r/)
  const lines: string[] = []
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

type ParsedLine = { group: string | null; name: string; params: Record<string, string[]>; value: string }

// A vCard line is "[group.]NAME[;PARAM=VAL]*:value" — the group prefix (e.g. "item1") is how
// Apple pairs a value line with the human-readable label that follows it (X-ABLabel). A param can
// repeat (TEL;type=CELL;type=VOICE;type=pref:...) or pack multiple values in one param
// (TYPE="cell,voice") — both forms are collected into the same params array per key.
function parseLine(rawLine: string): ParsedLine | null {
  const colonIdx = rawLine.indexOf(":")
  if (colonIdx === -1) return null
  let head = rawLine.slice(0, colonIdx)
  const value = rawLine.slice(colonIdx + 1)

  let group: string | null = null
  const dotIdx = head.indexOf(".")
  if (dotIdx !== -1 && /^item\d+$/i.test(head.slice(0, dotIdx))) {
    group = head.slice(0, dotIdx).toLowerCase()
    head = head.slice(dotIdx + 1)
  }

  const parts = head.split(";")
  const name = parts[0].toUpperCase()
  const params: Record<string, string[]> = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=")
    if (eq === -1) continue
    const key = p.slice(0, eq).toUpperCase()
    const rawVal = p.slice(eq + 1).replace(/^"|"$/g, "")
    const values = rawVal.split(",")
    params[key] = [...(params[key] ?? []), ...values]
  }
  return { group, name, params, value }
}

const GENERIC_TYPES = new Set(["pref", "voice", "internet", "x400"])
const LABEL_PRIORITY = ["home", "work", "cell", "iphone", "main", "school", "other"]

function pickLabel(params: Record<string, string[]>): string {
  const types = (params["TYPE"] ?? []).map((t) => t.toLowerCase()).filter((t) => !GENERIC_TYPES.has(t))
  for (const preferred of LABEL_PRIORITY) {
    if (types.includes(preferred)) return preferred[0].toUpperCase() + preferred.slice(1)
  }
  if (types.length > 0) return types[0][0].toUpperCase() + types[0].slice(1)
  return "Other"
}

// Strips Apple's built-in-label wrapper (X-ABLabel:_$!<Spouse>!$_ -> "Spouse"); a custom
// user-typed label has no wrapper and passes through unchanged.
function cleanAbLabel(raw: string): string {
  const m = raw.match(/^_\$!<(.+)>!\$_$/)
  return unescapeText(m ? m[1] : raw)
}

// BDAY/ANNIVERSARY/X-ABDATE values show up as "1990-05-12", "19900512", or year-omitted
// "--05-12"/"--0512". Apple's own vCard export has a documented quirk of stamping 1604 as a
// sentinel "no real year" value in some cases (pre-Gregorian-calendar placeholder) — treated the
// same as no year here.
function parseVcardDate(value: string): VCardDate | null {
  let m = value.match(/^--(\d{2})-?(\d{2})$/)
  if (m) return { month: Number(m[1]), day: Number(m[2]), year: null }
  m = value.match(/^(\d{4})-?(\d{2})-?(\d{2})/)
  if (m) {
    const year = Number(m[1])
    return { month: Number(m[2]), day: Number(m[3]), year: year <= 1604 ? null : year }
  }
  return null
}

function splitStructured(value: string): string[] {
  // Structured fields (N, ADR) separate components with unescaped ";" — a literal semicolon
  // inside a component is written "\;" per the escaping rules above, so split first, unescape after.
  return value.split(/(?<!\\);/).map((v) => unescapeText(v.trim()))
}

type PendingGroup = { value: string | null; propName: string | null; label: string | null }

function parseVcard(block: string): VCardContact | null {
  const lines = unfold(block)

  let fullName: string | null = null
  let firstName: string | null = null
  let lastName: string | null = null
  let middleName: string | null = null
  let nickname: string | null = null
  let organization: string | null = null
  let jobTitle: string | null = null
  let uid: string | null = null
  let note: string | null = null
  let birthday: VCardDate | null = null
  let anniversary: VCardDate | null = null
  const phones: VCardLabeledValue[] = []
  const emails: VCardLabeledValue[] = []
  const addresses: VCardAddress[] = []
  const urls: VCardLabeledValue[] = []
  const socialProfiles: VCardLabeledValue[] = []
  const groups = new Map<string, PendingGroup>()

  for (const rawLine of lines) {
    const trimmed = rawLine.trimEnd()
    if (trimmed === "" || trimmed === "BEGIN:VCARD" || trimmed === "END:VCARD" || trimmed.startsWith("VERSION:")) continue
    const parsed = parseLine(trimmed)
    if (!parsed) continue
    const { group, name, params, value } = parsed

    // A grouped X-ABLabel always describes the OTHER property sharing its group prefix, so it's
    // resolved in a second pass once every line has been seen (the label commonly arrives after
    // the value it labels, but nothing in the spec guarantees the order).
    if (group) {
      const entry = groups.get(group) ?? { value: null, propName: null, label: null }
      if (name === "X-ABLABEL") {
        entry.label = cleanAbLabel(value)
      } else {
        entry.propName = name
        entry.value = value
      }
      groups.set(group, entry)
      continue
    }

    switch (name) {
      case "UID":
        uid = value.trim() || null
        break
      case "FN":
        fullName = unescapeText(value).trim() || null
        break
      case "N": {
        const [last, first, middle] = splitStructured(value)
        lastName = last || null
        firstName = first || null
        middleName = middle || null
        break
      }
      case "NICKNAME":
        nickname = unescapeText(value).trim() || null
        break
      case "ORG": {
        const parts = splitStructured(value).filter(Boolean)
        organization = parts.length > 0 ? parts.join(" / ") : null
        break
      }
      case "TITLE":
        jobTitle = unescapeText(value).trim() || null
        break
      case "TEL":
        phones.push({ label: pickLabel(params), value: value.trim() })
        break
      case "EMAIL":
        emails.push({ label: pickLabel(params), value: value.trim() })
        break
      case "URL":
        urls.push({ label: pickLabel(params), value: value.trim() })
        break
      case "X-SOCIALPROFILE":
        socialProfiles.push({ label: (params["TYPE"] ?? [])[0] ?? "Other", value: value.trim() })
        break
      case "ADR": {
        const [, extended, street, city, state, zip, country] = splitStructured(value)
        const combinedStreet = [extended, street].filter(Boolean).join(", ") || null
        addresses.push({
          label: pickLabel(params),
          street: combinedStreet,
          city: city || null,
          state: state || null,
          zip: zip || null,
          country: country || null,
        })
        break
      }
      case "BDAY":
        birthday = parseVcardDate(value.trim())
        break
      case "ANNIVERSARY":
        anniversary = parseVcardDate(value.trim())
        break
      case "NOTE":
        note = unescapeText(value).trim() || null
        break
    }
  }

  // Resolve grouped properties now that every line (value + its trailing X-ABLabel) has been seen.
  const relatedNames: { label: string; name: string }[] = []
  for (const entry of groups.values()) {
    if (!entry.propName || entry.value === null) continue
    const label = entry.label ?? "Other"
    if (entry.propName === "X-ABDATE" && !anniversary && /anniversary/i.test(label)) {
      anniversary = parseVcardDate(entry.value.trim())
    } else if (entry.propName === "X-ABRELATEDNAMES") {
      const name = unescapeText(entry.value).trim()
      if (name) relatedNames.push({ label, name })
    } else if (entry.propName === "ADR") {
      const [, extended, street, city, state, zip, country] = splitStructured(entry.value)
      addresses.push({
        label,
        street: [extended, street].filter(Boolean).join(", ") || null,
        city: city || null,
        state: state || null,
        zip: zip || null,
        country: country || null,
      })
    } else if (entry.propName === "TEL") {
      phones.push({ label, value: entry.value.trim() })
    } else if (entry.propName === "EMAIL") {
      emails.push({ label, value: entry.value.trim() })
    } else if (entry.propName === "URL") {
      urls.push({ label, value: entry.value.trim() })
    }
  }

  const resolvedFullName = fullName ?? ([firstName, middleName, lastName].filter(Boolean).join(" ").trim() || null)
  // Business-only / no-name contacts (e.g. a plumber saved with only a company name) aren't
  // "people" this app tracks — skip the candidate entirely rather than surfacing noise.
  if (!resolvedFullName) return null

  return {
    uid,
    fullName: resolvedFullName,
    firstName,
    lastName,
    middleName,
    nickname,
    organization,
    jobTitle,
    phones,
    emails,
    addresses,
    urls,
    socialProfiles,
    birthday,
    anniversary,
    relatedNames,
    note,
  }
}

export function parseVcf(text: string): VCardContact[] {
  const blocks = text.split(/BEGIN:VCARD/i).slice(1) // first split chunk is anything before the first card
  const contacts: VCardContact[] = []
  for (const block of blocks) {
    const contact = parseVcard("BEGIN:VCARD" + block)
    if (contact) contacts.push(contact)
  }
  return contacts
}
