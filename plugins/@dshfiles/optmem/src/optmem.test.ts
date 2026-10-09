import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

import { SessionId } from '@deepseek-ai/dsh-session/types'
import { openSqliteMemory } from '@dshfiles/optmem-sqlite'

import { createSessionFixture, createTempHome, createTestRuntime, fakeSummarizer } from './testing/dsh-fixtures.ts'
import { createMemoryToolHandlers } from './tools.ts'

const home = createTempHome()
afterAll(() => home.cleanup())

let databases = 0
const freshDatabase = (): string => join(home.directory, `memory-${databases++}`, 'optmem.db')

const projectA = '/work/project-a'
const projectB = '/work/project-b'
const workspaces = { [projectA]: 'ws-a' }

const storedEvents = (path: string) => {
  const reader = openSqliteMemory({ path })
  const rows = reader.database.prepare('SELECT event_key, conversation_id, project_id, parent_conversation_id, role, text FROM events ORDER BY id').all()
  reader.close()
  return rows.map(row => ({
    key: String(row['event_key']),
    conversation: String(row['conversation_id']),
    project: row['project_id'] === null ? null : String(row['project_id']),
    parent: row['parent_conversation_id'] === null ? null : String(row['parent_conversation_id']),
    role: String(row['role']),
    text: String(row['text']),
  }))
}

const agentOf = (session: { readonly id: string; readonly header: { readonly id: string; readonly cwd?: string } }) => ({
  id: session.id,
  session: { header: session.header },
})

describe('capture', () => {
  it('stores user, assistant text, tool calls and results once, even when DSH re-delivers them', async () => {
    const path = freshDatabase()
    const { runtime } = createTestRuntime({ databasePath: path, workspaces })
    await runtime.start()
    const fixture = createSessionFixture({ id: 'session-a1', cwd: projectA })
    const events = [
      fixture.requestHeader('fake', 'fake-model'),
      fixture.user('Use pnpm 12 for the workspace'),
      fixture.assistant([
        { type: 'reasoning', text: 'private thoughts' },
        { type: 'text', text: 'Noted: pnpm 12.' },
      ]),
      fixture.toolCall('call-1', 'read', { path: '/work/project-a/package.json' }),
      fixture.toolResult('call-1', '{ "packageManager": "pnpm@12.5.1" }'),
      fixture.assistant([{ type: 'reasoning', text: 'only reasoning' }]),
    ]
    for (const event of events) runtime.onSessionEvent(fixture.session, event)
    for (const event of events) runtime.onSessionEvent(fixture.session, event)
    await runtime.settle()
    const stored = storedEvents(path)
    expect(stored.map(event => [event.key, event.role, event.text])).toEqual([
      ['dsh:session-a1:1', 'user', 'Use pnpm 12 for the workspace'],
      ['dsh:session-a1:2', 'assistant', 'Noted: pnpm 12.'],
      ['dsh:session-a1:3', 'tool_call', 'read {"path":"/work/project-a/package.json"}'],
      ['dsh:session-a1:4', 'tool_result', 'read → { "packageManager": "pnpm@12.5.1" }'],
    ])
    expect(stored.every(event => event.project === 'workspace:ws-a' && event.conversation === 'session-a1')).toBe(true)
    await runtime.stop()
  })

  it('skips injected context (runtime, instructions, skills) and compaction checkpoints', async () => {
    const path = freshDatabase()
    const { runtime } = createTestRuntime({ databasePath: path, workspaces })
    await runtime.start()
    const fixture = createSessionFixture({ id: 'session-a2', cwd: projectA })
    const events = [
      fixture.injected('Persistent memory (OptMem): …', 'runtime-context'),
      fixture.injected('<system-reminder>workspace AGENTS.md…', 'agent-instructions'),
      fixture.injected('<system-reminder>skills…', 'skill-catalog'),
      fixture.user('summary of earlier turns', 'compact-checkpoint'),
      fixture.user('real prompt'),
    ]
    for (const event of events) {
      runtime.onSessionEvent(fixture.session, event)
    }
    await runtime.settle()
    expect(storedEvents(path).map(event => event.text)).toEqual(['real prompt'])
    await runtime.stop()
  })

  it('maps a subagent to its own conversation linked to the parent, and can leave subagents out', async () => {
    const path = freshDatabase()
    const { runtime, update } = createTestRuntime({ databasePath: path, workspaces })
    await runtime.start()
    const child = createSessionFixture({ id: 'child-uuid', cwd: projectA, parentSession: SessionId('session-parent'), origin: 'subagent' })
    runtime.onSessionEvent(child.session, child.user('investigate the flaky test'))
    await runtime.settle()
    await update({ captureSubagents: false })
    runtime.onSessionEvent(child.session, child.user('ignored while subagents are off'))
    await runtime.settle()
    expect(storedEvents(path).map(event => [event.conversation, event.parent, event.project, event.text])).toEqual([
      ['child-uuid', 'session-parent', 'workspace:ws-a', 'investigate the flaky test'],
    ])
    await runtime.stop()
  })

  it('keeps only a marker for excluded tools and for calls naming an excluded path, results included', async () => {
    const path = freshDatabase()
    const { runtime } = createTestRuntime({ databasePath: path, workspaces, settings: { excludedTools: ['vault_read'] } })
    await runtime.start()
    const fixture = createSessionFixture({ id: 'session-a3', cwd: projectA })
    const events = [
      fixture.toolCall('c1', 'vault_read', { name: 'prod' }),
      fixture.toolResult('c1', 'super secret value'),
      fixture.toolCall('c2', 'read', { path: '/work/project-a/.env' }),
      fixture.toolResult('c2', 'DATABASE_URL=postgres://user:pw@host/db'),
      fixture.toolCall('c3', 'read', { path: 'src/index.ts' }),
      fixture.toolResult('c3', 'export const ok = true'),
    ]
    for (const event of events) runtime.onSessionEvent(fixture.session, event)
    await runtime.settle()
    const texts = storedEvents(path).map(event => event.text)
    expect(texts).toEqual([
      'vault_read [excluded tool]',
      '[excluded tool output]',
      'read [excluded: arguments name an excluded path]',
      '[excluded tool output]',
      'read {"path":"src/index.ts"}',
      'read → export const ok = true',
    ])
    expect(texts.join('\n')).not.toContain('secret')
    await runtime.stop()
  })
})

