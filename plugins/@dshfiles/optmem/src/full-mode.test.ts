import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { createSystemMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { Utf8, type Summarizer } from '@dshfiles/optmem-core'

import type { OptmemRuntime } from './runtime.ts'
import { createSessionFixture, createTempHome, createTestRuntime } from './testing/dsh-fixtures.ts'
import { createMemoryToolHandlers } from './tools.ts'

const home = createTempHome()
afterAll(() => home.cleanup())

let databases = 0
const freshDatabase = (): string => join(home.directory, `memory-${databases++}`, 'optmem.db')

describe('full mode capabilities', () => {
  it('stays in compatibility mode on stock DSH', async () => {
    const { runtime } = createTestRuntime({ databasePath: freshDatabase(), settings: { mode: 'full' } })
    await runtime.start()
    const status = await createMemoryToolHandlers(() => runtime).status(undefined)
    expect(status.summary).toContain('replaceContext=no resetPerTurn=no')
    expect(status.summary).toContain('mode full unsupported → compatibility')
    await runtime.stop()
  })

  it('reports full mode when the fork request-messages hook is present', async () => {
    const { runtime } = createTestRuntime({ databasePath: freshDatabase(), settings: { mode: 'full' }, requestMessagesHook: true })
    await runtime.start()
    const status = await createMemoryToolHandlers(() => runtime).status(undefined)
    expect(status.summary).toContain('replaceContext=yes resetPerTurn=yes')
    expect(status.summary).toContain('state ready; mode full\n')
    await runtime.stop()
  })
})

const projectA = '/work/project-a'
const workspaces = { [projectA]: 'ws-a' }

const textOf = (message: Message | undefined): string => {
  const first = message?.content[0]
  return first?.type === 'text' ? first.text : ''
}

/** One DSH conversation as the fork loop sees it: committed events plus the derived request messages. */
const createConversation = (runtime: OptmemRuntime, id: string) => {
  const fixture = createSessionFixture({ id, cwd: projectA })
  const messages: Message[] = [createSystemMessage('You are a test agent.')]
  const agent = { id, session: { header: fixture.session.header, snapshotEvents: () => fixture.events } }
  const commit = (event: SessionEvent): void => {
    runtime.onSessionEvent(fixture.session, event)
    if (event.type === 'user/message') messages.push(event.data)
    if (event.type === 'assistant/message' || event.type === 'tool/result') messages.push(event.data.message)
  }
  return {
    messages,
    commit,
    fixture,
    request: (turn: number, step: number, signal = new AbortController().signal) =>
      runtime.requestMessages({ agent, turn, step, messages: [...messages], signal }),
  }
}

const gatedSummarizer = () => {
  let release = (): void => {}
  const gate = new Promise<void>(done => (release = done))
  const summarizer: Summarizer = { summarize: async request => (await gate, { text: Utf8.clip(`S: ${request.input.join(' ')}`, request.maxBytes), model: 'gated' }) }
  return { summarizer, release: () => release() }
}

describe('full mode requests', () => {
  const fullRuntime = (extra: { readonly summarizer?: Summarizer; readonly barrierMs?: number } = {}) =>
    createTestRuntime({
      databasePath: freshDatabase(),
      workspaces,
      settings: { mode: 'full', barrierMs: extra.barrierMs ?? 1_000 },
      requestMessagesHook: true,
      summarizer: extra.summarizer,
    })

  it('sends system, instructions, the memory view and only the current turn, with a stable prefix inside a turn', async () => {
    const { runtime } = fullRuntime()
    await runtime.start()
    const first = createConversation(runtime, 'session-first')

    first.commit(first.fixture.turnStart(1))
    first.commit(first.fixture.injected('Project instructions: use pnpm.', 'agent-instructions'))
    first.commit(first.fixture.user('The staging database port is 6543.'))
    first.commit(first.fixture.injected('Runtime context v1.', 'runtime-context'))
    const turn1 = (await first.request(1, 1)) ?? []
    expect(turn1.map(textOf).map(text => text.slice(0, 40))).toEqual([
      'You are a test agent.',
      'Project instructions: use pnpm.',
      'Runtime context v1.',
      expect.stringContaining('Persistent memory (OptMem), full mode'),
      'The staging database port is 6543.',
    ])
    expect(textOf(turn1[3])).toContain('(no memory yet)')

    first.commit(first.fixture.assistant([{ type: 'text', text: 'Reading the config.' }]))
    first.commit(first.fixture.toolCall('call-1', 'read', { path: '/work/project-a/config.yml' }))
    first.commit(first.fixture.toolResult('call-1', 'port: 6543'))
    const step2 = (await first.request(1, 2)) ?? []
    expect(step2.slice(0, 4)).toEqual(turn1.slice(0, 4))
    expect(step2[3]).toBe(turn1[3])
    expect(step2.slice(4).map(message => message.role)).toEqual(['user', 'assistant', 'tool'])
    first.commit(first.fixture.assistant([{ type: 'text', text: 'Staging uses 6543.' }]))

    first.commit(first.fixture.turnStart(2))
    first.commit(first.fixture.user('Which port did I mention?'))
    const turn2 = (await first.request(2, 1)) ?? []
    expect(turn2.map(message => message.role)).toEqual(['system', 'user', 'user', 'user', 'user'])
    expect(turn2.slice(0, 3)).toEqual(turn1.slice(0, 3))
    expect(textOf(turn2[3])).toContain('user: The staging database port is 6543.')
    expect(textOf(turn2[3])).toContain('port: 6543')
    expect(textOf(turn2[3])).not.toContain('Which port did I mention?')
    expect(turn2.some(message => textOf(message) === 'The staging database port is 6543.')).toBe(false)
    expect(textOf(turn2[4])).toBe('Which port did I mention?')
    expect(first.messages).toHaveLength(8)

    first.commit(first.fixture.turnStart(3))
    first.commit(first.fixture.injected('Scheduled wake-up.', 'runtime-context'))
    const turn3 = (await first.request(3, 1)) ?? []
    expect(turn3.map(textOf).at(-1)).toBe('Scheduled wake-up.')
    expect(turn3.map(textOf)).toContain('Runtime context v1.')

    const second = createConversation(runtime, 'session-second')
    second.commit(second.fixture.turnStart(1))
    second.commit(second.fixture.user('What staging port did the other conversation record?'))
    const recalled = (await second.request(1, 1)) ?? []
    expect(textOf(recalled[1])).toContain('user: The staging database port is 6543.')
    expect(textOf(recalled[1])).toContain('Which port did I mention?')
    const status = await createMemoryToolHandlers(() => runtime).status(undefined)
    const recalledBytes = new TextEncoder().encode(JSON.stringify(recalled)).byteLength
    expect(status.summary).toContain(`last full-mode request: turn 1 step 1, 2 → 3 messages (${recalledBytes} B sent, 1 carried)`)
    expect(runtime.status().lastFullRequest?.conversationId).toBe('session-second')
    expect(runtime.promptText({ id: 'session-second', session: { header: second.fixture.session.header } })).toBe('')
    await runtime.stop()
  })

  it('keeps the identical view message across turns when memory did not change', async () => {
    const { runtime } = fullRuntime()
    await runtime.start()
    const conversation = createConversation(runtime, 'session-stable')
    conversation.commit(conversation.fixture.turnStart(1))
    conversation.commit(conversation.fixture.user('Checkpoint one.', 'compact-checkpoint'))
    const turn1 = (await conversation.request(1, 1)) ?? []
    conversation.commit(conversation.fixture.turnStart(2))
    conversation.commit(conversation.fixture.user('Checkpoint two.', 'compact-checkpoint'))
    const turn2 = (await conversation.request(2, 1)) ?? []
    expect(turn2[1]).toBe(turn1[1])
    expect(JSON.stringify(turn2.slice(0, 2))).toBe(JSON.stringify(turn1.slice(0, 2)))
    await runtime.stop()
  })

  it('renders events still waiting for a summary as pending lines after the barrier', async () => {
    const gated = gatedSummarizer()
    const { runtime } = fullRuntime({ summarizer: gated.summarizer, barrierMs: 30 })
    await runtime.start()
    const conversation = createConversation(runtime, 'session-pending')
    conversation.commit(conversation.fixture.turnStart(1))
    conversation.commit(conversation.fixture.user(`needle ${'long '.repeat(300)}`))
    conversation.commit(conversation.fixture.turnStart(2))
    conversation.commit(conversation.fixture.user('next'))
    const sent = (await conversation.request(2, 1)) ?? []
    expect(textOf(sent[1])).toMatch(/0\+1\| \[pending summary\] user: needle long/)
    gated.release()
    await runtime.stop()
  })

  it('rejects with the abort reason when the turn is cancelled during the barrier', async () => {
    const gated = gatedSummarizer()
    const { runtime } = fullRuntime({ summarizer: gated.summarizer, barrierMs: 10_000 })
    await runtime.start()
    const conversation = createConversation(runtime, 'session-cancel')
    conversation.commit(conversation.fixture.turnStart(1))
    conversation.commit(conversation.fixture.user(`needle ${'long '.repeat(300)}`))
    conversation.commit(conversation.fixture.turnStart(2))
    conversation.commit(conversation.fixture.user('next'))
    const controller = new AbortController()
    const started = Date.now()
    const pending = conversation.request(2, 1, controller.signal)
    setTimeout(() => controller.abort(new Error('user cancelled')), 20)
    await expect(pending).rejects.toThrow('user cancelled')
    expect(Date.now() - started).toBeLessThan(2_000)
    gated.release()
    await runtime.stop()
  })

  it('leaves requests untouched without the fork hook', async () => {
    const { runtime } = createTestRuntime({ databasePath: freshDatabase(), workspaces, settings: { mode: 'full' } })
    await runtime.start()
    const conversation = createConversation(runtime, 'session-stock')
    conversation.commit(conversation.fixture.turnStart(1))
    conversation.commit(conversation.fixture.user('hello'))
    expect(await conversation.request(1, 1)).toBeUndefined()
    await runtime.stop()
  })
})
