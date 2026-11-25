import { describe, expect, it, vi } from 'vitest'
import { Agents, type Agent } from './agent.js'
import { createComposerAgentPreparer, type ComposerAgentPorts } from './composer-agent-preparer.js'

const agent = (handle: string, overrides: Partial<Agent> = {}): Agent => ({
  ...Agents.builtIn(0),
  handle,
  name: handle,
  description: '',
  instructions: `Act as ${handle}.`,
  builtIn: false,
  ...overrides,
})

const reviewer = agent('reviewer', { preset: 'review', route: { provider: 'openai', model: 'gpt-6' } })
const luna = agent('luna')

const ports = (overrides: Partial<ComposerAgentPorts> = {}) => {
  const value = {
    listAgents: vi.fn(async () => [Agents.builtIn(0), reviewer, luna]),
    hostAgentOf: vi.fn<ComposerAgentPorts['hostAgentOf']>(async () => ({ projectDefault: 'reviewer', decided: null })),
    choiceOf: vi.fn<ComposerAgentPorts['choiceOf']>(() => null),
    clearChoice: vi.fn(),
    modelPicked: vi.fn(() => false),
    applyPreset: vi.fn<ComposerAgentPorts['applyPreset']>(async () => null),
    applyModel: vi.fn<ComposerAgentPorts['applyModel']>(async () => null),
    recordAgent: vi.fn(async () => undefined),
    rename: vi.fn<ComposerAgentPorts['rename']>(async () => null),
    ...overrides,
  } satisfies ComposerAgentPorts
  return value
}

const send = (value: ComposerAgentPorts, text: string) =>
  createComposerAgentPreparer(value).prepare({ sessionId: 's1', text, signal: new AbortController().signal })

describe('the composer agent first send', () => {
  it('starts the thread as the project default agent: preset, model and instructions, no manual step', async () => {
    const value = ports()
    const prepared = await send(value, 'Review the diff')
    expect(value.applyPreset).toHaveBeenCalledWith('s1', 'review')
    expect(value.applyModel).toHaveBeenCalledWith({ sessionId: 's1', provider: 'openai', model: 'gpt-6' })
    expect(value.recordAgent).not.toHaveBeenCalled()
    expect(prepared?.text).toMatch(/^Work as @reviewer — reviewer\.\n\nAct as reviewer\.\n\n---\n\nReview the diff$/u)
    expect(value.rename).toHaveBeenCalledWith('s1', 'Review the diff')
  })

  it('records the project default when the Host already decided another agent for this blank thread', async () => {
    const value = ports({ hostAgentOf: vi.fn(async () => ({ projectDefault: 'reviewer', decided: 'dsh' })) })
    await send(value, 'x')
    expect(value.recordAgent).toHaveBeenCalledWith('s1', 'reviewer')
  })

  it('keeps a model the person picked for the draft', async () => {
    const value = ports({ modelPicked: vi.fn(() => true) })
    await send(value, 'x')
    expect(value.applyModel).not.toHaveBeenCalled()
  })

  it('a pick in the chip starts it as that agent and records it, then forgets the pick', async () => {
    const value = ports({ choiceOf: vi.fn(() => 'luna') })
    const prepared = await send(value, 'x')
    expect(value.recordAgent).toHaveBeenCalledWith('s1', 'luna')
    expect(value.applyPreset).not.toHaveBeenCalled()
    expect(value.clearChoice).toHaveBeenCalledWith('s1')
    expect(prepared?.text.startsWith('Work as @luna')).toBe(true)
  })

  it('a leading mention wins and is recorded', async () => {
    const value = ports({ choiceOf: vi.fn(() => 'dsh') })
    const prepared = await send(value, '@{luna} write the notes')
    expect(value.recordAgent).toHaveBeenCalledWith('s1', 'luna')
    expect(prepared?.text.endsWith('@{luna} write the notes')).toBe(true)
  })

  it('@dsh for this thread records @dsh and sends the message as typed', async () => {
    const value = ports({ choiceOf: vi.fn(() => 'dsh') })
    await expect(send(value, 'x')).resolves.toBeUndefined()
    expect(value.recordAgent).toHaveBeenCalledWith('s1', 'dsh')
    expect(value.rename).not.toHaveBeenCalled()
    expect(value.applyPreset).not.toHaveBeenCalled()
  })

  it('a Host step that fails still sends the introduced message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const value = ports({ applyPreset: vi.fn(async () => 'preset refused'), recordAgent: vi.fn(() => Promise.reject(new Error('down'))) })
    const prepared = await send(value, 'x')
    expect(prepared?.text.startsWith('Work as @reviewer')).toBe(true)
  })

  it('a Host step that throws is skipped: the model, title and introduced message still go out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const value = ports({ applyPreset: vi.fn(() => Promise.reject(new Error('cannot get property "remote.agentPresets" without inject'))) })
    const prepared = await send(value, 'Review the diff')
    expect(value.applyModel).toHaveBeenCalledWith({ sessionId: 's1', provider: 'openai', model: 'gpt-6' })
    expect(value.rename).toHaveBeenCalledWith('s1', 'Review the diff')
    expect(prepared?.text.startsWith('Work as @reviewer')).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('kept its Agent preset instead of review: cannot get property'))
  })

  it('a slash command passes through untouched', async () => {
    const value = ports()
    await expect(send(value, '/plan')).resolves.toBeUndefined()
    expect(value.applyPreset).not.toHaveBeenCalled()
    expect(value.clearChoice).not.toHaveBeenCalled()
  })
})
