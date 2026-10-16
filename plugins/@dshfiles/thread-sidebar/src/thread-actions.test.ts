import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { describe, expect, test } from 'vitest'
import { createThreadActions, type ProjectRow, type ThreadActionDeps, type ThreadSummary } from './thread-actions.js'
import { threadActionsApi } from './thread-actions-api.js'

const signal = new AbortController().signal
const agent = (sessionId: string): ApiCaller => ({ kind: 'agent', sessionId })

const summary = (sessionId: string, overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
  sessionId,
  updatedAt: 1,
  running: false,
  agentAvailable: false,
  ...overrides,
})

const project = (projectId: string, sessionIds: readonly string[] = []): ProjectRow => ({
  projectId,
  title: `project ${projectId}`,
  path: `/work/${projectId}`,
  sessionIds,
})

const createDeps = (overrides: Partial<ThreadActionDeps> = {}): ThreadActionDeps => ({
  listSessions: async () => [summary('session-a'), summary('session-b')],
  readTitles: async ids => new Map(ids.map(id => [id, `title ${id}`])),
  projects: () => [],
  archivedSessionIds: () => [],
  pinnedSessionIds: () => [],
  archive: async () => ['session-a'],
  unarchive: async () => [],
  pin: async () => ['session-a'],
  unpin: async () => [],
  rename: async (_sessionId, title) => ({ title }),
  fork: async () => ({ sessionId: 'session-fork' }),
  create: async () => ({ sessionId: 'session-new' }),
  stop: async () => undefined,
  selectModel: async input => ({ provider: input.provider, model: input.model }),
  registerProject: async (path, title) => ({ projectId: 'project-1', title: title ?? path, path, created: true }),
  renameProject: async (projectId, title) => ({ projectId, title }),
  deleteProject: async () => undefined,
  reorderProject: async () => ['project-1'],
  moveSession: async () => ['session-a'],
  ...overrides,
})

const codeOf = (error: unknown): string | undefined => (error instanceof PluginApiError ? error.code : undefined)

describe('thread actions: list', () => {
  test('hides archived threads by default and reports pinned state', async () => {
    const actions = createThreadActions(
      createDeps({
        listSessions: async () => [summary('session-a', { running: true }), summary('session-b')],
        archivedSessionIds: () => ['session-b'],
        pinnedSessionIds: () => ['session-a'],
      }),
    )

    const result = await actions.list({ input: {}, caller: agent('session-a'), signal })

    expect(result.threads).toEqual([
      {
        sessionId: 'session-a',
        title: 'title session-a',
        running: true,
        liveAgent: false,
        archived: false,
        pinned: true,
        updatedAt: 1,
      },
    ])
    expect(result.total).toBe(1)
    expect(result.truncated).toBe(false)
  })

  test('restores archived threads on request and attaches their project', async () => {
    const actions = createThreadActions(
      createDeps({
        listSessions: async () => [summary('session-b')],
        projects: () => [project('project-1', ['session-b'])],
        archivedSessionIds: () => ['session-b'],
      }),
    )

    const result = await actions.list({ input: { includeArchived: true }, caller: agent('session-a'), signal })

    expect(result.threads[0]).toMatchObject({
      sessionId: 'session-b',
      projectId: 'project-1',
      projectTitle: 'project project-1',
      archived: true,
    })
  })

  test('matches the query against the title and caps the page', async () => {
    const actions = createThreadActions(
      createDeps({
        listSessions: async () => [summary('session-a'), summary('session-b'), summary('session-c')],
        readTitles: async ids => new Map([...ids.map((id): [string, string] => [id, id === 'session-c' ? 'needle' : `title ${id}`])]),
      }),
    )

    const result = await actions.list({ input: { query: 'needle', limit: 1 }, caller: agent('session-a'), signal })

    expect(result.threads.map(thread => thread.sessionId)).toEqual(['session-c'])
    expect(result.total).toBe(1)
  })
})

