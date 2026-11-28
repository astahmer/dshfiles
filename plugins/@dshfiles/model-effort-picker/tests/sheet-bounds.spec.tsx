import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FastModeRow } from '../src/fast-mode-section.js'
import { ModelDetails } from '../src/model-details.js'

const longId = 'mistral-large-3-instruct-2512-extended-context-preview'
const draft = (): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelDetails
        accountAccents={new Map()}
        busy={false}
        current={{ provider: 'cc1', model: 'gpt-6-luna' }}
        error={null}
        groups={[{ id: 'cc2', name: 'Command Code 2', models: [{ id: longId, name: longId, description: '' }] }]}
        inspected={{ provider: 'cc2', model: longId }}
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

describe('nothing in details leaves the sheet (council picker round 3, R1)', () => {
  it('truncates the Use button inside the sheet, full width at 44 pt on touch, the full name in its accessible name', () => {
    const button = /<button[^>]*aria-label="Use [^"]*"[^>]*>.*?<\/button>/u.exec(draft())?.[0] ?? ''
    expect(button).toContain(`aria-label="Use ${longId}"`)
    expect(button).toMatch(/dshx:min-w-0 dshx:max-w-full/u)
    expect(button).toMatch(/dshx:pointer-coarse:h-11 dshx:pointer-coarse:w-full/u)
    expect(button).toMatch(/<span class="dshx:min-w-0 dshx:truncate">/u)
  })

  it('draws no hit area past the Fast switch, whose row is the touch target', () => {
    const html = renderToStaticMarkup(<FastModeRow disabled={false} enabled={false} error={null} onChange={() => undefined} />)
    expect(/<button[^>]*role="switch"[^>]*>/u.exec(html)?.[0]).toContain('dshx:after:hidden')
  })
})
