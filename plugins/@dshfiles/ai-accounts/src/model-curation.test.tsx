// @vitest-environment jsdom
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountDraftModel } from './account-draft.js'
import { ModelCuration } from './model-curation.js'
import { AccountModelDefaults } from './account-model-defaults.js'
import type { AccountDraft, AccountsCatalog } from './api.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const catalog = Array.from({ length: 9 }, (_, index) => ({
  id: `model-${index}`,
  name: `Model ${index}`,
  efforts: [
    { id: 'low', name: 'Low' },
    { id: 'high', name: 'High' },
  ],
  defaultEffort: 'high',
}))
let root: Root | undefined
let container: HTMLDivElement
const click = async (element: Element | null): Promise<void> => {
  if (!(element instanceof HTMLElement)) throw new Error('Expected an interactive element')
  await act(async () => element.click())
}
const mount = async (draft: AccountDraft, defaults = false, models: AccountsCatalog['models'] = catalog): Promise<{ draft: () => AccountDraft }> => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  let current = draft
  const render = (): void =>
    root?.render(
      <TooltipProvider>
        {defaults ? (
          <AccountModelDefaults draft={current} catalog={models} onChange={onChange} />
        ) : (
          <ModelCuration account={current} catalog={models} onChange={onChange} />
        )}
      </TooltipProvider>,
    )
  const onChange = (patch: Partial<AccountDraft>): void => {
    current = { ...current, ...patch }
    render()
  }
  await act(async () => render())
  return { draft: () => current }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  await act(async () => root?.unmount())
  container?.remove()
  root = undefined
})

describe('reference Models table', () => {
  it('keeps a legacy additional ID visible once the provider natively offers it', async () => {
    await mount(
      { ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: true, additionalModelIds: ['model-0', 'custom-only'] },
      false,
      [
        ...catalog.map(model => ({ ...model, accountAdditional: false })),
        { id: 'custom-only', name: 'Custom only', efforts: [], defaultEffort: null, accountAdditional: true },
      ],
    )
    expect(container.querySelector('[aria-label="Star Model 0"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Star Custom only"]')).toBeNull()
    expect(container.textContent).not.toContain('Custom')
  })
  it('starts at five rows, reveals the real remaining count, and keeps custom ID entry behind disclosure', async () => {
    await mount(AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }))
    expect([...container.querySelectorAll('th')].map(element => element.textContent)).toEqual([
      'Model',
      'Reasoning effort',
      'Context window',
      'Show in picker',
      'Source',
      'Actions',
    ])
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5)
    const more = [...container.querySelectorAll('button')].find(element => element.textContent?.includes('Show 4 more models'))
    await click(more ?? null)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(9)
    expect(container.querySelector('[aria-label="Additional model ID"]')).toBeNull()
    const add = [...container.querySelectorAll('button')].find(element => element.textContent?.includes('Add custom model'))
    await click(add ?? null)
    expect(container.querySelector('[aria-label="Additional model ID"]')).not.toBeNull()
    expect(container.querySelectorAll('tbody [role="switch"]')).toHaveLength(9)
    expect(container.textContent).not.toContain('Default model')
  })

  it('offers context windows up to the provider maximum and keeps the account inheriting', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    )
    Element.prototype.scrollIntoView ??= () => undefined
    const state = await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: true }, false, [
      { ...catalog[0]!, id: 'gpt-6.2-astra', name: 'GPT-6.2-Astra', contextWindow: 272_000, maxContextWindow: 872_000 },
      { ...catalog[1]!, id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna', contextWindow: 272_000 },
    ])
    const trigger = container.querySelector('[aria-label="Context window for GPT-6.2-Astra"]')
    expect(trigger?.textContent).toBe('Default (272k)')
    // No disclosed maximum above the default: nothing to raise, so the window is plain text.
    expect(container.querySelector('[aria-label="Context window for GPT-5.6-Luna"]')).toBeNull()
    expect(container.textContent).toContain('272k')
    await click(trigger)
    const options = [...document.body.querySelectorAll('[role="option"]')]
    expect(options.map(option => option.textContent)).toEqual(['Default (272k)', '128k', '200k', '400k', '500k', '600k', '750k', '872k (max)'])
    await click(options.find(option => option.textContent === '872k (max)') ?? null)
    expect(state.draft().contextWindowOverrides).toEqual({ 'gpt-6.2-astra': 872_000 })
    expect(state.draft().inheritModelSettings).toBe(true)
    expect(container.querySelector('[aria-label="Context window for GPT-6.2-Astra"]')?.textContent).toBe('872k (max)')
  })

  it('edits the rendered inherited value without accidentally deleting a paused favorite', async () => {
    const saved = {
      ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
      inheritModelSettings: true,
      favoriteModelIds: ['model-0'],
      hiddenModelIds: ['model-0'],
    }
    const state = await mount(saved)
    expect(container.querySelector('[aria-label="Star Model 0"]')).not.toBeNull()
    await click(container.querySelector('[aria-label="Star Model 0"]'))
    expect(state.draft().inheritModelSettings).toBe(false)
    expect(state.draft().favoriteModelIds).toEqual(['model-0'])
    expect(state.draft().hiddenModelIds).toEqual([])
    expect(container.textContent).toContain('Overridden')
  })

  it('preserves account defaults and per-model overrides across inheritance toggles', async () => {
    const saved = {
      ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }),
      defaultReasoningEffort: 'low',
      reasoningDefaults: { 'model-0': 'high' },
      inheritModelSettings: false,
    }
    const state = await mount(saved, true)
    await click(container.querySelector('[aria-label="Inherit model settings from provider"]'))
    expect(state.draft()).toMatchObject({ inheritModelSettings: true, defaultReasoningEffort: 'low', reasoningDefaults: { 'model-0': 'high' } })
    expect(container.textContent).toContain('Saved value is paused')
    await click(container.querySelector('[aria-label="Inherit model settings from provider"]'))
    expect(state.draft().inheritModelSettings).toBe(false)
    expect(container.querySelector('[aria-label="Default reasoning effort"]')?.textContent).toBe('Low')
  })
})
