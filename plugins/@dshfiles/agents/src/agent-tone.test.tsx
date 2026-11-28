// @vitest-environment jsdom
import { projectToneIndex } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Agents, type Agent } from './agent.js'
import { AgentList } from './agent-list.js'
import { AgentCard } from './agent-reference-preview.js'
import { AgentReferenceChip } from './agent-reference-chip.js'
import { AgentTone } from './agent-tone.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const agent = (fields: Partial<Agent>): Agent => ({ ...Agents.builtIn(1), builtIn: false, ...fields })

let root: Root | undefined
const render = (element: JSX.Element): HTMLElement => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(element))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  AgentTone.setAgents([])
})

/** The tone a surface paints: its `project-tone-balanced-<n>` class, which the theme colours. */
const toneOf = (element: Element | null): string | undefined => /project-tone-balanced-(\d)/u.exec(element?.className ?? '')?.[1]

describe('agent colour', () => {
  it('a stored slot wins and an agent without one takes the slot its handle hashes to', () => {
    expect(AgentTone.slotOf({ handle: 'luna', tone: 4 })).toBe(4)
    expect(AgentTone.slotOf({ handle: 'luna' })).toBe(projectToneIndex('luna'))
    expect(AgentTone.slotOf({ handle: 'luna', tone: null })).toBe(projectToneIndex('luna'))
  })

  it('paints each list row’s glyph tile with the agent’s colour on its wash', () => {
    const view = render(
      <AgentList
        agents={[agent({ handle: 'luna', name: 'Luna', glyph: '🌙', tone: 3 }), agent({ handle: 'sol', name: 'Sol', glyph: '' })]}
        selected={null}
        loading={false}
        pendingHandles={new Set()}
        routeLabel={() => 'Harness default'}
        actions={{ select: () => undefined, setEnabled: () => undefined, startThread: () => undefined, duplicate: () => undefined, remove: () => undefined }}
      />,
    )
    const luna = view.querySelector('[data-agent-row="luna"] [data-slot="agent-glyph"]')
    expect(toneOf(luna)).toBe('3')
    expect(luna?.className).toContain('dshx:bg-current/18')
    expect(luna?.textContent).toBe('🌙')
    const sol = view.querySelector('[data-agent-row="sol"] [data-slot="agent-glyph"]')
    expect(toneOf(sol)).toBe(String(projectToneIndex('sol')))
    // No glyph: the name's first letter, in the ink that holds AA on the wash.
    expect(sol?.textContent).toBe('S')
    expect(sol?.querySelector('.dshx-project-mark-letters')).not.toBeNull()
  })

  it('paints a reference chip with the chosen colour once the registry list names it, else the hashed one', () => {
    const view = render(
      <>
        <AgentReferenceChip handle="luna" />
        <AgentReferenceChip handle="sol" interactive={false} />
      </>,
    )
    const chips = (): Element[] => [...view.querySelectorAll('[data-agent-chip]')]
    expect(chips().map(toneOf)).toEqual([String(projectToneIndex('luna')), String(projectToneIndex('sol'))])
    act(() => AgentTone.setAgents([agent({ handle: 'luna', tone: 5 })]))
    expect(chips().map(toneOf)).toEqual(['5', String(projectToneIndex('sol'))])
    expect(chips()[0]?.className).toContain('dshx:bg-current/18')
    expect(chips()[0]?.querySelector('span.dshx-project-mark-letters')?.textContent).toBe('@luna')
  })

  it('paints the preview card’s glyph tile', () => {
    const view = render(<AgentCard agent={agent({ handle: 'luna', name: 'Luna', glyph: '🌙', tone: 1 })} threads={[]} openThread={() => undefined} />)
    const tile = view.querySelector('[data-slot="agent-glyph"]')
    expect(toneOf(tile)).toBe('1')
    expect(tile?.getAttribute('data-tone')).toBe('1')
  })
})
