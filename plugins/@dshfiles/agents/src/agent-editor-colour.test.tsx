// @vitest-environment jsdom
import { identityToneIndex } from '@dshfiles/plugin-ui/components/palette-picker'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentEditor } from './agent-editor.js'
import { AgentEditorForm } from './agent-editor-form.js'
import { Agents, type AgentDraft } from './agent.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const saved = { ...Agents.builtIn(1), builtIn: false, handle: 'luna', name: 'Luna', glyph: '🌙' }

let root: Root | undefined
const renderForm = (draft: AgentDraft, patch: (next: Partial<AgentDraft>) => void): HTMLElement => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <AgentEditorForm
        draft={draft}
        review={AgentEditor.review(draft, { creating: false, agents: [saved], catalog: [] })}
        creating={false}
        agents={[saved]}
        catalog={[]}
        catalogError={null}
        presets={[]}
        patch={patch}
        onFix={() => undefined}
        revealAll
        tools={{ catalog: undefined, loading: false, error: null, retry: () => undefined, saved: draft.tools }}
        projects={{ list: [], defaults: new Map(), error: null, retry: () => undefined, selected: new Set(), onChange: () => undefined }}
      />,
    ),
  )
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('agent colour in the editor', () => {
  it('a draft carries the stored slot, null for none, and a changed colour is an unsaved edit', () => {
    expect(AgentEditor.draftOf({ ...saved, tone: 3 }).tone).toBe(3)
    const plain = AgentEditor.draftOf(saved)
    expect(plain.tone).toBeNull()
    expect(AgentEditor.isDirty(plain, AgentEditor.draftOf(saved))).toBe(false)
    expect(AgentEditor.isDirty({ ...plain, tone: 2 }, AgentEditor.draftOf(saved))).toBe(true)
    expect(AgentEditor.fromTemplate({ id: 'planner', name: 'Planner', glyph: '🧭', description: '', instructions: '' }, []).tone).toBeNull()
  })

  it('offers the palette beside the glyph, marks the handle’s default and picks a slot', () => {
    const patch = vi.fn<(next: Partial<AgentDraft>) => void>()
    const view = renderForm(AgentEditor.draftOf(saved), patch)
    const group = view.querySelector('[role="radiogroup"][aria-label="Colour"]')
    expect(group?.querySelectorAll('[role="radio"]')).toHaveLength(6)
    expect(group?.querySelector('[data-state="default"]')?.getAttribute('data-palette-slot')).toBe(String(identityToneIndex('luna')))
    // Nothing chosen yet: there is no colour to clear.
    expect([...view.querySelectorAll('button')].some(button => button.textContent === 'Use default')).toBe(false)
    const other = (identityToneIndex('luna') + 2) % 6
    act(() => group?.querySelector<HTMLButtonElement>(`[data-palette-slot="${String(other)}"]`)?.click())
    expect(patch).toHaveBeenCalledWith({ tone: other })
  })

  it('clears a chosen colour back to the default', () => {
    const patch = vi.fn<(next: Partial<AgentDraft>) => void>()
    const view = renderForm(AgentEditor.draftOf({ ...saved, tone: 4 }), patch)
    expect(view.querySelector('[role="radiogroup"][aria-label="Colour"] [data-state="checked"]')?.getAttribute('data-palette-slot')).toBe('4')
    const clear = [...view.querySelectorAll('button')].find(button => button.textContent === 'Use default')
    act(() => clear?.click())
    expect(patch).toHaveBeenCalledWith({ tone: null })
  })
})
