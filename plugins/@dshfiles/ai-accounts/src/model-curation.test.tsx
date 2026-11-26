// @vitest-environment jsdom
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
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
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: false, favoriteModelIds: ['model-0'] })
    expect([...container.querySelectorAll('th')].map(element => element.textContent)).toEqual(['Model', 'Reasoning effort', 'Show model', 'Source', 'Actions'])
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5)
    const more = [...container.querySelectorAll('button')].find(element => element.textContent?.includes('Show 4 more models'))
    await click(more ?? null)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(9)
    expect(container.querySelector('[aria-label="Additional model ID"]')).toBeNull()
    const add = [...container.querySelectorAll('button')].find(element => element.textContent?.includes('Add custom model'))
    await click(add ?? null)
    expect(container.querySelector('[aria-label="Additional model ID"]')).not.toBeNull()
    // Round five P5: a column of checkboxes, not a column of accent switches.
    expect(container.querySelectorAll('tbody [role="switch"]')).toHaveLength(0)
    expect(container.querySelectorAll('tbody [role="checkbox"]')).toHaveLength(9)
    expect(container.textContent).not.toContain('Default model')
  })

  it('says above the table when the hidden account masks every row (council round 9, D3)', async () => {
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), enabled: false })
    const note = container.querySelector('[data-account-hidden-note]')
    expect(note?.textContent).toBe('This account is hidden, so none of its models show in the model picker. Turn on Show this account to use them.')
    // Above the table, not under it.
    const table = container.querySelector('table')
    expect(note !== null && table !== null && (note.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
    await act(async () => root?.unmount())
    container.remove()
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), enabled: true })
    expect(container.querySelector('[data-account-hidden-note]')).toBeNull()
  })

  it('sizes each effort select to its value in a 192 px column, leaving the width to model names (council round 7, D2; round 12, D3)', async () => {
    await mount(AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }))
    const effortHead = [...container.querySelectorAll('th')].find(element => element.textContent === 'Reasoning effort')
    // 192 px: room for "Provider default · Auto" at 12 px and its chevron (council round 12, D3).
    expect(effortHead?.className).toContain('dshx:w-48')
    const trigger = container.querySelector('[aria-label="Default reasoning effort for Model 0"]')
    const classes = (trigger?.getAttribute('class') ?? '').split(' ')
    // An inherited value hugs its text (council round 11, D2); an overridden chip keeps the 96 px minimum (below).
    for (const look of ['dshx:w-fit', 'dshx:max-w-full', 'dshx:px-2']) expect(classes).toContain(look)
    expect(classes).not.toContain('dshx:w-full')
    expect(classes).not.toContain('dshx:w-40')
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

  it('says in each row that it inherits, with no Inherited label and no separate note (council round 12, D3)', async () => {
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: true })
    // The row's own effort cell says where the value comes from, so the caption above the table would repeat it.
    expect(container.querySelector('[data-models-inherit-note]')).toBeNull()
    expect(container.textContent).not.toContain('All models inherit')
    expect(container.querySelector('[aria-label="Default reasoning effort for Model 0"]')?.textContent).toMatch(/^Provider default · /u)
    expect(container.querySelector('tbody')?.textContent).not.toContain('Inherited')
    expect([...container.querySelectorAll('th')].map(element => element.textContent)).toEqual(['Model', 'Reasoning effort', 'Show model', 'Actions'])
    await act(async () => root?.unmount())
    container.remove()
    // One overridden row brings the Source column back.
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: false, favoriteModelIds: ['model-0'] })
    expect(container.querySelector('tbody')?.textContent).toContain('Overridden')
    expect(container.querySelector('tbody')?.textContent).toContain('Inherited')
  })

  it('sets model names at 500 and starts the Model heading on the names (council round 10, D2)', async () => {
    await mount(AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }))
    // Not a <strong>: the Host's unlayered strong weight outranks the layered utility.
    expect(container.querySelector('tbody strong')).toBeNull()
    const name = container.querySelector('tbody span[tabindex="0"]')
    expect(name?.textContent).toBe('Model 0')
    expect(name?.className).toContain('dshx:font-medium')
    // The cell's 8 px inset, the 24 px star, the 16 px model mark and two 8 px gaps: names start 64 px in.
    const head = [...container.querySelectorAll('th')].find(element => element.textContent === 'Model')
    expect(head?.className).toContain('dshx:pl-16')
    expect(container.querySelector('tbody td > div')?.className).toContain('dshx:gap-2')
    expect(container.querySelector('tbody td')?.className).toContain('dshx:px-2')
  })
})

describe('Models table cells (council round 11, D2)', () => {
  const effortTrigger = (name: string): Element | null => container.querySelector(`[aria-label="Default reasoning effort for ${name}"]`)
  const classesOf = (element: Element | null): string[] => (element?.getAttribute('class') ?? '').split(' ')

  it('shows an inherited effort as quiet 12 px secondary text with a small chevron, the trigger chrome on hover, focus and open', async () => {
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: true })
    const trigger = effortTrigger('Model 0')
    const classes = classesOf(trigger)
    // Council round 12, D3: 12 px, so "Provider default · Auto" fits the column beside the 13 px names.
    expect(classes).not.toContain('dshx:text-sm')
    for (const look of ['dshx:text-xs', 'dshx:text-muted-foreground', 'dshx:border-transparent', 'dshx:bg-transparent']) expect(classes, look).toContain(look)
    for (const look of ['dshx:hover:bg-trigger-fill', 'dshx:focus-visible:bg-trigger-fill', 'dshx:aria-expanded:bg-trigger-fill', 'dshx:hover:text-foreground'])
      expect(classes, look).toContain(look)
    // The kit trigger's hover, open and focus edges stay: only the rest look is quiet.
    for (const look of ['dshx:not-disabled:hover:border-field-border', 'dshx:aria-expanded:border-field-border', 'dshx:focus-visible:border-ring'])
      expect(classes, look).toContain(look)
    expect(classes).toContain('dshx:[&>svg]:size-3')
    // The chevron sits beside the value: the cell hugs it instead of the 96 px chip minimum.
    expect(classes).toContain('dshx:min-w-0')
    expect(classes).not.toContain('dshx:min-w-24')
  })

  it('keeps the trigger chrome on an overridden row', async () => {
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: false, reasoningDefaults: { 'model-0': 'low' } })
    const trigger = effortTrigger('Model 0')
    expect(trigger?.textContent).toBe('Low')
    const classes = classesOf(trigger)
    expect(classes).not.toContain('dshx:border-transparent')
    expect(classes).not.toContain('dshx:bg-transparent')
    expect(classes).toContain('dshx:bg-trigger-fill')
    expect(classes).toContain('dshx:min-w-24')
    expect(classesOf(effortTrigger('Model 1'))).toContain('dshx:bg-transparent')
  })

  it('draws the Show model checkboxes at the dense 16 px size', async () => {
    await mount(AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }))
    const boxes = [...container.querySelectorAll('[aria-label^="Show "][aria-label$=" in the picker"]')]
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) expect(box.getAttribute('data-size')).toBe('sm')
  })
})
