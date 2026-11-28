import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelRow } from '../src/model-row.js'

const group = { id: 'cc1', name: 'Command Code 1', models: [] }
const rows = (): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <div role="listbox">
        {['gpt-6-luna', 'gpt-6-sol', 'gemini-3.8-flash'].map((id, index) => (
          <ModelRow
            active={index === 0}
            busy={false}
            current={null}
            fanOutSelected={false}
            group={group}
            id={`list-${String(index)}`}
            key={id}
            model={{ id, name: id, description: '' }}
            onFanOut={() => undefined}
            onInspect={() => undefined}
            onSelect={() => undefined}
            providerLabel="Command Code"
            quota={undefined}
          />
        ))}
      </div>
    </TooltipProvider>,
  )

describe('VoiceOver swipe order through the list (council picker round 4, evidence)', () => {
  it('reads each model, then its "Details for …" button, then the next model, in DOM order', () => {
    // VoiceOver on a real iPhone is not available here; its swipe order follows the accessibility tree, which is DOM order.
    const html = rows()
    const stops = [
      ...html.matchAll(
        /<(?:div|button)[^>]*?(?:role="option"[^>]*aria-label="([^"]*)"|aria-label="([^"]*)"[^>]*role="option"|aria-label="(Details for [^"]*)")/gu,
      ),
    ].map(match => match[1] ?? match[2] ?? match[3] ?? '')
    expect(stops).toEqual([
      'gpt-6-luna, Command Code 1',
      'Details for gpt-6-luna',
      'gpt-6-sol, Command Code 1',
      'Details for gpt-6-sol',
      'gemini-3.8-flash, Command Code 1',
      'Details for gemini-3.8-flash',
    ])
  })
})
