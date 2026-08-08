import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { upsertReminder } from '../lib/reminders'
import { border, colors, fontFamily, fontSize, radius, space } from '../lib/theme'
import AddressSuggestInput from './AddressSuggestInput'
import EditButton from './EditButton'

// Exported for PetsSection, which reuses LabeledValueEditor below for a pet's free-form "Details"
// rows (Barn, Tank, Vet…) — same {label, value} shape, same editor, no second implementation.
export type LabeledValue = { label: string; value: string }
type Address = { label: string; street: string | null; city: string | null; state: string | null; zip: string | null; country: string | null }
type ContactData = {
  organization: string | null
  job_title: string | null
  phones: LabeledValue[]
  emails: LabeledValue[]
  addresses: Address[]
  urls: LabeledValue[]
  social_profiles: LabeledValue[]
}
type BirthdayLike = { month: number | null; day: number | null; year: number | null }

const EMPTY_CONTACT: ContactData = { organization: null, job_title: null, phones: [], emails: [], addresses: [], urls: [], social_profiles: [] }
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatDate(d: BirthdayLike): string | null {
  if (!d.month || !d.day) return null
  const base = `${MONTH_NAMES[d.month - 1]} ${d.day}`
  return d.year ? `${base}, ${d.year}` : base
}

function hasAnyContactData(d: ContactData, birthday: BirthdayLike, anniversary: BirthdayLike): boolean {
  return (
    !!d.organization ||
    !!d.job_title ||
    d.phones.length > 0 ||
    d.emails.length > 0 ||
    d.addresses.length > 0 ||
    d.urls.length > 0 ||
    d.social_profiles.length > 0 ||
    !!birthday.month ||
    !!anniversary.month
  )
}

