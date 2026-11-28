import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelRow } from '../src/model-row.js'

const rowTag = (input: { readonly fanOutSelected?: boolean; readonly active?: boolean; readonly highlighted?: boolean }): string =>
  /<div[^>]*data-model-picker-row[^>]*>/u.exec(
    renderToStaticMarkup(
      <TooltipProvider>
        <ModelRow
          active={input.active ?? false}
          busy={false}
          current={null}
          fanOutSelected={input.fanOutSelected ?? false}
          group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
          highlighted={input.highlighted ?? false}
          model={{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }}
          onFanOut={() => undefined}
          onInspect={() => undefined}
          onSelect={() => undefined}
          providerLabel="Command Code"
          quota={undefined}
          selectSeveral={input.fanOutSelected !== undefined}
        />
      </TooltipProvider>,
    ),
  )?.[0] ?? ''

describe('a row wash means what Enter does, nothing else (council picker round 5, U4)', () => {
  it('washes only the active option: not the model in use, not a collected route', () => {
    expect(rowTag({ active: true })).not.toMatch(/bg-selected-wash|bg-foreground/u)
    expect(rowTag({ fanOutSelected: true })).not.toMatch(/bg-selected-wash|bg-foreground/u)
    expect(rowTag({ highlighted: true })).toMatch(/dshx:bg-foreground\/12/u)
  })
})
