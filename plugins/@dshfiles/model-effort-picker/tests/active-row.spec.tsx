import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelRow } from '../src/model-row.js'

const row = (input: { readonly active?: boolean; readonly highlighted?: boolean; readonly keyboard?: boolean }): string =>
  /<div[^>]*data-model-picker-row[^>]*>/u.exec(
    renderToStaticMarkup(
      <TooltipProvider>
        <ModelRow
          active={input.active ?? false}
          busy={false}
          current={null}
          fanOutSelected={false}
          group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
          highlighted={input.highlighted ?? false}
          keyboard={input.keyboard ?? false}
          model={{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }}
          onFanOut={() => undefined}
          onInspect={() => undefined}
          onSelect={() => undefined}
          providerLabel="Command Code"
          quota={undefined}
        />
      </TooltipProvider>,
    ),
  )?.[0] ?? ''

describe("Enter's target is the strongest row state (council picker round 4, T1)", () => {
  it('draws no wash or edge on the model in use, so it never reads as a focus ring', () => {
    expect(row({ active: true })).not.toMatch(/bg-selected-wash|selected-edge|bg-foreground/u)
  })

  it('washes the active option with 12 % ink, also when it is the model in use', () => {
    expect(row({ highlighted: true })).toMatch(/dshx:bg-foreground\/12/u)
    expect(row({ highlighted: true, active: true })).toMatch(/dshx:bg-foreground\/12/u)
  })

  it('adds a 1 px inset neutral outline only when the keyboard put it there', () => {
    expect(row({ highlighted: true, keyboard: true })).toMatch(/dshx:outline-1 dshx:-outline-offset-1 dshx:outline-foreground\/50/u)
    expect(row({ highlighted: true, keyboard: false })).not.toMatch(/outline-1/u)
  })
})
