import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelDetails } from '../src/model-details.js'

const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')

describe('an empty catalog is sized to its message (council picker round 5, U6)', () => {
  it('drops the list height and the search, and puts the title and Close on one line', () => {
    expect(picker).toMatch(/catalogEmpty\s*\?\s*'dshx:h-auto'/u)
    expect(picker).toMatch(/catalogEmpty && 'dshx:hidden'\)\}\s*data-model-search-row/u)
    expect(picker).toMatch(/catalogEmpty && 'dshx:flex dshx:pl-1\.5 dshx:pointer-coarse:pl-0',[\s\S]{0,40}\)\}\s*data-model-picker-list-header/u)
  })

  it('says what to do when no model is chosen, and shows no fallbacks until one is', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ModelDetails
          accountAccents={new Map()}
          busy={false}
          current={null}
          error={null}
          fallbacks={<p data-fallbacks-probe>fallbacks</p>}
          groups={[]}
          inspected={null}
          onBack={() => undefined}
          onInspect={() => undefined}
          onRetry={() => undefined}
          onSelect={() => undefined}
          onUse={() => undefined}
          providerLabels={new Map()}
          quotas={new Map()}
        />
      </TooltipProvider>,
    )
    expect(html).toContain('Choose a model in the list to see its accounts and reasoning effort.')
    expect(html).not.toContain('data-fallbacks-probe')
  })
})
