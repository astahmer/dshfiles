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
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: false, favoriteModelIds: ['model-0'] })
    expect([...container.querySelectorAll('th')].map(element => element.textContent)).toEqual(['Model', 'Reasoning effortAuto: provider default', 'Context window', 'Show model', 'Source', 'Actions'])
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
    const effortHead = [...container.querySelectorAll('th')].find(element => element.textContent?.startsWith('Reasoning effort'))
    // 192 px: room for "Provider default · Auto" at 12 px and its chevron (council round 12, D3).
    expect(effortHead?.className).toContain('dshx:w-48')
    const trigger = container.querySelector('[role="combobox"][aria-label^="Default reasoning effort for Model 0"]')
    const classes = (trigger?.getAttribute('class') ?? '').split(' ')
    // An inherited value hugs its text (council round 11, D2); an overridden chip keeps the 96 px minimum (below).
    for (const look of ['dshx:w-fit', 'dshx:max-w-full', 'dshx:px-2']) expect(classes).toContain(look)
    expect(classes).not.toContain('dshx:w-full')
    expect(classes).not.toContain('dshx:w-40')
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

  it('draws a default context window like an inherited effort: quiet text sized to its value', async () => {
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: true }, false, [
      { ...catalog[0]!, id: 'gpt-6.2-astra', name: 'GPT-6.2-Astra', contextWindow: 272_000, maxContextWindow: 872_000 },
    ])
    const head = [...container.querySelectorAll('th')].find(element => element.textContent === 'Context window')
    // The header starts on the values, like Reasoning effort's.
    expect(head?.className).toContain('dshx:pl-[21px]')
    const classes = (container.querySelector('[aria-label="Context window for GPT-6.2-Astra"]')?.getAttribute('class') ?? '').split(' ')
    for (const look of ['dshx:w-fit', 'dshx:max-w-full', 'dshx:px-2', 'dshx:bg-transparent', 'dshx:text-muted-foreground']) expect(classes).toContain(look)
    expect(classes).not.toContain('dshx:w-full')
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
    // "Auto", its source said once at the column header (council round 17, D1); the accessible name keeps "Provider default".
    expect(container.querySelector('[role="combobox"][aria-label^="Default reasoning effort for Model 0"]')?.textContent).toBe('Auto')
    expect(container.querySelector('tbody')?.textContent).not.toContain('Inherited')
    expect([...container.querySelectorAll('th')].map(element => element.textContent)).toEqual(['Model', 'Reasoning effortAuto: provider default', 'Context window', 'Show model', 'Actions'])
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

  it('names models the way subagent surfaces do: a same-family vendor prefix drops, the full id stays findable (council round 25, item 4)', async () => {
    const routed = ['deepseek/deepseek-v4-flash', 'google/gemini-3.8-flash', 'meta-llama/llama-5-70b'].map(id => ({ id, name: id, efforts: [], defaultEffort: null }))
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: false }, false, routed)
    // What the row shows: the name cell's text without its screen-reader-only part.
    const names = (): string[] =>
      [...container.querySelectorAll('tbody span[tabindex="0"]')].map(name => {
        const shown = name.cloneNode(true)
        if (shown instanceof Element) for (const hidden of shown.querySelectorAll('.dshx\\:sr-only')) hidden.remove()
        return shown.textContent ?? ''
      })
    // The kit's modelIdentity name: `deepseek/` and `google/` say only what the mark says; another vendor's prefix stays.
    expect(names()).toEqual(['deepseek-v4-flash', 'gemini-3.8-flash', 'meta-llama/llama-5-70b'])
    // The dropped prefix stays in the accessible text, and row controls keep the full id.
    expect([...container.querySelectorAll('tbody span[tabindex="0"]')].map(name => name.textContent)).toEqual(routed.map(model => model.id))
    expect(container.querySelector('tbody span[tabindex="0"] .dshx\\:sr-only')?.textContent).toBe('deepseek/')
    expect(container.querySelector('[aria-label="Star google/gemini-3.8-flash"]')).not.toBeNull()
    // The search still finds a model by its full id.
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search models"]')
    if (search === null) throw new Error('Expected the model search')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'google/gemini')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(names()).toEqual(['gemini-3.8-flash'])
  })
})

