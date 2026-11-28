import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelRow } from '../src/model-row.js'

describe('the Fast bolt sits beside the name (council picker round 5, U7)', () => {
  it('lets the name keep its own width and puts the bolt 4 px after it in the list', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ModelRow
          active={false}
          busy={false}
          current={null}
          fanOutSelected={false}
          fastOn
          group={{ id: 'codex', name: 'Codex 1', models: [] }}
          model={{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }}
          onFanOut={() => undefined}
          onInspect={() => undefined}
          onSelect={() => undefined}
          providerLabel="Codex"
          quota={undefined}
        />
      </TooltipProvider>,
    )
    expect(/<span[^>]*data-model-picker-name[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:flex-\[0_1_auto\]/u)
    expect(html).toMatch(/<span class="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-1 dshx:overflow-hidden">/u)
  })

  it('keeps 4 px between the name and the bolt on the phone bar', () => {
    expect(readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')).toContain(
      'dshx:in-data-model-mark:ml-1" data-model-fast-mode-enabled',
    )
  })
})
