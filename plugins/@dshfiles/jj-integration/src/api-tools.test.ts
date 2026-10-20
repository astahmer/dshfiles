import { describe, expect, test } from 'vitest'
import { jjIntegrationApi } from './api.js'

describe('jj-integration tool exposure', () => {
  test('every thread-workspace action a human can take is a named tool', () => {
    const tools = Object.values(jjIntegrationApi.methods).map(method => method.tool)
    expect(tools.filter(tool => tool !== undefined).map(tool => tool.name)).toEqual([
      'jj_thread_destination',
      'jj_thread_projects',
      'jj_thread_repositories',
      'jj_thread_isolate',
      'jj_thread_status',
      'jj_thread_rebase',
      'jj_thread_workspace_sync',
      'jj_thread_discard',
      'jj_thread_cleanup',
    ])
  })

  test('read-only inspection stays read-only and every tool explains itself', () => {
    const readOnly = Object.values(jjIntegrationApi.methods)
      .filter(method => method.tool?.readOnly === true)
      .map(method => method.tool?.name)
    expect(readOnly).toEqual(['jj_thread_destination', 'jj_thread_projects', 'jj_thread_repositories', 'jj_thread_status', 'jj_thread_workspace_sync'])
    for (const method of Object.values(jjIntegrationApi.methods)) {
      if (method.tool === undefined) continue
      expect(method.description ?? method.tool.description).toBeTruthy()
      expect(method.tool.render).toBeDefined()
    }
  })

  test('removing a thread workspace never abandons work without an explicit force', async () => {
    const schema = jjIntegrationApi.methods.discard.input
    if (schema === undefined) throw new Error('discard must declare an input schema')
    const validate = async (value: { readonly path: string; readonly force?: boolean | undefined }) => await schema['~standard'].validate(value)

    expect(jjIntegrationApi.methods.discard.description).toContain('Call only when the user asked')
    expect('issues' in (await validate({ path: '/work/thread-abc123' }))).toBe(true)
    expect('issues' in (await validate({ path: '/work/thread-abc123', force: false }))).toBe(false)
  })

  test('threadAt carries the reading Session and stays open to a Host that predates it', async () => {
    const schema = jjIntegrationApi.methods.threadAt.input
    if (schema === undefined) throw new Error('threadAt must declare an input schema')
    const validate = async (value: { readonly path: string; readonly sessionId?: string }) => await schema['~standard'].validate(value)

    expect('issues' in (await validate({ path: '/work/thread-abc123' }))).toBe(false)
    expect('issues' in (await validate({ path: '/work/thread-abc123', sessionId: 'session-abc' }))).toBe(false)
  })
})
