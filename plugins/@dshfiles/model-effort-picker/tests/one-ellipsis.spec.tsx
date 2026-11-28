import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { MatchedName, ModelRow } from '../src/model-row.js'
import { isTruncatedWithin } from '../src/picker-atoms.js'

const longId = 'mistral-large-3-instruct-2512-extended-context-preview'
const row = (query?: string): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelRow
        active={false}
        busy={false}
        current={null}
        fanOutSelected={false}
        group={{ id: 'cc2', name: 'Command Code 2', models: [] }}
        model={{ id: longId, name: longId, description: '' }}
        onFanOut={() => undefined}
        onInspect={() => undefined}
        onSelect={() => undefined}
        providerLabel="Command Code"
        query={query}
        quota={undefined}
      />
    </TooltipProvider>,
  )

describe('long names: one ellipsis, by width (council picker round 5, U1)', () => {
  it('writes the whole name, with no ellipsis character, as a truncating head and a fixed tail', () => {
    const html = row()
    expect(html).not.toContain('…')
    expect(html).toMatch(
      /<span class="dshx:min-w-0 dshx:truncate" data-truncates="true">mistral-large-3-instruct-2512-extended-context<\/span><span class="dshx:shrink-0 dshx:whitespace-pre">-preview<\/span>/u,
    )
  })

  it('keeps one match across the head and the tail', () => {
    const across = renderToStaticMarkup(
      <>
        <MatchedName from={0} name="abc-preview" query="c-pre" to={3} />|<MatchedName from={3} name="abc-preview" query="c-pre" to={11} />
      </>,
    )
    expect(across).toBe(
      'ab<span class="dshx:underline dshx:decoration-foreground/50 dshx:underline-offset-3 dshx:[text-decoration-skip-ink:none]" data-model-match="true">c</span>|<span class="dshx:underline dshx:decoration-foreground/50 dshx:underline-offset-3 dshx:[text-decoration-skip-ink:none]" data-model-match="true">-pre</span>view',
    )
  })

  it('opens the tooltip when the head is cut, not only the outer element', () => {
    const part = { scrollWidth: 300, clientWidth: 120 }
    const outer = { scrollWidth: 200, clientWidth: 200, querySelectorAll: () => [part] }
    // SAFETY: the check reads only scrollWidth, clientWidth and querySelectorAll, which the stand-ins provide.
    expect(isTruncatedWithin(outer as unknown as Element)).toBe(true)
  })
})
