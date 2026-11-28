import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelDetails } from '../src/model-details.js'
import { ModelPickerModel } from '../src/model-picker-model.js'
import { ModelRow } from '../src/model-row.js'

const text = (html: string): string => html.replace(/<[^>]+>/gu, '')

describe('one naming everywhere (council picker N1)', () => {
  it('names a model by the kit display name: one case, account and same-family vendor prefixes dropped', () => {
    const name = (group: string, id: string, catalogName = id): string =>
      ModelPickerModel.displayName({ group: { id: group }, model: { id, name: catalogName } })
    expect(name('codex_work_1', 'gpt-6-luna', 'GPT-6 Luna')).toBe('gpt-6-luna')
    expect(name('commandcode_work_2', 'gpt-6-luna')).toBe('gpt-6-luna')
    expect(name('commandcode_work_2', 'google/gemini-3.8-flash', 'Gemini 3.8 Flash')).toBe('gemini-3.8-flash')
    expect(name('opencode-go-alex', 'opencode-go-alex/deepseek-v4', 'opencode-go-alex/DeepSeek V4')).toBe('deepseek-v4')
    expect(name('acme', 'meta-llama/llama-5-70b')).toBe('meta-llama/llama-5-70b')
  })

  it('sets list rows at 13 px / 450 in 32 px rows (44 on touch), the service after the name with no leading dot', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ModelRow
          active={false}
          busy={false}
          current={null}
          fanOutSelected={false}
          group={{ id: 'codex_work_1', name: 'Codex 1', models: [] }}
          model={{ id: 'gpt-6-luna', name: 'GPT-6 Luna', description: '' }}
          onFanOut={() => undefined}
          onInspect={() => undefined}
          onSelect={() => undefined}
          providerLabel="Codex"
          quota={undefined}
        />
      </TooltipProvider>,
    )
    expect(/<div[^>]*data-model-picker-row[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:h-8 [^"]*dshx:pointer-coarse:h-11/u)
    expect(/<span[^>]*data-model-picker-name[^>]*>([^<]*)</u.exec(html)?.[1]).toBe('gpt-6-luna')
    expect(/<span[^>]*data-model-picker-name[^>]*>/u.exec(html)?.[0]).toMatch(/dshx:text-sm dshx:font-\[450\]/u)
    expect(text(html)).not.toContain('·')
  })

  it('puts the model on its own line in the inspector header, 15 px / 600 up to two lines, the service and account below', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ModelDetails
          accountAccents={new Map()}
          busy={false}
          current={{ provider: 'cc2', model: 'google/gemini-3.8-flash' }}
          error={null}
          groups={[{ id: 'cc2', name: 'Command Code 2', models: [{ id: 'google/gemini-3.8-flash', name: 'google/gemini-3.8-flash', description: '' }] }]}
          inspected={{ provider: 'cc2', model: 'google/gemini-3.8-flash' }}
          onBack={() => undefined}
          onClose={() => undefined}
          onInspect={() => undefined}
          onRetry={() => undefined}
          onSelect={() => undefined}
          onUse={() => undefined}
          providerLabels={new Map([['cc2', 'Command Code']])}
          quotas={new Map()}
        />
      </TooltipProvider>,
    )
    const title = /<h2[^>]*data-model-picker-current[^>]*>([^<]*)</u.exec(html)
    expect(title?.[1]).toBe('gemini-3.8-flash')
    expect(title?.[0]).toMatch(/dshx:line-clamp-2 dshx:text-heading[^"]*dshx:font-semibold/u)
    expect(/<span[^>]*data-model-details-route[^>]*>([^<]*)</u.exec(html)?.[1]).toBe('Command Code 2')
  })
})
