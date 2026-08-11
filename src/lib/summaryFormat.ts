// Turns a stored event summary into blocks the page can style, instead of dumping it as one
// pre-wrap wall of text.
//
// Why this exists (founder ask 2026-08-10, on the Defenders of Freedom event): a PARENT event's
// summary is written by `summarize-moment` in a fixed shape — an overview paragraph, a blank line,
// then exactly one line per sub-event formatted `<short date> · <sub-event title> — <one sentence>`.
// That shape carries real structure, but rendered as plain text every line looked identical to
// every other, so a six-day event read as an undifferentiated block and the dates/titles were
// invisible at a glance.
//
// The fix is entirely on the rendering side: the edge function's prompt (and therefore its cached
// prefix, CLAUDE.md rule 3) is untouched, and no summary needs regenerating — we just recognise the
// format the model already emits and let the page bold the title and set the date apart.
//
// Deliberately conservative: anything that isn't confidently a sub-event line stays a plain
// paragraph, so an ordinary single-event summary (prose, no sub-events) renders exactly as before.

export type SummaryBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'subEvent'; date: string; title: string; body: string }

// The prompt asks for `·` and `—` specifically, but models drift on punctuation, so accept the
// obvious near-misses rather than silently falling back to the old flat rendering.
const DOT_SEPARATORS = ['·', '•']
const DASH_SEPARATORS = ['—', '–', ' - ']

// A date cell is short, made of the characters a date is made of, and carries a number ("Aug 6",
// "Aug 6-7", "Aug 6, 2026") — plus the one wording the prompt uses when a sub-event has no date.
// The digit requirement is what keeps an ordinary prose sentence that happens to contain a "·"
// ("we drove to the lake · which took an hour — then set up") from being read as a sub-event line.
const DATE_LIKE = /^[A-Za-z0-9][A-Za-z0-9 ,.'/-]*\d[A-Za-z0-9 ,.'/-]*$/
const NO_DATE_TEXT = /^date not set$/i

function findFirst(haystack: string, needles: string[]): { index: number; length: number } | null {
  let best: { index: number; length: number } | null = null
  for (const needle of needles) {
    const index = haystack.indexOf(needle)
    if (index !== -1 && (best === null || index < best.index)) best = { index, length: needle.length }
  }
  return best
}

/**
 * Parses one line as `<date> · <title> — <body>`, or returns null if it isn't that shape.
 *
 * The body is split on the FIRST dash after the title, never the last — a sub-event sentence very
 * often contains an em dash of its own ("his family — wife Ariel and the kids"), and splitting on
 * the last one would swallow most of the sentence into the title.
 */
export function parseSubEventLine(line: string): { date: string; title: string; body: string } | null {
  const dot = findFirst(line, DOT_SEPARATORS)
  if (!dot) return null

  const date = line.slice(0, dot.index).trim()
  if (!date || date.length > 24) return null
  if (!DATE_LIKE.test(date) && !NO_DATE_TEXT.test(date)) return null

  const rest = line.slice(dot.index + dot.length)
  const dash = findFirst(rest, DASH_SEPARATORS)
  if (!dash) return null

  const title = rest.slice(0, dash.index).trim()
  const body = rest.slice(dash.index + dash.length).trim()
  if (!title || !body) return null

  return { date, title, body }
}

/**
 * Splits a summary into paragraphs and sub-event rows.
 *
 * Consecutive plain lines are joined back into one paragraph (a hard-wrapped paragraph is still one
 * paragraph); a blank line starts a new one. A summary with no sub-event lines comes back as plain
 * paragraphs, which render the same as they always did.
 */
export function parseSummaryBlocks(summary: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = []
  let paragraph: string[] = []

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
      paragraph = []
    }
  }

  for (const rawLine of summary.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }
    const subEvent = parseSubEventLine(line)
    if (subEvent) {
      flush()
      blocks.push({ kind: 'subEvent', ...subEvent })
    } else {
      paragraph.push(line)
    }
  }
  flush()

  return blocks
}

/** True when the summary actually has the sub-event shape worth styling as a list. */
export function hasSubEventBlocks(blocks: SummaryBlock[]): boolean {
  return blocks.some((b) => b.kind === 'subEvent')
}
