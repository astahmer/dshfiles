import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelDetails } from '../src/model-details.js'
import { ModelRow } from '../src/model-row.js'

const row = (input: { readonly highlighted?: boolean; readonly inspected?: boolean; readonly active?: boolean }): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        active={input.active ?? false}
        busy={false}
        current={null}
        fanOutSelected={false}
        group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
        highlighted={input.highlighted ?? false}
        model={{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }}
        onFanOut={() => undefined}
        onInspect={() => undefined}
        onSelect={() => undefined}
        providerLabel="Command Code"
        quota={undefined}
      />
    </TooltipProvider>,
  )
const rowTag = (html: string): string => /<div[^>]*data-model-picker-row[^>]*>/u.exec(html)?.[0] ?? ''

describe('the active and the inspected rows are marked (council picker round 3, R11)', () => {
  it('washes the active option (what Enter uses) whenever the search points at it, not only after an arrow key', () => {
    const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')
    expect(picker).toContain('highlighted={index === activeIndex}')
    expect(rowTag(row({ highlighted: true }))).toMatch(/dshx:bg-foreground\/12/u)
    // Pointer hover: no outline; the keyboard adds one (round 4 T1).
    expect(rowTag(row({ highlighted: true }))).not.toMatch(/outline-1/u)
  })

  it('draws no inspected bar: the details header names the inspected model (round 5 U4)', () => {
    const tag = rowTag(row({}))
    expect(tag).not.toContain('data-model-inspected')
    expect(tag).not.toMatch(/before:w-0\.5/u)
    expect(readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')).not.toContain(
      'inspected={inspected !== null && inspected.model === model.id}',
    )
  })

  it('says "In use" in the details header of the thread own model, opposite the draft caption', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ModelDetails
          accountAccents={new Map()}
          busy={false}
          current={{ provider: 'cc1', model: 'gpt-6-luna' }}
          error={null}
          groups={[{ id: 'cc1', name: 'Command Code 1', models: [{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }] }]}
          inspected={{ provider: 'cc1', model: 'gpt-6-luna' }}
          onBack={() => undefined}
          onClose={() => undefined}
          onInspect={() => undefined}
          onRetry={() => undefined}
          onSelect={() => undefined}
          onUse={() => undefined}
          providerLabels={new Map()}
          quotas={new Map()}
        />
      </TooltipProvider>,
    )
    expect(html).toMatch(/data-model-details-in-use[^>]*>.*In use<\/span>/u)
    expect(html).not.toContain('Inspecting')
  })
})
