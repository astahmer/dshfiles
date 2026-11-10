import { describe, expect, test } from 'vitest'
import type { ApiSchema } from '@dshfiles/dshx/api'
import { jjIntegrationApi } from './api.js'

const validate = async (schema: ApiSchema | undefined, value: unknown): Promise<boolean> => {
  if (schema === undefined || !('~standard' in schema)) throw new Error('API schema must expose Standard Schema validation')
  const standard = schema['~standard']
  if (typeof standard !== 'object' || standard === null || !('validate' in standard) || typeof standard.validate !== 'function') {
    throw new Error('API schema must expose Standard Schema validation')
  }
  const result = await standard.validate(value)
  return 'issues' in result
}

describe('jj-integration tool exposure', () => {
  test('every thread-workspace action a human can take is a named tool', () => {
    const tools = Object.values(jjIntegrationApi.methods).map(method => method.tool)
    expect(tools.filter(tool => tool !== undefined).map(tool => tool.name)).toEqual([
      'jj_thread_destination',
      'jj_thread_projects',
      'jj_project_bookmark',
      'jj_set_project_bookmark',
      'jj_thread_repositories',
      'jj_thread_refresh_repositories',
      'jj_thread_isolate',
      'jj_thread_review_history',
      'jj_thread_status',
      'jj_thread_rebase',
      'jj_workspace_setup',
      'jj_cancel_workspace_setup',
      'jj_thread_workspace_sync',
      'jj_thread_discard',
      'jj_thread_discard_many',
      'jj_thread_cleanup',
      'jj_thread_cleanup_jobs',
    ])
  })

  test('read-only inspection stays read-only and every tool explains itself', () => {
    const readOnly = Object.values(jjIntegrationApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
    expect(readOnly).toEqual([
      'jj_thread_destination',
      'jj_thread_projects',
      'jj_project_bookmark',
      'jj_thread_repositories',
      'jj_thread_refresh_repositories',
      'jj_thread_review_history',
      'jj_thread_status',
      'jj_thread_workspace_sync',
      'jj_thread_cleanup_jobs',
    ])
    for (const method of Object.values(jjIntegrationApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
      expect(method.tool.render).toBeDefined()
    }
  })

  test('the cleanup tool names the bookmark that makes a workspace removable', () => {
    const render = jjIntegrationApi.methods.cleanupWorkspaces.tool?.render
    if (typeof render !== 'function') throw new Error('jj_thread_cleanup must render its result')
    const row = {
      repoRoot: '/work/project',
      name: 'thread-aaaaaa',
      path: '/t/a',
      kind: 'integrated',
      lastUsedAt: 1,
      missing: false,
      outcome: 'would-remove',
    } as const
    const text = render({ applied: false, workspaces: [{ ...row, integratedInto: ['release'] }], skipped: [], untracked: [], emptyRevisions: [] })
    expect(text).toContain('thread-aaaaaa (integrated into release)')
  })

  test('the cleanup trail tool names the owning project and the safe recovery of a failure', async () => {
    const method = jjIntegrationApi.methods.cleanupJobs
    const render = method.tool?.render
    if (typeof render !== 'function' || method.input === undefined || method.output === undefined)
      throw new Error('jj_thread_cleanup_jobs must take input, declare output and render its trail')
    expect(await validate(method.input, { path: '/work/project-threads/thread-aaaaaa' })).toBe(false)
    expect(await validate(method.input, {})).toBe(false)
    const job = {
      id: 'cleanup-1',
      state: 'failed',
      phase: 'failed',
      request: { path: '/work/project-threads/thread-aaaaaa', olderThanHours: 0, kinds: ['empty'], trigger: 'manual' },
      repoRoot: '/work/project',
      startedAt: 1,
      finishedAt: 2,
      progress: { total: 0, processed: 0, removed: 0, kept: 0, failed: 0, current: null },
      error: 'jj workspace forget exited 1',
      result: null,
      recovery: 'Run Clean up thread workspaces… again.',
    } as const
    const text = render({ repoRoot: '/work/project', jobs: [job] })
    expect(text).toContain('cleanup-1 · /work/project · failed/failed')
    expect(text).toContain('jj workspace forget exited 1')
    expect(text).toContain('Recovery: Run Clean up thread workspaces… again.')
    // A Host from before ownership omits the new fields.
    const { repoRoot: _repoRoot, recovery: _recovery, ...older } = job
    expect(await validate(method.output, { jobs: [older] })).toBe(false)
  })

  test('repository inventory accepts old Host output and reports background refresh state', async () => {
    const output = jjIntegrationApi.methods.repositories.output
    if (output === undefined) throw new Error('repositories must declare an output schema')
    expect(await validate(output, { repositories: [] })).toBe(false)
    expect(await validate(output, { repositories: [{ repoRoot: '/work/project', title: 'project', workspaceId: null, threads: [] }] })).toBe(false)
    expect(await validate(output, { repositories: [], refreshing: true, refreshFailed: false })).toBe(false)
    expect(await validate(output, { repositories: [], refreshing: 'yes' })).toBe(true)

    const refreshOutput = jjIntegrationApi.methods.refreshRepositories.output
    if (refreshOutput === undefined) throw new Error('refreshRepositories must declare an output schema')
    expect(await validate(refreshOutput, { started: true })).toBe(false)
  })

  test('removing a thread workspace never abandons work without an explicit force', async () => {
    const schema = jjIntegrationApi.methods.discard.input
    if (schema === undefined) throw new Error('discard must declare an input schema')
    expect(jjIntegrationApi.methods.discard.description).toContain('Call only when the user asked')
    expect(await validate(schema, { path: '/work/thread-abc123' })).toBe(true)
    expect(await validate(schema, { path: '/work/thread-abc123', force: false })).toBe(false)
  })

  test('batch discard requires explicit confirmation and bounds target count', async () => {
    const schema = jjIntegrationApi.methods.discardMany.input
    if (schema === undefined) throw new Error('discardMany must declare an input schema')
    expect(jjIntegrationApi.methods.discardMany.description).toContain('force: true only when the user explicitly authorized')
    expect(await validate(schema, { paths: ['/work/thread-abc123'], force: false })).toBe(true)
    expect(await validate(schema, { paths: ['/work/thread-abc123'], force: false, confirm: true })).toBe(false)
    expect(await validate(schema, { paths: Array.from({ length: 101 }, (_, index) => `/work/thread-${String(index)}`), force: false, confirm: true })).toBe(
      true,
    )
  })

  test('manual integration accepts an optional non-empty bookmark target', async () => {
    const schema = jjIntegrationApi.methods.land.input
    if (schema === undefined) throw new Error('land must declare an input schema')
    expect(await validate(schema, { path: '/work/thread-abc123' })).toBe(false)
    expect(await validate(schema, { path: '/work/thread-abc123', bookmark: 'release/next' })).toBe(false)
    expect(await validate(schema, { path: '/work/thread-abc123', bookmark: '' })).toBe(true)
  })

  test('agent rebase tool accepts an optional bookmark override', async () => {
    const schema = jjIntegrationApi.methods.landThread.input
    if (schema === undefined) throw new Error('landThread must declare an input schema')

    expect(await validate(schema, {})).toBe(false)
    expect(await validate(schema, { bookmark: 'release/next' })).toBe(false)
    expect(await validate(schema, { bookmark: '' })).toBe(true)
  })

  test('threadAt carries the reading Session and stays open to a Host that predates it', async () => {
    const schema = jjIntegrationApi.methods.threadAt.input
    if (schema === undefined) throw new Error('threadAt must declare an input schema')
    expect(await validate(schema, { path: '/work/thread-abc123' })).toBe(false)
    expect(await validate(schema, { path: '/work/thread-abc123', sessionId: 'session-abc' })).toBe(false)
  })
})
