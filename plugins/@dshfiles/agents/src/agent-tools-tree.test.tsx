// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { AgentToolsTree } from './agent-tools-tree.js'
import type { AgentTools } from './agent.js'
import type { ToolCatalogView } from './api.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const catalog: ToolCatalogView = {
  groups: [
    {
      key: 'mcp:github',
      kind: 'mcp',
      label: 'github',
      tools: Array.from({ length: 120 }, (_, index) => ({
        name: `mcp__github__tool_${String(index).padStart(3, '0')}`,
        summary: `Tool number ${String(index)}.`,
      })),
    },
    { key: 'native', kind: 'native', label: 'DSH', tools: [{ name: 'read', summary: 'Read a file.' }] },
  ],
}

let root: Root | undefined
let latest: AgentTools = { tools: {}, groups: {} }

const Harness = (): JSX.Element => {
  const [access, setAccess] = useState<AgentTools>({ tools: {}, groups: {} })
  return (
    <AgentToolsTree
      catalog={catalog}
      loading={false}
      error={null}
      onRetry={() => undefined}
      access={access}
      saved={{ tools: {}, groups: {} }}
      onChange={next => {
        latest = next
        setAccess(next)
      }}
    />
  )
}

const mount = (): HTMLElement => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
  return container
}

const items = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')]
const press = (key: string): void => {
  const target = document.activeElement
  if (!(target instanceof HTMLElement)) throw new Error('nothing focused')
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  latest = { tools: {}, groups: {} }
})

it('starts with collapsed groups and one tab stop', () => {
  const container = mount()
  const rows = items(container)
  expect(rows).toHaveLength(2)
  expect(rows.map(row => row.getAttribute('aria-expanded'))).toEqual(['false', 'false'])
  expect(rows.map(row => row.tabIndex)).toEqual([0, -1])
  expect(container.textContent).toContain('121 of 121 tools selected · 0 pinned')
})

it('opens a group with the keyboard, pages long groups, and toggles and pins tools', () => {
  const container = mount()
  act(() => items(container)[0]?.focus())
  press('ArrowRight')
  // A page of 50 tools plus a "Show more" row, not all 120.
  expect(items(container)).toHaveLength(1 + 50 + 1 + 1)
  press('ArrowRight')
  expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^mcp__github__tool_000/u)
  press(' ')
  expect(latest.tools).toEqual({ mcp__github__tool_000: { enabled: false } })
  expect(items(container)[0]?.getAttribute('aria-checked')).toBe('mixed')
  press(' ')
  expect(latest).toEqual({ tools: {}, groups: {} })
  press('p')
  expect(latest.tools).toEqual({ mcp__github__tool_000: { pinned: true } })
  expect(document.activeElement?.getAttribute('aria-label')).toContain('pinned, set here, unsaved')
  press('Delete')
  expect(latest).toEqual({ tools: {}, groups: {} })
  press('ArrowLeft')
  expect(document.activeElement).toBe(items(container)[0])
  press(' ')
  expect(latest.groups).toEqual({ 'mcp:github': { enabled: false } })
  expect(container.textContent).toContain('1 of 121 tools selected')
})

it('the filter opens matching groups only and Escape clears it', () => {
  const container = mount()
  const filter = container.querySelector<HTMLInputElement>('input[aria-label="Filter tools"]')
  if (filter === null) throw new Error('no filter')
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setValue?.call(filter, 'read a file')
    filter.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(items(container).map(row => row.getAttribute('aria-label')?.split(',')[0])).toEqual(['DSH', 'read'])
  act(() => {
    filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
  expect(items(container)).toHaveLength(2)
})