describe('thread actions: archive', () => {
  test('archives the calling thread when the user asked to stop it', async () => {
    const requests: Array<{ sessionId: string; stopActivity: boolean }> = []
    const actions = createThreadActions(
      createDeps({
        archive: async (sessionId, stopActivity) => {
          requests.push({ sessionId, stopActivity })
          return [sessionId]
        },
      }),
    )

    const result = await actions.archive({ input: { stopActivity: true }, caller: agent('session-self'), signal })

    expect(requests).toEqual([{ sessionId: 'session-self', stopActivity: true }])
    expect(result).toEqual({
      status: 'archived',
      sessionId: 'session-self',
      archivedSessionIds: ['session-self'],
      activity: [],
    })
  })

  test('never stops work on its own: a running thread is refused with its activity', async () => {
    const refusal = Object.assign(new Error('session is active'), {
      code: 'workspace/session-active',
      details: { sessionId: 'session-b', activity: [{ kind: 'turn' }, { kind: 'job', items: [{ id: 'job-1' }] }] },
    })
    const calls: Array<{ sessionId: string; stopActivity: boolean }> = []
    const actions = createThreadActions(
      createDeps({
        archive: async (sessionId, stopActivity) => {
          calls.push({ sessionId, stopActivity })
          if (!stopActivity) return Promise.reject(refusal)
          return [sessionId]
        },
      }),
    )

    expect(await actions.archive({ input: { sessionId: 'session-b' }, caller: agent('session-a'), signal })).toEqual({
      status: 'refused-active',
      sessionId: 'session-b',
      archivedSessionIds: [],
      activity: ['turn', 'job'],
    })
    expect(calls).toEqual([{ sessionId: 'session-b', stopActivity: false }])

    expect(await actions.archive({ input: { sessionId: 'session-b', stopActivity: true }, caller: agent('session-a'), signal })).toEqual({
      status: 'archived',
      sessionId: 'session-b',
      archivedSessionIds: ['session-b'],
      activity: [],
    })
  })

  test('refuses an unknown target and maps a missing thread', async () => {
    const actions = createThreadActions(createDeps())
    await expect(actions.rename({ input: { title: 'x' }, caller: { kind: 'plugin', packageId: '@dshfiles/x' }, signal })).rejects.toMatchObject({
      code: 'thread-target-unknown',
    })

    const missing = createThreadActions(
      createDeps({
        archive: async () => Promise.reject(Object.assign(new Error('gone'), { code: 'session/not-found' })),
      }),
    )
    await expect(missing.archive({ input: { sessionId: 'session-z' }, caller: agent('session-a'), signal })).rejects.toSatisfy(
      error => codeOf(error) === 'thread-not-found',
    )
  })
})

describe('thread actions: lifecycle', () => {
  test('routes rename, fork, stop and model selection to the named thread', async () => {
    const renamed: string[] = []
    const forked: Array<{ sessionId: string; atSeq: number | undefined }> = []
    const stopped: string[] = []
    const actions = createThreadActions(
      createDeps({
        rename: async (sessionId, title) => {
          renamed.push(sessionId)
          return { title }
        },
        fork: async (sessionId, atSeq) => {
          forked.push({ sessionId, atSeq })
          return { sessionId: 'session-fork' }
        },
        stop: async sessionId => {
          stopped.push(sessionId)
        },
      }),
    )

    expect(await actions.rename({ input: { sessionId: 'session-b', title: 'Renamed' }, caller: agent('session-a'), signal })).toEqual({
      sessionId: 'session-b',
      title: 'Renamed',
    })
    expect(await actions.fork({ input: { sessionId: 'session-b', atSeq: 7 }, caller: agent('session-a'), signal })).toEqual({
      sessionId: 'session-b',
      forkedSessionId: 'session-fork',
    })
    expect(await actions.stop({ input: { sessionId: 'session-b' }, caller: agent('session-a'), signal })).toEqual({
      sessionId: 'session-b',
      accepted: true,
    })
    expect(await actions.selectModel({ input: { sessionId: 'session-b', provider: 'deepseek', model: 'v4' }, caller: agent('session-a'), signal })).toEqual({
      sessionId: 'session-b',
      provider: 'deepseek',
      model: 'v4',
    })
    expect(renamed).toEqual(['session-b'])
    expect(forked).toEqual([{ sessionId: 'session-b', atSeq: 7 }])
    expect(stopped).toEqual(['session-b'])
  })

  test('creates and names a thread, and keeps the new id when the title is refused', async () => {
    const created: Array<{ projectId?: string }> = []
    const actions = createThreadActions(
      createDeps({
        create: async input => {
          created.push(input)
          return { sessionId: 'session-new' }
        },
      }),
    )

    expect(await actions.create({ input: { projectId: 'project-1', title: 'Fresh' }, caller: agent('session-a'), signal })).toEqual({
      sessionId: 'session-new',
      title: 'Fresh',
    })
    expect(created).toEqual([{ projectId: 'project-1' }])

    const refused = createThreadActions(createDeps({ rename: async () => Promise.reject(new Error('title refused')) }))
    expect(await refused.create({ input: { title: 'Fresh' }, caller: agent('session-a'), signal })).toEqual({
      sessionId: 'session-new',
    })
  })
})

