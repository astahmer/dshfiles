import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelRow } from '../src/model-row.js'

const row = (selectSeveral: boolean): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        accountTag="CC1"
        active={false}
        busy={false}
        current={null}
        fanOutSelected={false}
        group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
        id="list-0"
        model={{ id: 'gemini-3.8-flash', name: 'gemini-3.8-flash', description: '' }}
        onFanOut={() => undefined}
        onInspect={() => undefined}
        onSelect={() => undefined}
        providerLabel="Command Code"
        quota={undefined}
        selectSeveral={selectSeveral}
      />
    </TooltipProvider>,
  )

describe('details are reachable without the Right key (council picker round 3, R10)', () => {
  it('makes the chevron a named button of its own, beside the option, 44 pt on touch', () => {
    const html = row(false)
    const chevron = /<button[^>]*data-model-details-trigger[^>]*>/u.exec(html)?.[0] ?? ''
    expect(chevron).toContain('aria-label="Details for gemini-3.8-flash"')
    expect(chevron).not.toContain('aria-hidden')
    expect(chevron).toMatch(/dshx:pointer-coarse:size-11/u)
    // Outside the option: the option's element closes before the chevron starts.
    const option = /<div[^>]*role="option"[^>]*>/u.exec(html)
    expect(option).not.toBeNull()
    let depth = 0
    let end = -1
    for (const tag of html.slice(option?.index ?? 0).matchAll(/<(\/?)div\b[^>]*>/gu)) {
      depth += tag[1] === '/' ? -1 : 1
      if (depth === 0) {
        end = (option?.index ?? 0) + (tag.index ?? 0)
        break
      }
    }
    expect(end).toBeGreaterThan(-1)
    expect(html.indexOf('data-model-details-trigger')).toBeGreaterThan(end)
    // The row wrapper adds no role of its own inside the listbox.
    expect(/<div[^>]*data-model-picker-row[^>]*>/u.exec(html)?.[0]).toContain('role="presentation"')
  })

  it('names select-mode options without "Use", since a tap there chooses, not uses', () => {
    expect(/<div[^>]*role="option"[^>]*>/u.exec(row(true))?.[0]).toContain('aria-label="gemini-3.8-flash, Command Code 1"')
    // Round 4 T12: the same short name outside select mode.
    expect(/<div[^>]*role="option"[^>]*>/u.exec(row(false))?.[0]).toContain('aria-label="gemini-3.8-flash, Command Code 1"')
  })
})
