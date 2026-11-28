import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { FanOutSelection } from '../src/fan-out-bar.js'
import { englishModelPicker } from '../src/locales.js'
import { ModelRow } from '../src/model-row.js'

describe('select mode, round 5 (council picker U8)', () => {
  it('puts the reason above the buttons in the phone bar too', () => {
    const html = renderToStaticMarkup(
      <FanOutSelection
        accountTagOf={() => 'CC1'}
        groups={[]}
        limit={6}
        onClear={() => undefined}
        onFanOut={() => undefined}
        onRemove={() => undefined}
        routes={[]}
        t={englishModelPicker}
        variant="bar"
      />,
    )
    expect(html.indexOf('data-model-fan-out-reason')).toBeLessThan(html.indexOf('Continue…'))
  })

  it('drops the check column in select mode, so the quota ends 8 px from the edge', () => {
    const row = (selectSeveral: boolean): string =>
      renderToStaticMarkup(
        <TooltipProvider>
          <ModelRow
            active={false}
            busy={false}
            current={null}
            fanOutSelected={false}
            group={{ id: 'cc1', name: 'Command Code 1', models: [] }}
            model={{ id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' }}
            onFanOut={() => undefined}
            onInspect={() => undefined}
            onSelect={() => undefined}
            providerLabel="Command Code"
            quota={{ percent: 62, label: 'Weekly limit', onReserve: false }}
            selectSeveral={selectSeveral}
          />
        </TooltipProvider>,
      )
    expect(row(true)).not.toContain('data-model-row-check-slot')
    expect(row(false)).toContain('data-model-row-check-slot')
  })
})
