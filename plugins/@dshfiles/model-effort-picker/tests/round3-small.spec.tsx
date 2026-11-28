import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountRows } from '../src/account-rows.js'
import { ListEmptyState } from '../src/empty-state.js'
import { FastModeRow } from '../src/fast-mode-section.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const picker = source('model-effort-picker.tsx')
const tagOf = (text: string, marker: string): string => {
  const at = text.indexOf(marker)
  return text.slice(text.lastIndexOf('<', at), text.indexOf('>', at))
}

describe('round 3 smaller fixes (council picker R18)', () => {
  it('draws one search focus ring: the field edge does not also turn accent', () => {
    expect(tagOf(picker, 'data-model-picker-search')).toContain('dshx:has-[input:focus-visible]:border-transparent')
  })

  it('offers a clear button inside the search once there is a query, 44 pt on touch', () => {
    expect(picker).toMatch(/\{query === '' \? null : \(\s*<button\s+aria-label="Clear search"/u)
    expect(tagOf(picker, 'data-model-search-clear')).toMatch(/dshx:pointer-coarse:size-11/u)
  })

  it('keeps 4 px between the Fast bolt and the brand mark on a phone bar', () => {
    expect(picker).toMatch(/dshx:in-data-model-mark:mr-1" data-model-fast-mode-enabled/u)
  })

  it('shows no quota column of dashes when no account has a quota', () => {
    const html = renderToStaticMarkup(
      <AccountRows accents={new Map()} accounts={[{ id: 'codex', name: 'Codex 1' }]} onChoose={() => undefined} quotas={new Map()} selected="codex" />,
    )
    expect(html).not.toContain('data-model-account-quota')
    expect(html).not.toContain('—')
  })

  it('disables the search on an empty catalog and centres the message in the list room', () => {
    expect(tagOf(picker, 'data-model-picker-search')).toContain('disabled={catalogEmpty}')
    const html = renderToStaticMarkup(<ListEmptyState kind="no-models" onClearSearch={() => undefined} query="" />)
    expect(/<div[^>]*data-model-picker-empty[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:flex-1[^"]*dshx:justify-center/u)
    expect(picker.indexOf('<ListEmptyState')).toBeGreaterThan(picker.indexOf('</ScrollArea>'))
  })

  it('names the route by the account alone ("Command Code 1", not "Command Code · Command Code 1")', () => {
    expect(source('model-details.tsx')).not.toContain("[providerLabel, group.name].filter(Boolean).join(' · ')")
  })

  it("draws the Fast switch at the kit's 28×16, its thumb 14 px", () => {
    const control =
      /<button[^>]*role="switch"[^>]*>/u.exec(renderToStaticMarkup(<FastModeRow disabled={false} enabled error={null} onChange={() => undefined} />))?.[0] ?? ''
    expect(control).toMatch(/dshx:data-\[size=sm\]:h-4! dshx:data-\[size=sm\]:w-7! dshx:\*:data-\[slot=switch-thumb\]:size-3\.5!/u)
  })
})
