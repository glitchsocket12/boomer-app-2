// Notebook entries are written in a real editor (see components/RichTextEditor.tsx), so `content`
// holds HTML. Three jobs live here, and they exist for three different reasons:
//
// 1. `htmlToPlainText` — what SEARCH and the AI read. Neither should ever see a tag: search would
//    match "strong" inside every bold word, and shipping markup to Claude is tokens spent on
//    punctuation. The result is written to `notebook_entries.content_text` at save time rather
//    than derived on read, because `converse` runs on Deno where there is no DOM to parse with.
// 2. `sanitizeHtml` — what RENDER trusts. TipTap already drops anything outside its schema on the
//    way in, so this guards the other doors: a row written before the editor existed, a paste path
//    that changes in a future version, or anything hand-edited into the database.
// 3. `isHtml` — tells a legacy plain-text entry from an edited one, so the ones written before this
//    feature still render with their line breaks intact instead of collapsing into one line.

/** Tags the renderer will emit. Everything else is unwrapped (children kept) or dropped. */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR', 'A',
])

/** Block-level tags that should become a line break when flattened to plain text. */
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'DIV'])

/**
 * Does this look like editor output rather than something typed before the editor existed?
 *
 * Deliberately conservative: a plain entry that happens to contain "<" (e.g. "cost < $20") has no
 * closing tag, so it stays plain text and keeps its line breaks.
 */
export function isHtml(content: string): boolean {
  return /<\/?(p|br|h[1-6]|ul|ol|li|strong|em|u|s|del|b|i|blockquote|code|pre|hr|a)\b[^>]*>/i.test(content)
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Strip markup down to the words. Block elements become newlines so the AI reads a list as a list
 * rather than as one run-on sentence.
 */
export function htmlToPlainText(content: string): string {
  if (!content) return ''
  if (!isHtml(content)) return content.trim()

  const doc = new DOMParser().parseFromString(content, 'text/html')
  let out = ''

  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? ''
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    if (el.tagName === 'BR') {
      out += '\n'
      return
    }
    const isBlock = BLOCK_TAGS.has(el.tagName)
    // A bullet reads as a bullet to the model too — without this a three-item list arrives as one
    // sentence with no separators.
    if (el.tagName === 'LI') out += '- '
    for (const child of Array.from(el.childNodes)) walk(child)
    if (isBlock) out += '\n'
  }

  for (const child of Array.from(doc.body.childNodes)) walk(child)

  // Collapse the runs of blank lines the block rule produces, and trim the trailing one.
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Only these protocols may appear in an href — blocks `javascript:` and `data:` URLs. */
function safeHref(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null
}

/**
 * Allowlist sanitizer. Unknown ELEMENTS are unwrapped rather than deleted so no words are lost —
 * a `<span>` someone pasted keeps its text. Script/style are removed outright, contents and all,
 * since their "text" is code.
 */
export function sanitizeHtml(content: string): string {
  if (!content) return ''
  const doc = new DOMParser().parseFromString(content, 'text/html')

  function clean(parent: Element) {
    for (const child of Array.from(parent.children)) {
      if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'IFRAME') {
        child.remove()
        continue
      }
      clean(child)
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes))
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        if (child.tagName === 'A' && attr.name.toLowerCase() === 'href') continue
        child.removeAttribute(attr.name)
      }
      if (child.tagName === 'A') {
        const href = safeHref(child.getAttribute('href'))
        if (!href) {
          // A link we won't follow is still text worth keeping.
          child.replaceWith(...Array.from(child.childNodes))
          continue
        }
        child.setAttribute('href', href)
        child.setAttribute('target', '_blank')
        child.setAttribute('rel', 'noopener noreferrer nofollow')
      }
    }
  }

  clean(doc.body)
  return doc.body.innerHTML
}

/**
 * What NotebookDetail renders. Editor output is sanitized; anything written before the editor
 * existed is escaped and given `<br>`s so its line breaks survive.
 */
export function toRenderableHtml(content: string): string {
  if (!content) return ''
  if (!isHtml(content)) return escapeHtml(content).replace(/\n/g, '<br>')
  return sanitizeHtml(content)
}

/** True when an editor value carries no actual words — TipTap's "empty" is `<p></p>`, not ''. */
export function isBlankHtml(content: string): boolean {
  return htmlToPlainText(content).trim().length === 0
}