// Collapsible "Contact Info" card on a person's profile — organization/title, phones, emails,
// addresses, urls, social profiles (all new `people` columns, 2026-07-27), plus birthday/
// anniversary (existing `reminders` table). Loads via its own isolated query rather than folding
// into PersonDetail's main select, same reasoning as the existing `gender` field: these columns
// depend on a manual migration the founder runs, so isolating the query keeps the rest of the
// profile page working even before that migration lands (a missing column here degrades to an
// empty section, never a blank page). Self-contained: PersonDetail.tsx only needs to render
// <ContactInfoSection personId={personId} readOnly={readOnly} /> — no prop-threading required.
export default function ContactInfoSection({ personId, readOnly = false }: { personId: string; readOnly?: boolean }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ContactData>(EMPTY_CONTACT)
  const [birthday, setBirthday] = useState<BirthdayLike>({ month: null, day: null, year: null })
  const [anniversary, setAnniversary] = useState<BirthdayLike>({ month: null, day: null, year: null })
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ContactData>(EMPTY_CONTACT)
  const [draftBirthday, setDraftBirthday] = useState<BirthdayLike>({ month: null, day: null, year: null })
  const [draftAnniversary, setDraftAnniversary] = useState<BirthdayLike>({ month: null, day: null, year: null })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    load()
  }, [personId])

  async function load() {
    setLoading(true)
    const [peopleRes, remindersRes] = await Promise.all([
      supabase
        .from('people')
        .select('organization, job_title, phones, emails, addresses, urls, social_profiles')
        .eq('id', personId)
        .maybeSingle(),
      supabase.from('reminders').select('label, month, day, year').eq('person_id', personId).in('label', ['Birthday', 'Anniversary']),
    ])
    // Fail-open: a not-yet-migrated database 400s peopleRes.data to null rather than crashing the
    // profile page — this section just renders empty/collapsed in that gap.
    const loaded: ContactData = peopleRes.data
      ? {
          organization: peopleRes.data.organization ?? null,
          job_title: peopleRes.data.job_title ?? null,
          phones: peopleRes.data.phones ?? [],
          emails: peopleRes.data.emails ?? [],
          addresses: peopleRes.data.addresses ?? [],
          urls: peopleRes.data.urls ?? [],
          social_profiles: peopleRes.data.social_profiles ?? [],
        }
      : EMPTY_CONTACT
    const bday = (remindersRes.data ?? []).find((r: any) => r.label === 'Birthday')
    const anniv = (remindersRes.data ?? []).find((r: any) => r.label === 'Anniversary')
    const loadedBirthday = { month: bday?.month ?? null, day: bday?.day ?? null, year: bday?.year ?? null }
    const loadedAnniversary = { month: anniv?.month ?? null, day: anniv?.day ?? null, year: anniv?.year ?? null }
    setData(loaded)
    setBirthday(loadedBirthday)
    setAnniversary(loadedAnniversary)
    setOpen(hasAnyContactData(loaded, loadedBirthday, loadedAnniversary))
    setLoading(false)
  }

  function startEditing() {
    setDraft(data)
    setDraftBirthday(birthday)
    setDraftAnniversary(anniversary)
    setEditing(true)
    setOpen(true)
  }

  async function handleSave() {
    setSaving(true)
    await supabase.from('people').update(draft).eq('id', personId)
    if (draftBirthday.month && draftBirthday.day) {
      await upsertReminder(personId, 'Birthday', draftBirthday)
    }
    if (draftAnniversary.month && draftAnniversary.day) {
      await upsertReminder(personId, 'Anniversary', draftAnniversary)
    }
    setSaving(false)
    setEditing(false)
    await load()
  }

  if (loading) return null
  if (!open && !hasAnyContactData(data, birthday, anniversary) && readOnly) return null

  // Same fix as PetsSection: a full bordered card just for a collapsed "▸ Contact Info" toggle
  // was permanently visible even with nothing on file (founder feedback 2026-08-07). A quiet line
  // replaces it in live mode; clicking it goes straight into the edit form, since that's the only
  // way this section ever gets its first piece of data.
  if (!readOnly && !editing && !hasAnyContactData(data, birthday, anniversary) && !open) {
    return (
      <button type="button" onClick={startEditing} style={styles.quietAdd}>
        + Add contact info
      </button>
    )
  }

  return (
    <div style={styles.section}>
      <div style={styles.headingRow}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={styles.toggleButton}>
          {open ? '▾' : '▸'} Contact Info
        </button>
        {!readOnly && open && !editing && <EditButton label="Edit contact info" onClick={startEditing} />}
      </div>

      {open && !editing && (
        <div style={styles.displayList}>
          {(data.organization || data.job_title) && (
            <p style={styles.displayLine}>{[data.job_title, data.organization].filter(Boolean).join(' at ')}</p>
          )}
          {formatDate(birthday) && <p style={styles.displayLine}>Birthday: {formatDate(birthday)}</p>}
          {formatDate(anniversary) && <p style={styles.displayLine}>Anniversary: {formatDate(anniversary)}</p>}
          {data.phones.map((p, i) => (
            <p key={`phone-${i}`} style={styles.displayLine}>{p.label}: {p.value}</p>
          ))}
          {data.emails.map((e, i) => (
            <p key={`email-${i}`} style={styles.displayLine}>{e.label}: {e.value}</p>
          ))}
          {data.addresses.map((a, i) => (
            <p key={`addr-${i}`} style={styles.displayLine}>
              {a.label}: {[a.street, a.city, a.state, a.zip].filter(Boolean).join(', ')}
            </p>
          ))}
          {data.urls.map((u, i) => (
            <p key={`url-${i}`} style={styles.displayLine}>{u.label}: {u.value}</p>
          ))}
          {data.social_profiles.map((s, i) => (
            <p key={`social-${i}`} style={styles.displayLine}>{s.label}: {s.value}</p>
          ))}
          {!hasAnyContactData(data, birthday, anniversary) && (
            <p style={styles.emptyText}>Nothing on file yet.{!readOnly && ' Tap the edit icon to add birthday, address, and more.'}</p>
          )}
        </div>
      )}

      {open && editing && (
        <div style={styles.editForm}>
          <label style={styles.fieldLabel}>Job title</label>
          <input
            type="text"
            value={draft.job_title ?? ''}
            onChange={(e) => setDraft({ ...draft, job_title: e.target.value || null })}
            style={styles.input}
          />
          <label style={styles.fieldLabel}>Organization</label>
          <input
            type="text"
            value={draft.organization ?? ''}
            onChange={(e) => setDraft({ ...draft, organization: e.target.value || null })}
            style={styles.input}
          />

          <DateFields label="Birthday" value={draftBirthday} onChange={setDraftBirthday} />
          <DateFields label="Anniversary" value={draftAnniversary} onChange={setDraftAnniversary} />

          <LabeledValueEditor label="Phones" items={draft.phones} onChange={(phones) => setDraft({ ...draft, phones })} valuePlaceholder="(555) 555-5555" />
          <LabeledValueEditor label="Emails" items={draft.emails} onChange={(emails) => setDraft({ ...draft, emails })} valuePlaceholder="name@example.com" />
          <AddressEditor items={draft.addresses} onChange={(addresses) => setDraft({ ...draft, addresses })} />
          <LabeledValueEditor label="Websites" items={draft.urls} onChange={(urls) => setDraft({ ...draft, urls })} valuePlaceholder="https://…" />
          <LabeledValueEditor label="Social profiles" items={draft.social_profiles} onChange={(social_profiles) => setDraft({ ...draft, social_profiles })} valuePlaceholder="@handle or URL" />

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

function DateFields({ label, value, onChange }: { label: string; value: BirthdayLike; onChange: (v: BirthdayLike) => void }) {
  return (
    <div style={styles.dateFieldRow}>
      <label style={styles.fieldLabel}>{label}</label>
      <div style={styles.dateInputsRow}>
        <select
          value={value.month ?? ''}
          onChange={(e) => onChange({ ...value, month: e.target.value ? Number(e.target.value) : null })}
          style={styles.dateSelect}
        >
          <option value="">Month</option>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={31}
          value={value.day ?? ''}
          onChange={(e) => onChange({ ...value, day: e.target.value ? Number(e.target.value) : null })}
          placeholder="Day"
          style={styles.dateNumberInput}
        />
        <input
          type="number"
          value={value.year ?? ''}
          onChange={(e) => onChange({ ...value, year: e.target.value ? Number(e.target.value) : null })}
          placeholder="Year (optional)"
          style={styles.dateYearInput}
        />
      </div>
    </div>
  )
}

export function LabeledValueEditor({
  label,
  items,
  onChange,
  valuePlaceholder,
  labelPlaceholder = 'Label (Home, Work…)',
}: {
  label: string
  items: LabeledValue[]
  onChange: (items: LabeledValue[]) => void
  valuePlaceholder: string
  labelPlaceholder?: string
}) {
  const [newLabel, setNewLabel] = useState('')
  const [newValue, setNewValue] = useState('')

  function add() {
    if (!newValue.trim()) return
    onChange([...items, { label: newLabel.trim() || 'Other', value: newValue.trim() }])
    setNewLabel('')
    setNewValue('')
  }

  return (
    <div style={styles.listEditor}>
      <label style={styles.fieldLabel}>{label}</label>
      {items.map((item, i) => (
        <div key={i} style={styles.listRow}>
          <span style={styles.listRowText}>{item.label}: {item.value}</span>
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} style={styles.removeButton}>×</button>
        </div>
      ))}
      <div style={styles.addRow}>
        <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={labelPlaceholder} style={styles.addLabelInput} />
        <input type="text" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={valuePlaceholder} style={styles.addValueInput} />
        <button type="button" onClick={add} style={styles.addButton}>+ Add</button>
      </div>
    </div>
  )
}

function AddressEditor({ items, onChange }: { items: Address[]; onChange: (items: Address[]) => void }) {
  const [newLabel, setNewLabel] = useState('')
  const [newValue, setNewValue] = useState('')

  function add() {
    if (!newValue.trim()) return
    onChange([...items, { label: newLabel.trim() || 'Home', street: newValue.trim(), city: null, state: null, zip: null, country: null }])
    setNewLabel('')
    setNewValue('')
  }

  return (
    <div style={styles.listEditor}>
      <label style={styles.fieldLabel}>Addresses</label>
      {items.map((item, i) => (
        <div key={i} style={styles.listRow}>
          <span style={styles.listRowText}>{item.label}: {[item.street, item.city, item.state, item.zip].filter(Boolean).join(', ')}</span>
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} style={styles.removeButton}>×</button>
        </div>
      ))}
      <div style={styles.addRow}>
        <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label (Home, Work…)" style={styles.addLabelInput} />
        <div style={styles.addAddressInputWrap}>
          <AddressSuggestInput value={newValue} onChange={setNewValue} recentValues={[]} placeholder="Start typing an address…" />
        </div>
        <button type="button" onClick={add} style={styles.addButton}>+ Add</button>
      </div>
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
  displayLine: { fontSize: fontSize.body, color: colors.inkPlain, margin: '0 0 0.3rem' },
  emptyText: { fontSize: fontSize.label, color: colors.textFaintest, margin: 0 },
  editForm: { marginTop: space.lg, display: 'flex', flexDirection: 'column', gap: '0.4rem' },
  fieldLabel: { fontSize: fontSize.small, color: colors.textMuted, marginTop: space.md },
  input: {
    fontSize: fontSize.bodyLg,
    padding: '0.5rem 0.65rem',
    borderRadius: radius.md,
    border: border.default,
    fontFamily,
  },
  dateFieldRow: { display: 'flex', flexDirection: 'column' },
  dateInputsRow: { display: 'flex', gap: '0.4rem' },
  dateSelect: { fontSize: fontSize.body, padding: '0.45rem', borderRadius: radius.md, border: border.default, fontFamily, flex: 2 },
  dateNumberInput: { fontSize: fontSize.body, padding: '0.45rem', borderRadius: radius.md, border: border.default, fontFamily, flex: 1, width: '4rem' },
  dateYearInput: { fontSize: fontSize.body, padding: '0.45rem', borderRadius: radius.md, border: border.default, fontFamily, flex: 1, width: '7rem' },
  listEditor: { display: 'flex', flexDirection: 'column', marginTop: '0.4rem' },
  listRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md, padding: '0.25rem 0' },
  listRowText: { fontSize: '0.88rem', color: colors.inkPlain },
  removeButton: { background: 'none', border: 'none', color: colors.danger, fontSize: fontSize.base, cursor: 'pointer', padding: '0 0.3rem' },
  addRow: { display: 'flex', gap: '0.4rem', marginTop: '0.3rem', alignItems: 'flex-start' },
  addLabelInput: { fontSize: fontSize.label, padding: '0.4rem 0.5rem', borderRadius: radius.md, border: border.default, fontFamily, width: '6.5rem', flexShrink: 0 },
  addValueInput: { fontSize: fontSize.label, padding: '0.4rem 0.5rem', borderRadius: radius.md, border: border.default, fontFamily, flex: 1, minWidth: 0 },
  addAddressInputWrap: { flex: 1, minWidth: 0 },
  addButton: {
    fontSize: fontSize.label,
    padding: '0.4rem 0.7rem',
    borderRadius: radius.md,
    border: border.primary,
    backgroundColor: colors.surface,
    color: colors.ink,
    cursor: 'pointer',
    fontFamily,
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  buttonRow: { display: 'flex', gap: '0.6rem', marginTop: space.lg },
  saveButton: {
    fontSize: fontSize.body,
    padding: '0.5rem 1rem',
    borderRadius: radius.md,
    border: 'none',
    backgroundColor: colors.primary,
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