describe('Models table cells (council round 11, D2)', () => {
  const effortTrigger = (name: string): Element | null => container.querySelector(`[role="combobox"][aria-label^="Default reasoning effort for ${name}"]`)
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

  it('shows an inherited effort as "Auto" with its chevron, explains Auto once at the column header, and keeps the provenance in the menu and name (council round 17, D1)', async () => {
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: true })
    const trigger = container.querySelector('[role="combobox"][aria-label^="Default reasoning effort for Model 0"]')
    expect(trigger?.getAttribute('aria-label')).toBe('Default reasoning effort for Model 0, Auto (Provider default · High)')
    expect(trigger?.textContent).toBe('Auto')
    expect(trigger?.querySelector('svg')).not.toBeNull()
    expect(trigger?.querySelector('[data-effort-source]')).toBeNull()
    const value = trigger?.querySelector('[data-effort-value]')
    expect(classesOf(value ?? null)).toContain('dshx:text-sm')
    // Secondary ink from the quiet trigger, so an override chip in ink is the row that stands out.
    expect(classesOf(value ?? null)).not.toContain('dshx:text-foreground')
    const notes = container.querySelectorAll('thead [data-effort-auto-note]')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.textContent).toBe('Auto: provider default')
    expect(container.querySelector('tbody')?.textContent).not.toContain('Provider')
    // The menu still names where the inherited value comes from. jsdom has no ResizeObserver or scrollIntoView for the popover.
    if (!('ResizeObserver' in globalThis))
      Object.assign(globalThis, { ResizeObserver: class { observe(): void {} unobserve(): void {} disconnect(): void {} } })
    if (!('scrollIntoView' in Element.prototype)) Object.assign(Element.prototype, { scrollIntoView: () => undefined })
    await click(trigger)
    expect(document.body.textContent).toContain('Auto (Provider default · High)')
  })

  it('names an account-wide default at the column header, and an override in its row', async () => {
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: false, defaultReasoningEffort: 'low', reasoningDefaults: { 'model-1': 'high' } })
    const trigger = container.querySelector('[role="combobox"][aria-label^="Default reasoning effort for Model 0"]')
    expect(trigger?.textContent).toBe('Auto')
    expect(trigger?.getAttribute('aria-label')).toBe('Default reasoning effort for Model 0, Auto (Account default · Low)')
    expect(container.querySelector('thead [data-effort-auto-note]')?.textContent).toBe('Auto: account default')
    expect(container.querySelector('[role="combobox"][aria-label^="Default reasoning effort for Model 1"]')?.textContent).toBe('High')
  })

  it('sets the effort header on one line, starting on the values, with Auto explained by an ⓘ (council round 18, D1)', async () => {
    await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: true })
    const head = [...container.querySelectorAll('th')].find(element => element.textContent?.startsWith('Reasoning effort'))
    // The cell's 12 px, the trigger's 1 px transparent edge and its 8 px inset: "Auto" starts where the header does.
    expect(classesOf(head ?? null)).toContain('dshx:pl-[21px]')
    expect(classesOf(head ?? null)).toContain('dshx:whitespace-nowrap')
    expect(classesOf(effortTrigger('Model 0'))).toContain('dshx:px-2')
    expect(classesOf(effortTrigger('Model 0'))).toContain('dshx:border-transparent')
    const info = head?.querySelector('button')
    expect(info?.querySelector('svg')).not.toBeNull()
    // The note is the ⓘ's name (and its tooltip), not a second header line.
    expect(info?.querySelector('[data-effort-auto-note]')?.className).toContain('dshx:sr-only')
    expect(info?.textContent).toBe('Auto: provider default')
  })

  it('centres the Show model checkboxes under their header (council round 18, D1)', async () => {
    await mount(AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }))
    const head = [...container.querySelectorAll('th')].find(element => element.textContent === 'Show model')
    expect(classesOf(head ?? null)).toContain('dshx:text-center')
    const box = container.querySelector('[aria-label="Show Model 0 in the picker"]')
    expect(classesOf(box?.parentElement ?? null)).toEqual(expect.arrayContaining(['dshx:flex', 'dshx:justify-center']))
  })

  it('puts Disable all in a Model actions menu at the table end, not in danger red (council round 18, D1)', async () => {
    const state = await mount({ ...AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }), inheritModelSettings: false })
    const buttons = (): HTMLButtonElement[] => [...container.querySelectorAll('button')]
    expect(buttons().some(button => button.textContent === 'Disable all')).toBe(false)
    const trigger = buttons().find(button => button.textContent === 'Model actions')
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu')
    if (!('ResizeObserver' in globalThis))
      Object.assign(globalThis, { ResizeObserver: class { observe(): void {} unobserve(): void {} disconnect(): void {} } })
    await act(async () => {
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(element => element.textContent === 'Disable all')
    expect(item?.getAttribute('data-variant')).not.toBe('destructive')
    await click(item ?? null)
    expect(state.draft().hiddenModelIds).toHaveLength(9)
  })

  it('draws the Show model checkboxes at the dense 16 px size', async () => {
    await mount(AccountDraftModel.newAccountDraft({ kind: 'codex', existing: [] }))
    const boxes = [...container.querySelectorAll('[aria-label^="Show "][aria-label$=" in the picker"]')]
    expect(boxes.length).toBeGreaterThan(0)
    for (const box of boxes) expect(box.getAttribute('data-size')).toBe('sm')
  })
})
