import { describe, expect, it } from 'vitest'
import { Agents, type Agent } from './agent.js'
import { ComposerAgent } from './composer-agent.js'
import { AgentDispatch } from './dispatch.js'

const agent = (handle: string, overrides: Partial<Agent> = {}): Agent => ({
  ...Agents.builtIn(0),
  handle,
  name: handle[0]?.toUpperCase() + handle.slice(1),
  description: '',
  instructions: `Act as ${handle}.`,
  builtIn: false,
  ...overrides,
})

const dsh = Agents.builtIn(0)
const reviewer = agent('reviewer', { preset: 'review', route: { provider: 'openai', model: 'gpt-6', reasoningEffort: 'high' } })
const luna = agent('luna')
const off = agent('off', { enabled: false })
const agents = [dsh, reviewer, luna, off]

describe('ComposerAgent.resolve', () => {
  it('starts a new thread as the project default agent with no manual step', () => {
    expect(ComposerAgent.resolve({ agents, projectDefault: 'reviewer', choice: null, text: 'Fix it' })).toMatchObject({
      agent: { handle: 'reviewer' },
      source: 'project-default',
    })
  })

  it('falls back to @dsh without a project default, or when the default no longer names an enabled agent', () => {
    expect(ComposerAgent.resolve({ agents, projectDefault: null, choice: null }).agent.handle).toBe('dsh')
    expect(ComposerAgent.resolve({ agents, projectDefault: 'gone', choice: null }).source).toBe('default')
    expect(ComposerAgent.resolve({ agents, projectDefault: 'off', choice: null }).source).toBe('default')
  })

  it('a pick in the chip beats the project default, @dsh included', () => {
    expect(ComposerAgent.resolve({ agents, projectDefault: 'reviewer', choice: 'luna' })).toMatchObject({ agent: { handle: 'luna' }, source: 'choice' })
    expect(ComposerAgent.resolve({ agents, projectDefault: 'reviewer', choice: 'dsh' })).toMatchObject({ agent: { handle: 'dsh' }, source: 'choice' })
  })

  it('a leading mention wins over the pick and the project default', () => {
    for (const text of ['@{luna} draft the release notes', '@luna draft the release notes', '  @{luna}'])
      expect(ComposerAgent.resolve({ agents, projectDefault: 'reviewer', choice: 'dsh', text })).toMatchObject({
        agent: { handle: 'luna' },
        source: 'mention',
      })
  })

  it('a mention mid-sentence, or of a disabled or unknown agent, does not decide', () => {
    expect(ComposerAgent.resolve({ agents, projectDefault: 'reviewer', choice: null, text: 'compare with @{luna}' }).source).toBe('project-default')
    expect(ComposerAgent.resolve({ agents, projectDefault: 'reviewer', choice: null, text: '@{off} go' }).source).toBe('project-default')
    expect(ComposerAgent.resolve({ agents, projectDefault: 'reviewer', choice: null, text: '@{nobody} go' }).source).toBe('project-default')
  })
})

describe('ComposerAgent.plan', () => {
  it('applies the project default agent: preset and introduction, no record (the Host decides it as project default)', () => {
    expect(ComposerAgent.plan({ agents, projectDefault: 'reviewer', choice: null, text: 'Fix it' })).toMatchObject({
      agent: { handle: 'reviewer' },
      record: false,
      preset: 'review',
      introduce: true,
    })
  })

  it('records an agent the Host would not decide: a pick or a mention', () => {
    expect(ComposerAgent.plan({ agents, projectDefault: 'reviewer', choice: 'luna', text: 'x' })).toMatchObject({ record: true, introduce: true })
    expect(ComposerAgent.plan({ agents, projectDefault: null, choice: null, text: '@{reviewer} x' })).toMatchObject({ record: true, preset: 'review' })
  })

  it('switching to @dsh in a project with a default records @dsh and sends the message as typed', () => {
    expect(ComposerAgent.plan({ agents, projectDefault: 'reviewer', choice: 'dsh', text: 'x' })).toMatchObject({
      agent: { handle: 'dsh' },
      record: true,
      preset: null,
      introduce: false,
    })
  })

  it('records the project default over an agent the Host decided before the default existed', () => {
    expect(ComposerAgent.plan({ agents, projectDefault: 'reviewer', choice: null, text: 'x', decided: 'dsh' })).toMatchObject({
      agent: { handle: 'reviewer' },
      record: true,
    })
    expect(ComposerAgent.plan({ agents, projectDefault: 'reviewer', choice: null, text: 'x', decided: 'reviewer' })?.record).toBe(false)
  })

  it('leaves a thread with no default and no pick alone', () => {
    expect(ComposerAgent.plan({ agents, projectDefault: null, choice: null, text: 'x' })).toMatchObject({ record: false, preset: null, introduce: false })
  })

  it('sends a slash command as typed', () => {
    expect(ComposerAgent.plan({ agents, projectDefault: 'reviewer', choice: null, text: '/plan' })).toBeNull()
  })
})

describe('the composer opening message', () => {
  it('opens like a dispatch and keeps the message exactly as typed, however long', () => {
    const text = `@{reviewer} ${'x'.repeat(5_000)}\n`
    const message = AgentDispatch.composerMessage(reviewer, text)
    expect(message.startsWith('Work as @reviewer — Reviewer.\n\nAct as reviewer.\n\n---\n\n')).toBe(true)
    expect(message.endsWith(text)).toBe(true)
  })

  it('pins the agent route as a model selection, or none for the harness default', () => {
    // SAFETY: a test session id; selection only copies it.
    const sessionId = 's1' as Parameters<typeof AgentDispatch.modelSelection>[0]
    expect(AgentDispatch.modelSelection(sessionId, reviewer.route)).toEqual({ sessionId, provider: 'openai', model: 'gpt-6', reasoningEffort: 'high' })
    expect(AgentDispatch.modelSelection(sessionId, null)).toBeNull()
  })
})

describe('ComposerAgent.projectOf', () => {
  const workspaces = [
    { workspaceId: 'w-app', path: '/dev/app', sessionIds: ['started'] },
    { workspaceId: 'w-thread', path: '/dev/app-threads/thread-1', sessionIds: [] },
  ]

  it('reads a local draft by its workspace, a thread workspace counting for its project', () => {
    expect(ComposerAgent.projectOf({ workspaces, sessionId: 'local', draftWorkspaceId: 'w-app', cwd: undefined })).toBe('w-app')
    expect(ComposerAgent.projectOf({ workspaces, sessionId: 'local', draftWorkspaceId: 'w-thread', cwd: undefined })).toBe('w-app')
  })

  it('reads a Host thread by membership or cwd', () => {
    expect(ComposerAgent.projectOf({ workspaces, sessionId: 'started', draftWorkspaceId: undefined, cwd: undefined })).toBe('w-app')
    expect(ComposerAgent.projectOf({ workspaces, sessionId: 'other', draftWorkspaceId: undefined, cwd: '/dev/app-threads/thread-1' })).toBe('w-app')
    expect(ComposerAgent.projectOf({ workspaces, sessionId: 'other', draftWorkspaceId: undefined, cwd: '/tmp' })).toBeUndefined()
  })

  it('finds the project default by project id', () => {
    expect(ComposerAgent.projectDefaultOf([{ projectId: 'w-app', handle: 'reviewer' }], 'w-app')).toBe('reviewer')
    expect(ComposerAgent.projectDefaultOf([{ projectId: 'w-app', handle: 'reviewer' }], undefined)).toBeNull()
  })
})
