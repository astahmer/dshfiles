// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { PluginQueryProvider, QueryClient } from '@dshfiles/plugin-ui/query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agents, type Agent } from './agent.js'
import { ComposerAgentChip } from './composer-agent-chip.js'
import { ComposerAgentChoices } from './composer-agent-choices.js'
import type { ThreadAccessView } from './thread-agents.js'
import { ThreadToolsControl } from './thread-tools-control.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

const agent = (handle: string, overrides: Partial<Agent> = {}): Agent => ({ ...Agents.builtIn(0), handle, name: handle, builtIn: false, ...overrides })
const dsh = Agents.builtIn(0)
const reviewer = agent('reviewer')

let root: Root | undefined
afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  ComposerAgentChoices.set('s1', null)
})

const render = async (node: JSX.Element): Promise<HTMLElement> => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<PluginQueryProvider client={new QueryClient()}>{node}</PluginQueryProvider>))
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return container
}

const chip = (input: { agents: readonly Agent[]; defaults: { projectId: string; handle: string }[]; projectId?: string }) => (
  <ComposerAgentChip
    sessionId="s1"
    projectId={input.projectId ?? 'w-app'}
    loadAgents={async () => input.agents}
    loadProjectDefaults={async () => input.defaults}
    setProjectDefault={async (projectId, handle) => ({ kind: 'applied', projects: handle === null ? [] : [{ projectId, handle }] })}
  />
)

const trigger = (container: HTMLElement): HTMLButtonElement | null => container.querySelector('button[data-composer-agent]')

describe('the new-thread agent chip', () => {
  it('shows the project default agent with no manual step', async () => {
    const container = await render(chip({ agents: [dsh, reviewer], defaults: [{ projectId: 'w-app', handle: 'reviewer' }] }))
    const button = trigger(container)
    expect(button?.dataset.composerAgent).toBe('reviewer')
    expect(button?.dataset.composerAgentSource).toBe('project-default')
    expect(button?.textContent).toContain('@reviewer')
    expect(button?.getAttribute('aria-label')).toBe('New thread runs as @reviewer (project default). Change agent')
  })

  it('stays hidden for someone with no agents of their own and no project default', async () => {
    const container = await render(chip({ agents: [dsh], defaults: [] }))
    expect(trigger(container)).toBeNull()
  })

  it('offers @dsh in a project without a default once own agents exist', async () => {
    const container = await render(chip({ agents: [dsh, reviewer], defaults: [] }))
    expect(trigger(container)?.dataset.composerAgent).toBe('dsh')
  })

  it('opens on a tap, not on pointer-down, so a release over the phone sheet picks nothing', async () => {
    const container = await render(chip({ agents: [dsh, reviewer], defaults: [{ projectId: 'w-app', handle: 'reviewer' }] }))
    const button = trigger(container)
    await act(async () => button?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })))
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 })))
    expect(document.querySelector('[role="menu"]')?.textContent).toContain('Stop using @reviewer as this project’s default')
  })

  it('follows a pick for this one thread', async () => {
    const container = await render(chip({ agents: [dsh, reviewer], defaults: [{ projectId: 'w-app', handle: 'reviewer' }] }))
    await act(async () => ComposerAgentChoices.set('s1', 'dsh'))
    expect(trigger(container)?.dataset.composerAgent).toBe('dsh')
    expect(trigger(container)?.dataset.composerAgentSource).toBe('choice')
  })
})

const access = (override: ThreadAccessView['agent']['override']): ThreadAccessView => ({
  sessionId: 's1',
  recorded: true,
  agent: {
    sessionId: 's1',
    handle: 'reviewer',
    resolution: 'project-default',
    projectId: 'w-app',
    inheritedFrom: null,
    access: { tools: {}, groups: {} },
    decidedAt: 1,
    override,
  },
  policy: {
    agent: 'reviewer',
    source: override === null ? 'project-default' : 'override',
    toolsFrom: override === null ? 'reviewer' : override.kind === 'all' ? null : override.handle,
    access: { tools: {}, groups: {} },
    change: '',
  },
})

describe('the running thread Tools control', () => {
  const control = (view: ThreadAccessView, setOverride = vi.fn()) => (
    <ThreadToolsControl sessionId="s1" loadAgents={async () => [dsh, reviewer]} loadAccess={async () => view} setOverride={setOverride} />
  )

  it('names the agent and its source', async () => {
    const container = await render(control(access(null)))
    const button = container.querySelector<HTMLButtonElement>('button[data-thread-tools]')
    expect(button?.dataset.threadTools).toBe('agent:reviewer')
    expect(button?.dataset.threadToolsSource).toBe('project-default')
    expect(button?.getAttribute('aria-label')).toBe("Tools: @reviewer's tools. Thread agent @reviewer (project default). Change tools")
  })

  it('shows an all-tools override', async () => {
    const container = await render(control(access({ kind: 'all' })))
    const button = container.querySelector<HTMLButtonElement>('button[data-thread-tools]')
    expect(button?.dataset.threadTools).toBe('all')
    expect(button?.dataset.threadToolsSource).toBe('override')
    expect(button?.textContent).toContain('All tools')
  })
})
