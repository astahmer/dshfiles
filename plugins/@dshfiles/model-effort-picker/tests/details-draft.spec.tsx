import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ModelDetails } from '../src/model-details.js'
import { ModelPickerModel } from '../src/model-picker-model.js'

const efforts = [
  { id: 'low', name: 'Low', description: '' },
  { id: 'high', name: 'High', description: '' },
]
const groups = [
  {
    id: 'cc1',
    name: 'Command Code 1',
    models: [
      { id: 'gpt-6-luna', name: 'gpt-6-luna', description: '' },
      { id: 'gemini-3.8-flash', name: 'gemini-3.8-flash', description: '', reasoning: { efforts, defaultEffort: 'low' } },
    ],
  },
  { id: 'cc2', name: 'Command Code 2', models: [{ id: 'gemini-3.8-flash', name: 'gemini-3.8-flash', description: '', reasoning: { efforts, defaultEffort: 'low' } }] },
]
const current = { provider: 'cc1', model: 'gpt-6-luna' }

const render = (inspected: { readonly provider: string; readonly model: string }): string =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ModelDetails
        accountAccents={new Map()}
        busy={false}
        current={current}
        error={null}
        fallbacks={<p>FALLBACKS</p>}
        groups={groups}
        inspected={inspected}
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

describe('inspecting a model never changes the thread (council picker S1)', () => {
  it('stages account and effort changes on a model the thread does not use', () => {
    const inspected = { provider: 'cc2', model: 'gemini-3.8-flash' }
    expect(ModelPickerModel.isDraft({ inspected, current })).toBe(true)
    expect(ModelPickerModel.detailsChange({ inspected, current, change: { reasoningEffort: 'high' } })).toEqual({ kind: 'stage' })
    expect(ModelPickerModel.detailsChange({ inspected, current, change: { provider: 'cc1' } })).toEqual({ kind: 'stage' })
  })

  it('applies changes in place on the thread own model, on any of its accounts, without switching the model', () => {
    const inspected = { provider: 'cc1', model: 'gpt-6-luna' }
    expect(ModelPickerModel.isDraft({ inspected, current })).toBe(false)
    expect(ModelPickerModel.detailsChange({ inspected, current, change: { reasoningEffort: 'high' } })).toEqual({
      kind: 'apply',
      selection: { provider: 'cc1', model: 'gpt-6-luna', reasoningEffort: 'high' },
    })
    expect(ModelPickerModel.detailsChange({ inspected, current: { ...current, reasoningEffort: 'low' }, change: { provider: 'cc2' } })).toEqual({
      kind: 'apply',
      selection: { provider: 'cc2', model: 'gpt-6-luna', reasoningEffort: 'low' },
    })
  })

  it('commits the staged account and effort, else the model default, only through Use', () => {
    const model = groups[1]?.models[0]
    if (model === undefined) throw new Error('fixture')
    const inspected = { provider: 'cc2', model: 'gemini-3.8-flash' }
    expect(ModelPickerModel.draftSelection({ inspected, model, stagedEffort: null })).toEqual({ provider: 'cc2', model: 'gemini-3.8-flash', reasoningEffort: 'low' })
    expect(ModelPickerModel.draftSelection({ inspected, model, stagedEffort: { value: 'high' } })).toEqual({
      provider: 'cc2',
      model: 'gemini-3.8-flash',
      reasoningEffort: 'high',
    })
    expect(ModelPickerModel.draftSelection({ inspected, model, stagedEffort: { value: undefined } })).toEqual({ provider: 'cc2', model: 'gemini-3.8-flash' })
  })

  it('shows a draft with its caption and a Use button, and no fallback chain', () => {
    const html = render({ provider: 'cc2', model: 'gemini-3.8-flash' })
    expect(html).toContain('Inspecting · not in use')
    expect(html).toMatch(/<button[^>]*>Use gemini-3\.8-flash<\/button>/u)
    expect(html).not.toContain('FALLBACKS')
    expect(html).toContain('aria-label="Back to the model in use"')
  })

  it('shows the thread own model without a caption or Use button, with its fallback chain', () => {
    const html = render({ provider: 'cc1', model: 'gpt-6-luna' })
    expect(html).not.toContain('Inspecting')
    expect(html).not.toMatch(/>Use /u)
    expect(html).toContain('FALLBACKS')
  })
})