describe('tools', () => {
  const seed = async () => {
    const path = freshDatabase()
    const { runtime, update } = createTestRuntime({ databasePath: path, workspaces })
    await runtime.start()
    const first = createSessionFixture({ id: 'session-first', cwd: projectA })
    const second = createSessionFixture({ id: 'session-second', cwd: projectA })
    const other = createSessionFixture({ id: 'session-other', cwd: projectB })
    for (const event of [
      first.user('The staging database port is 6543, not 5432'),
      first.assistant([{ type: 'text', text: 'Recorded: staging uses port 6543.' }]),
    ]) {
      runtime.onSessionEvent(first.session, event)
    }
    runtime.onSessionEvent(second.session, second.user('Start on the release notes'))
    runtime.onSessionEvent(other.session, other.user('Project B keeps its own secrets: zebra-token-777'))
    await runtime.settle()
    const tools = createMemoryToolHandlers(() => runtime)
    return { runtime, update, tools, first, second, other }
  }

  it('recalls another conversation of the same project, then zooms and shows context', async () => {
    const { runtime, tools, second } = await seed()
    const found = await tools.search({ query: '5432' }, agentOf(second.session))
    expect(found.summary).toContain('conversation first')
    expect(found.summary).toContain('untrusted historical data')
    const eventId = Number(/#(\d+)/.exec(found.summary)?.[1])
    const context = await tools.context({ eventId }, agentOf(second.session))
    expect(context.summary).toContain('> 0+1')
    expect(context.summary).toContain('Recorded: staging uses port 6543.')
    const zoomed = await tools.zoom({ address: '0+1' }, agentOf(second.session))
    expect(zoomed.summary).toContain('user: The staging database port is 6543, not 5432')
    const status = await tools.status(agentOf(second.session))
    expect(status.summary).toContain('captureEvents=yes registerTools=yes injectContext=yes replaceContext=no resetPerTurn=no')
    expect(status.summary).toContain('project:workspace:ws-a: 3 events')
    await runtime.stop()
  })

  it('hides other projects unless all-projects retrieval is enabled', async () => {
    const { runtime, update, tools, second } = await seed()
    expect((await tools.search({ query: 'zebra-token-777' }, agentOf(second.session))).summary).toContain('No memory matches')
    await expect(tools.search({ query: 'zebra-token-777', scope: 'all-projects' }, agentOf(second.session))).rejects.toThrow(
      'all-projects retrieval is disabled',
    )
    await expect(tools.zoom({ address: '0+1', conversationId: 'session-other' }, agentOf(second.session))).rejects.toThrow('outside this conversation')
    await update({ allowAllProjects: true })
    expect((await tools.search({ query: 'zebra-token-777', scope: 'all-projects' }, agentOf(second.session))).summary).toContain('conversation other')
    await runtime.stop()
  })

  it('reports a disabled or missing memory as a clear tool error', async () => {
    const { runtime, update, tools, second } = await seed()
    await update({ enabled: false })
    await expect(tools.search({ query: '6543' }, agentOf(second.session))).rejects.toThrow('OptMem is disabled')
    await expect(tools.search({ query: '6543' }, undefined)).rejects.toThrow()
    await runtime.stop()
  })
})

describe('project id switch', () => {
  it('folds memory recorded under the path id into the workspace stream once the workspace is registered', async () => {
    const path = freshDatabase()
    const before = createTestRuntime({ databasePath: path })
    await before.runtime.start()
    const early = createSessionFixture({ id: 'session-early', cwd: projectA })
    before.runtime.onSessionEvent(early.session, early.user('Decision recorded before the workspace existed'))
    await before.runtime.settle()
    await before.runtime.stop()

    const after = createTestRuntime({ databasePath: path, workspaces })
    await after.runtime.start()
    const late = createSessionFixture({ id: 'session-late', cwd: projectA })
    after.runtime.onSessionEvent(late.session, late.user('Question asked after registration'))
    await after.runtime.settle()
    await after.runtime.stop()

    const reader = openSqliteMemory({ path })
    const streams = await reader.store.listStreams()
    const workspaceStream = await reader.store.readStream('project:workspace:ws-a', 0, 10)
    reader.close()
    expect(streams.map(summary => summary.stream).filter(stream => stream.startsWith('project:'))).toEqual(['project:workspace:ws-a'])
    expect(workspaceStream.map(entry => entry.event.text)).toEqual(['Decision recorded before the workspace existed', 'Question asked after registration'])
    expect(storedEvents(path).map(event => event.project)).toEqual(['workspace:ws-a', 'workspace:ws-a'])
  })
})

describe('injection', () => {
  const waitFor = async (condition: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200 && !condition(); attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  }

  it('injects the compact project view without lines that only repeat the reading conversation', async () => {
    const path = freshDatabase()
    const { runtime } = createTestRuntime({ databasePath: path, workspaces })
    await runtime.start()
    const first = createSessionFixture({ id: 'session-one', cwd: projectA })
    const second = createSessionFixture({ id: 'session-two', cwd: projectA })
    runtime.onSessionEvent(first.session, first.user('Decision: deploy with {{ blue-green }} on Fridays only'))
    runtime.onSessionEvent(second.session, second.user('Second conversation asks about the deploy'))
    await runtime.settle()
    await runtime.resolveProject(second.session.header)
    expect(runtime.promptText(agentOf(second.session))).toBe('')
    await waitFor(() => runtime.promptText(agentOf(second.session)).length > 0)
    const forSecond = runtime.promptText(agentOf(second.session))
    expect(forSecond).toContain('untrusted data')
    expect(forSecond).toContain('0+1| user: Decision: deploy with { { blue-green } } on Fridays only')
    expect(forSecond).not.toContain('Second conversation asks')
    expect(forSecond).not.toContain('{{')
    expect(Buffer.byteLength(forSecond)).toBeLessThanOrEqual(2_048)
    expect(runtime.promptText(agentOf(second.session))).toBe(forSecond)
    const forFirst = runtime.promptText(agentOf(first.session))
    expect(forFirst).toContain('Second conversation asks')
    expect(forFirst).not.toContain('Decision: deploy')
    const fresh = createSessionFixture({ id: 'session-three', cwd: projectA })
    await runtime.resolveProject(fresh.session.header)
    const forFresh = runtime.promptText(agentOf(fresh.session))
    expect(forFresh).toContain('Decision: deploy')
    expect(forFresh).toContain('Second conversation asks')
    const elsewhere = createSessionFixture({ id: 'session-b', cwd: projectB })
    await runtime.resolveProject(elsewhere.session.header)
    runtime.promptText(agentOf(elsewhere.session))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(runtime.promptText(agentOf(elsewhere.session))).not.toContain('Decision: deploy')
    await runtime.stop()
  })

  it('keeps the injected view within its budget once the project outgrows it', async () => {
    const path = freshDatabase()
    const summarizer = fakeSummarizer()
    const { runtime } = createTestRuntime({
      databasePath: path,
      workspaces,
      summarizer,
      settings: { injectUpperBytes: 1_200, injectLowerBytes: 600, maxNodeBytes: 128 },
    })
    await runtime.start()
    const writer = createSessionFixture({ id: 'session-writer', cwd: projectA })
    for (let turn = 0; turn < 64; turn++) runtime.onSessionEvent(writer.session, writer.user(`turn ${turn}: ${'context '.repeat(8)}`))
    await runtime.settle()
    const reader = createSessionFixture({ id: 'session-reader', cwd: projectA })
    await runtime.resolveProject(reader.session.header)
    runtime.promptText(agentOf(reader.session))
    const coveredThrough = (text: string): number => {
      const last = /(\d+)\+(\d+)\|[^\n]*$/.exec(text)
      return last ? Number(last[1]) + Number(last[2]) : 0
    }
    await waitFor(() => coveredThrough(runtime.promptText(agentOf(reader.session))) === 64)
    const text = runtime.promptText(agentOf(reader.session))
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1_200)
    expect(coveredThrough(text)).toBe(64)
    expect(text).toMatch(/\n0\+(16|32|64)\|/)
    expect(summarizer.calls).toContain('merge')
    await runtime.stop()
  })
})

