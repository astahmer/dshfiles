import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountRows } from '../src/account-rows.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const tagOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>', at))
}
const rows = (): string =>
  renderToStaticMarkup(
    <AccountRows
      accents={new Map()}
      accounts={[
        { id: 'cc1', name: 'Command Code 1' },
        { id: 'cc2', name: 'Command Code 2' },
      ]}
      onChoose={() => undefined}
      quotas={new Map([['cc1', { percent: 62, label: 'Weekly limit', onReserve: false }]])}
      selected="cc1"
    />,
  )

describe('one inspector gutter (council picker round 3, R13)', () => {
  it('starts every section heading on the same left edge', () => {
    expect(/<div[^>]*data-model-accounts-heading[^>]*>/u.exec(rows())?.[0]).not.toMatch(/dshx:px-|dshx:pl-/u)
    expect(tagOf(source('fallbacks-section.tsx'), 'data-model-fallbacks-toggle')).toMatch(/dshx:px-0/u)
    expect(tagOf(source('fallbacks-section.tsx'), 'data-model-fallback-policy')).not.toMatch(/dshx:px-/u)
  })

  it('ends "Weekly quota left" where the quota values end: the rows\' 8 px inset, 14 px check column and 8 px gap', () => {
    const html = rows()
    expect(/<div[^>]*data-model-accounts-heading[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:pr-7\.5/u)
    expect(/<button[^>]*role="radio"[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:gap-2 [^"]*dshx:px-2/u)
    expect(html).toMatch(/<span class="dshx:flex dshx:w-3\.5 dshx:shrink-0 dshx:justify-center">/u)
  })

  it("top-aligns the phone details header, Back and Close in 44 pt boxes on the title's first line", () => {
    const header = tagOf(source('model-details.tsx'), 'data-model-details-header')
    expect(header).toMatch(/dshx:items-start/u)
    expect(header).not.toMatch(/items-center/u)
    expect(tagOf(source('model-details.tsx'), 'data-model-details-back')).toMatch(/dshx:pointer-coarse:size-11/u)
    expect(tagOf(source('model-effort-picker.tsx'), 'aria-label="Close model picker"')).toMatch(/dshx:pointer-coarse:size-11/u)
  })
})
