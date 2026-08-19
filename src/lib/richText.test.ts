// @vitest-environment happy-dom
//
// The only test file in this repo that needs a DOM, so the environment is set here rather than in
// vite.config.ts — every other test stays on the faster node environment. `happy-dom` is a
// devDependency and never reaches the bundle.

import { describe, expect, it } from 'vitest'
import { escapeHtml, htmlToPlainText, isBlankHtml, isHtml, sanitizeHtml, toRenderableHtml } from './richText'

describe('isHtml', () => {
  it('recognises editor output', () => {
    expect(isHtml('<p>Tampopo</p>')).toBe(true)
    expect(isHtml('<ul><li>one</li></ul>')).toBe(true)
  })

  it('leaves plain text written before the editor existed alone', () => {
    expect(isHtml('Tampopo. Slow, funny, all about food.')).toBe(false)
    // The trap: a stray "<" in ordinary prose must not be mistaken for markup, or the entry gets
    // parsed as HTML and its line breaks silently vanish.
    expect(isHtml('cost < $20 and worth it')).toBe(false)
    expect(isHtml('3 < 5 > 2')).toBe(false)
  })
})

describe('htmlToPlainText', () => {
  it('strips tags so search never matches a tag name', () => {
    // Without this, searching "strong" would hit every bold word in the account.
    expect(htmlToPlainText('<p>A <strong>great</strong> film</p>')).toBe('A great film')
  })

  it('turns blocks into line breaks', () => {
    expect(htmlToPlainText('<p>One</p><p>Two</p>')).toBe('One\nTwo')
    expect(htmlToPlainText('<p>One<br>Two</p>')).toBe('One\nTwo')
  })

  it('marks list items so the AI reads a list as a list', () => {
    expect(htmlToPlainText('<ul><li>Tampopo</li><li>Heat</li></ul>')).toBe('- Tampopo\n- Heat')
  })

  it('decodes entities rather than leaking them into the prompt', () => {
    expect(htmlToPlainText('<p>Fish &amp; chips</p>')).toBe('Fish & chips')
  })

  it('passes legacy plain text through untouched', () => {
    expect(htmlToPlainText('Just a line')).toBe('Just a line')
  })

  it('collapses the blank-line runs the block rule produces', () => {
    expect(htmlToPlainText('<h2>Title</h2><p>Body</p>')).toBe('Title\nBody')
  })
})

describe('sanitizeHtml', () => {
  it('drops script and style entirely, contents included', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>')
    expect(sanitizeHtml('<style>body{display:none}</style><p>ok</p>')).toBe('<p>ok</p>')
  })

  it('strips every attribute except a safe href', () => {
    expect(sanitizeHtml('<p onclick="alert(1)">hi</p>')).toBe('<p>hi</p>')
    expect(sanitizeHtml('<strong style="color:red">hi</strong>')).toBe('<strong>hi</strong>')
  })

  it('refuses javascript: and data: urls but keeps the words', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe('click')
    expect(sanitizeHtml('<a href="data:text/html,<script>">click</a>')).toBe('click')
  })

  it('keeps a real link and makes it safe to open', () => {
    const out = sanitizeHtml('<a href="https://example.com">site</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
  })

  it('unwraps unknown elements instead of deleting the words inside them', () => {
    expect(sanitizeHtml('<div><span>kept</span></div>')).toBe('kept')
  })

  it('keeps the formatting the editor actually produces', () => {
    const html = '<h2>Trip</h2><ul><li><p><em>Day one</em></p></li></ul><blockquote><p>quote</p></blockquote>'
    expect(sanitizeHtml(html)).toBe(html)
  })
})

describe('toRenderableHtml', () => {
  it('escapes legacy plain text so it can never render as markup', () => {
    expect(toRenderableHtml('a < b & c')).toBe('a &lt; b &amp; c')
  })

  it('keeps legacy line breaks visible', () => {
    expect(toRenderableHtml('one\ntwo')).toBe('one<br>two')
  })
})

describe('isBlankHtml', () => {
  it('treats the editor idle document as empty', () => {
    // TipTap's "nothing written" is <p></p>, not '' — Save must stay disabled for it.
    expect(isBlankHtml('<p></p>')).toBe(true)
    expect(isBlankHtml('')).toBe(true)
    expect(isBlankHtml('<p>   </p>')).toBe(true)
  })

  it('is false once there are real words', () => {
    expect(isBlankHtml('<p>x</p>')).toBe(false)
  })
})

describe('escapeHtml', () => {
  it('covers the characters that would break out of a text node', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
  })
})