describe('failure isolation', () => {
  it('never throws into DSH when the store breaks under it', async () => {
    const path = freshDatabase()
    const { runtime, warnings } = createTestRuntime({ databasePath: path, workspaces })
    await runtime.start()
    const fixture = createSessionFixture({ id: 'session-broken', cwd: projectA })
    runtime.onSessionEvent(fixture.session, fixture.user('before the break'))
    await runtime.settle()
    const corrupt = openSqliteMemory({ path })
    corrupt.database.exec('DROP TABLE stream_entries')
    corrupt.close()
    expect(() => runtime.onSessionEvent(fixture.session, fixture.user('after the break'))).not.toThrow()
    await runtime.settle()
    expect(runtime.status().lastCaptureError).toContain('stream_entries')
    expect(warnings.some(message => message.includes('capture failed'))).toBe(true)
    expect(() => runtime.promptText(agentOf(fixture.session))).not.toThrow()
    await runtime.stop()
  })

  it('degrades to a failed state when the database cannot be opened', async () => {
    const blocker = join(home.directory, 'not-a-directory')
    writeFileSync(blocker, 'file')
    const { runtime } = createTestRuntime({ databasePath: join(blocker, 'optmem.db'), workspaces })
    await runtime.start()
    expect(runtime.status().state).toBe('failed')
    const fixture = createSessionFixture({ id: 'session-failed', cwd: projectA })
    expect(() => runtime.onSessionEvent(fixture.session, fixture.user('lost quietly'))).not.toThrow()
    expect(runtime.promptText(agentOf(fixture.session))).toBe('')
    const tools = createMemoryToolHandlers(() => runtime)
    await expect(tools.search({ query: 'x' }, agentOf(fixture.session))).rejects.toThrow('OptMem memory is unavailable (failed')
    expect((await tools.status(agentOf(fixture.session))).summary).toContain('state failed')
    await runtime.stop()
  })

  it('survives a read-only memory directory', async () => {
    const directory = join(home.directory, 'read-only')
    mkdirSync(directory, { mode: 0o500 })
    chmodSync(directory, 0o500)
    const { runtime } = createTestRuntime({ databasePath: join(directory, 'optmem.db'), workspaces })
    await expect(runtime.start()).resolves.toBeUndefined()
    expect(runtime.status().state).toBe('failed')
    chmodSync(directory, 0o700)
  })
})

