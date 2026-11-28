import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountRows } from '../src/account-rows.js'

const render = (
  accounts: readonly { readonly id: string; readonly name: string }[],
  quotas: ReadonlyMap<string, { readonly percent: number; readonly label: string; readonly onReserve: boolean }>,
): string => renderToStaticMarkup(<AccountRows accents={new Map()} accounts={accounts} onChoose={() => undefined} quotas={quotas} selected={accounts[0]?.id} />)

describe('an unknown quota reads one way (council picker round 5, U9)', () => {
  it('draws a muted dash in the account rows, as the fallbacks do', () => {
    const html = render(
      [
        { id: 'codex', name: 'Codex 1' },
        { id: 'cc1', name: 'Command Code 1' },
      ],
      new Map([['cc1', { percent: 62, label: 'Weekly limit', onReserve: false }]]),
    )
    expect(html).toContain('>—<')
    expect(readFileSync(new URL('../src/fallbacks-section.tsx', import.meta.url), 'utf8')).toContain("row.quota === undefined ? '—'")
  })

  it('ends a single account value in the same column as the rows: 48 px right-aligned, then the check slot', () => {
    const html = render([{ id: 'cc2', name: 'Command Code 2' }], new Map([['cc2', { percent: 12, label: 'Weekly limit', onReserve: false }]]))
    expect(/<span[^>]*data-model-account-quota[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:w-12 dshx:shrink-0 dshx:text-right/u)
    expect(html).toMatch(/<\/span><\/span><span aria-hidden="true" class="dshx:w-3\.5 dshx:shrink-0"><\/span><\/div>/u)
  })
})
