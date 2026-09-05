import { describe, expect, it } from 'vitest'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HomeView, type ChatMessage } from './Home'

// The one promise this file guards: when a save didn't land, the user is TOLD, in the thread, right
// under the reply that said otherwise.
//
// This exists because the bug shipped twice. First the server lost the note silently; then the fix
// for it was verified in a browser that turned out to be serving a different session's checkout, so
// the notice was never actually rendered under test and a wiring gap went unnoticed. A render test
// can't be pointed at the wrong copy of the code.
//
// Rendered with renderToStaticMarkup rather than a DOM: this is about what reaches the screen, and
// static markup is enough to answer that without pulling in a testing-library.
function render(thread: ChatMessage[]): string {
  // Entities decoded so assertions can be written the way the sentence actually reads. React
  // escapes apostrophes to `&#x27;`, which silently fails a `toContain("couldn't ...")` and looks
  // exactly like the notice not rendering at all.
  return renderMarkup(thread).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

function renderMarkup(thread: ChatMessage[]): string {
  return renderToStaticMarkup(
    <HomeView
      thread={thread}
      sending={false}
      input=""
      onInputChange={() => {}}
      onSend={() => {}}
      onSuggestionClick={() => {}}
      stats={null}
      recallAssists={null}
      leaderboard={[]}
      suggestions={[]}
      suggestionsLoading={false}
      onRefreshSuggestions={() => {}}
      relationshipSuggestions={[]}
      setRelationshipSuggestions={() => {}}
      newPersonSuggestions={[]}
      setNewPersonSuggestions={() => {}}
      onSelectPerson={() => {}}
      onSelectEvent={() => {}}
      onSelectGroup={() => {}}
      onSelectDunbar={() => {}}
      onSelectNudges={() => {}}
      onNavigateTab={() => {}}
      onOpenReviewInbox={() => {}}
      bottomRef={createRef<HTMLDivElement>()}
    />
  )
}

const NOTICE = "couldn't save that one"

describe('HomeView save-failure notice', () => {
  it('warns when a save did not land', () => {
    const html = render([
      { role: 'user', content: 'I rotated the tires today.' },
      { role: 'assistant', content: 'Got it — logged that for you.', saveFailed: true },
    ])
    expect(html).toContain(NOTICE)
  })

  it('still shows the reply itself, rather than replacing it', () => {
    // The reply has already been streamed and read by the time we know the save failed. Silently
    // swapping it for an error would be its own dishonesty — the correction goes underneath.
    const html = render([{ role: 'assistant', content: 'Got it — logged that for you.', saveFailed: true }])
    expect(html).toContain('Got it — logged that for you.')
    expect(html.indexOf('Got it')).toBeLessThan(html.indexOf(NOTICE))
  })

  it('stays quiet on an ordinary successful turn', () => {
    const html = render([
      { role: 'user', content: 'I rotated the tires today.' },
      { role: 'assistant', content: 'Got it — logged that for you.' },
    ])
    expect(html).not.toContain(NOTICE)
  })

  it('stays quiet on a question, where there was nothing to save', () => {
    // `nothing_to_save` is a success. Warning here would train the user to ignore the warning.
    const html = render([
      { role: 'user', content: 'What concerts are in my records?' },
      { role: 'assistant', content: 'Here are the concerts I have on file...', saveFailed: false },
    ])
    expect(html).not.toContain(NOTICE)
  })

  it('warns on the failed turn only, not on earlier good ones', () => {
    const html = render([
      { role: 'assistant', content: 'First one saved fine.' },
      { role: 'assistant', content: 'Second one did not.', saveFailed: true },
    ])
    expect(html.match(new RegExp(NOTICE, 'g'))).toHaveLength(1)
  })
})