describe('thread actions: projects', () => {
  test('lists, registers, renames, reorders and deletes projects', async () => {
    const actions = createThreadActions(createDeps({ projects: () => [project('project-1', ['session-a', 'session-b'])] }))

    expect(await actions.projectList()).toEqual({
      projects: [{ projectId: 'project-1', title: 'project project-1', path: '/work/project-1', threadCount: 2 }],
    })
    expect(await actions.projectRegister({ input: { path: '/work/new', title: 'New' }, caller: agent('session-a'), signal })).toEqual({
      projectId: 'project-1',
      title: 'New',
      path: '/work/new',
      created: true,
    })
    expect(await actions.projectRename({ input: { projectId: 'project-1', title: 'Renamed' }, caller: agent('session-a'), signal })).toEqual({
      projectId: 'project-1',
      title: 'Renamed',
    })
    expect(await actions.projectReorder({ input: { projectId: 'project-1' }, caller: agent('session-a'), signal })).toEqual({
      projectIds: ['project-1'],
    })
    expect(await actions.projectDelete({ input: { projectId: 'project-1' }, caller: agent('session-a'), signal })).toEqual({
      projectId: 'project-1',
      deleted: true,
    })
  })

  test('moves a thread into a project', async () => {
    const moves: Array<{ projectId: string; sessionId: string; before: string | undefined }> = []
    const actions = createThreadActions(
      createDeps({
        moveSession: async (projectId, sessionId, beforeSessionId) => {
          moves.push({ projectId, sessionId, before: beforeSessionId })
          return [sessionId]
        },
      }),
    )

    expect(
      await actions.move({
        input: { sessionId: 'session-a', projectId: 'project-1', beforeSessionId: 'session-b' },
        caller: agent('session-a'),
        signal,
      }),
    ).toEqual({ sessionId: 'session-a', projectId: 'project-1', sessionIds: ['session-a'] })
    expect(moves).toEqual([{ projectId: 'project-1', sessionId: 'session-a', before: 'session-b' }])
  })
})

describe('thread actions: tool exposure', () => {
  test('every action is a uniquely named tool with a model-facing description', () => {
    const names = Object.values(threadActionsApi.methods).map(method => method.tool?.name)
    expect(names).toEqual([
      'thread_list',
      'thread_archive',
      'thread_unarchive',
      'thread_pin',
      'thread_unpin',
      'thread_rename',
      'thread_fork',
      'thread_create',
      'thread_stop',
      'thread_select_model',
      'project_list',
      'project_register',
      'project_rename',
      'project_delete',
      'project_reorder',
      'thread_move',
    ])
    expect(new Set(names).size).toBe(names.length)
    for (const method of Object.values(threadActionsApi.methods)) {
      expect(method.tool).toBeDefined()
      expect(method.description).toBeTruthy()
    }
  })

  test('only the read-only listings opt out of exclusive scheduling', () => {
    const readOnly = Object.values(threadActionsApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
    expect(readOnly).toEqual(['thread_list', 'project_list'])
  })
})
