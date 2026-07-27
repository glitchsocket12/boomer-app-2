import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

// iCloud/Mac Contacts vCard exports embed a full-resolution photo per contact by default (per
// the instructions on this page) — the parser never reads PHOTO/LOGO/SOUND, so for a few hundred
// contacts that's tens of MB of dead weight that can push the upload past the Edge Function's
// request-size limit. Stripped client-side, before the file is ever base64-encoded, so it never
// leaves the browser. Continuation (folded) lines start with a space/tab per RFC6350 §3.2 — those
// have to be dropped along with the property line they belong to, not just the property line itself.
function stripBinaryProps(text: string): string {
  const rawLines = text.split(/\r\n|\n|\r/)
  const kept: string[] = []
  let dropping = false
  for (const line of rawLines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (!dropping) kept.push(line)
      continue
    }
    dropping = /^(?:item\d+\.)?(PHOTO|LOGO|SOUND)(;|:)/i.test(line)
    if (!dropping) kept.push(line)
  }
  return kept.join('\r\n')
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// Upload entry point for the contacts-import feature. Deliberately separate from
// CalendarSettings.tsx (that page is scoped to iCal-URL calendar sources, a recurring sync — this
// is a one-time file upload with a completely different data shape). Nothing gets created from
// this upload alone: it only stages parsed contacts as 'pending' candidates, which the founder
// then curates on the selection page before anything ever reaches a real person record.
export default function ContactsImport({
  onBack,
  backLabel,
  onImported,
}: {
  onBack: () => void
  backLabel: string
  onImported: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelected(file: File) {
    setUploading(true)
    setError(null)
    try {
      const rawText = await readFileAsText(file)
      const fileData = textToBase64(stripBinaryProps(rawText))
      const { data, error: invokeError } = await supabase.functions.invoke('import-contacts', { body: { fileData } })
      if (invokeError || data?.error) {
        setUploading(false)
        setError("Couldn't read that file — make sure it's a vCard (.vcf) export and try again.")
        return
      }
      onImported()
    } catch {
      setUploading(false)
      setError("Something went wrong reading that file — please try again.")
    }
  }

  return (
    <div style={styles.page}>
      <button onClick={onBack} style={styles.backButton}>← Back to {backLabel}</button>

      <h1 style={styles.heading}>Import contacts</h1>
      <p style={styles.intro}>
        Bring in birthdays, addresses, and everything else on file for the people in your phone's
        Contacts app. Nothing is added automatically — after uploading, you'll pick exactly who you
        want to bring in before anything is saved.
      </p>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Export your contacts</h2>
        <p style={styles.body}>
          On a Mac or PC, go to <strong>icloud.com/contacts</strong>, sign in, select all contacts
          (⌘A or Ctrl+A), click the gear icon in the bottom-left, and choose{' '}
          <strong>Export vCard</strong>. That downloads one file (ending in <code>.vcf</code>)
          containing everyone — upload it below.
        </p>
        <p style={styles.body}>
          (The Mac Contacts app works too: select all contacts, then File → Export → Export vCard.)
        </p>
      </section>

      <section style={styles.section}>
        <h2 style={styles.sectionHeading}>Upload the file</h2>
        <input
          ref={fileInputRef}
          type="file"
          accept=".vcf,text/vcard"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFileSelected(file)
          }}
          disabled={uploading}
          style={styles.fileInput}
        />
        {uploading && <p style={styles.body}>Reading your contacts…</p>}
        {error && <p style={styles.errorText}>{error}</p>}
      </section>
    </div>
  )
}

const styles: { [key: string]: React.CSSProperties } = {
  page: { maxWidth: '840px', margin: '0 auto', padding: '1rem 1.5rem 2rem', fontFamily: 'Georgia, serif' },
  backButton: { background: 'none', border: 'none', color: '#2E4034', fontSize: '1rem', cursor: 'pointer', marginBottom: '1rem', padding: 0 },
  heading: { fontSize: '2rem', color: '#2E4034', margin: '0 0 0.5rem' },
  intro: { fontSize: '0.95rem', color: '#666', lineHeight: 1.5, margin: '0 0 1.25rem' },
  section: {
    backgroundColor: '#FFF',
    border: '1px solid #CFE0D6',
    borderRadius: '10px',
    padding: '1rem 1.1rem',
    marginBottom: '1rem',
  },
  sectionHeading: { fontSize: '1.1rem', color: '#2E4034', margin: '0 0 0.5rem' },
  body: { fontSize: '0.9rem', color: '#666', lineHeight: 1.5, margin: '0 0 0.75rem' },
  fileInput: { fontSize: '0.9rem', fontFamily: 'Georgia, serif' },
  errorText: { color: '#B04A3B', fontSize: '0.85rem', margin: '0.5rem 0 0' },
}
