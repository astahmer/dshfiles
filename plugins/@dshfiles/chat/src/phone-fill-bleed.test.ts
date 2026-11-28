import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Upstream 534773f0 (eef66269) gave the phone's flow items `content-visibility: auto`, which clips paint to each item's
 * padding box. On a phone the transcript's fills (a code card, the prompt bubble) bleed 12px out of the text column, so
 * the clip cut the card's rounded corners, its right edge and half its copy button. The item reaches the fill edge with
 * a padding that keeps its content box where it was.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
const chatView = read('./native/chat/ChatView.module.css')
const markdown = read('./native/chat/AssistantMarkdown.module.css')
const message = read('./native/chat/MessageItem.module.css')

/** The body of the `@media` block whose query is `query`. */
const mediaBlock = (css: string, query: string): string => {
  const start = css.indexOf(`@media ${query} {`)
  if (start === -1) return ''
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(start, index + 1)
  }
  return ''
}

/** The declarations of the rule whose selector is exactly `selector` inside `scope`. */
const declarations = (scope: string, selector: string): Readonly<Record<string, string>> => {
  const rule = [...scope.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].find(([, selectors]) => selectors?.trim() === selector)
  return Object.fromEntries(
    (rule?.[2] ?? '')
      .split(';')
      .map(line => line.split(':').map(part => part.trim()))
      .filter((pair): pair is [string, string] => pair.length === 2 && pair[0] !== ''),
  )
}

const PHONE = ':global(html[data-shell-phone-nav])'
const FILL_QUERY = '(max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'
const CONTAINED_QUERY = '(max-width: 639.98px)'

describe('phone transcript fills under content-visibility', () => {
  const bleed = declarations(mediaBlock(markdown, FILL_QUERY), `${PHONE} .body :global([data-dsh-markdown] .md-code-block)`)['margin-inline']
  const contained = mediaBlock(chatView, CONTAINED_QUERY)

  it('keeps the code card and prompt bubble bleed this guards', () => {
    expect(bleed).toBe('-12px')
    expect(declarations(mediaBlock(message, FILL_QUERY), `${PHONE} .userStack`)['margin-right']).toBe(bleed)
  })

  it('keeps upstream containment on the phone flow item', () => {
    expect(declarations(contained, '.flowItem')).toMatchObject({ 'content-visibility': 'auto', 'contain-intrinsic-size': 'auto 96px' })
  })

  it('widens the contained item by the bleed so its clip edge is the fill edge', () => {
    const item = declarations(contained, `${PHONE} .flowItem`)
    expect(item['margin-inline']).toBe(bleed)
    expect(item['padding-inline']).toBe(bleed?.replace(/^-/u, ''))
  })
})