describe('backfill', () => {
  it('imports existing sessions once and resumes where it stopped', async () => {
    const path = freshDatabase()
    const old = createSessionFixture({ id: 'session-old', cwd: projectA })
    old.user('Old fact: the cache TTL is 900 seconds')
    old.assistant([{ type: 'text', text: 'TTL 900 noted.' }])
    const older = createSessionFixture({ id: 'session-older', cwd: projectA })
    older.user('Older fact: logs rotate daily')
    const logs = new Map([old, older].map(fixture => [fixture.session.id, fixture]))
    const { runtime } = createTestRuntime({
      databasePath: path,
      workspaces,
      sessionLogs: {
        listSessions: async () => [...logs.values()].map(fixture => ({ header: fixture.session.header })),
        readSession: async sessionId => {
          const fixture = logs.get(sessionId)
          if (!fixture) throw new Error(`unknown ${sessionId}`)
          return { session: fixture.session.header, inheritedEventCount: 0, events: fixture.events }
        },
      },
    })
    await runtime.start()
    expect(await runtime.backfill(1)).toContain('Backfilled 1 session(s), 2 new memory event(s). 1 session(s) never backfilled')
    expect(await runtime.backfill(10)).toContain('Backfilled 1 session(s), 1 new memory event(s). 0 session(s) never backfilled')
    expect(await runtime.backfill(10)).toContain('Backfilled 0 session(s)')
    expect(storedEvents(path).map(event => event.text)).toEqual(['Old fact: the cache TTL is 900 seconds', 'TTL 900 noted.', 'Older fact: logs rotate daily'])
    await runtime.stop()
  })
})
