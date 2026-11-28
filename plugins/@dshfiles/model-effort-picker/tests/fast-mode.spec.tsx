import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FastModeRow } from '../src/fast-mode-section.js'
import { ModelRow } from '../src/model-row.js'

const source = (name: string): string => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
const text = (html: string): string => html.replace(/<[^>]+>/gu, '')

const row = (fastOn: boolean): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        active={false}
        busy={false}
        current={null}
        fanOutSelected={false}
        fastOn={fastOn}
        group={{ id: 'codex', name: 'Codex 1', models: [] }}
        model={{ id: 'gpt-6-luna', name: 'GPT-6 Luna', description: '' }}
        onFanOut={() => undefined}
        onInspect={() => undefined}
        onSelect={() => undefined}
        providerLabel="Codex"
        quota={undefined}
      />
    </TooltipProvider>,
  )

describe('Fast mode is one visible, labelled control (council picker C2)', () => {
  it('is a labelled row with the kit switch at its end, 28×16 drawn, 32 px tall and 44 px on touch', () => {
    const html = renderToStaticMarkup(<FastModeRow disabled={false} enabled error={null} onChange={() => undefined} />)
    expect(text(html)).toContain('Fast mode · may cost more')
    const control = /<button[^>]*role="switch"[^>]*>/u.exec(html)?.[0] ?? ''
    expect(control).toContain('aria-checked="true"')
    expect(control).toMatch(/dshx:h-4 dshx:w-7/u)
    // The visible label names the switch; no tooltip trigger sits on it to overwrite its state.
    expect(control).not.toContain('tooltip-trigger')
    expect(html).toMatch(/<label[^>]*for="[^"]+"/u)
    expect(html).toMatch(/dshx:min-h-8 [^"]*dshx:pointer-coarse:min-h-11/u)
  })

  it('drops the per-row hover switch; a route with Fast mode on shows a static ink bolt', () => {
    expect(source('model-row.tsx')).not.toMatch(/data-model-fast-mode-inline|<Switch/u)
    expect(row(false)).not.toContain('data-model-fast-on')
    const bolt = /<svg[^>]*data-model-fast-on[^>]*>/u.exec(row(true))?.[0] ?? ''
    expect(bolt).toMatch(/dshx:size-3 dshx:text-foreground/u)
    expect(bolt).not.toMatch(/text-warning/u)
  })

  it('draws the composer bolt in ink, never amber (amber means low quota)', () => {
    const indicator = source('model-effort-picker.tsx').slice(source('model-effort-picker.tsx').indexOf('const FastModeIndicator'))
    expect(indicator.slice(0, indicator.indexOf('export const ModelEffortPicker'))).not.toMatch(/text-warning/u)
  })
})
