import { describe, expect, test } from 'vitest'
import { actionViewSchema, projectChecksApi } from './api.js'

describe('project-checks tool exposure', () => {
  test('every project-check read and run is a named tool', () => {
    const tools = Object.values(projectChecksApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'project_checks_actions',
      'project_checks_cancel',
      'project_checks_dispatch',
      'project_checks_hook_events',
      'project_checks_receipts',
      'project_checks_retry',
      'project_checks_run',
      'project_checks_tasks',
    ])
    const readOnly = tools
      .filter(tool => tool.readOnly === true)
      .map(tool => tool.name)
      .sort()
    expect(readOnly).toEqual(['project_checks_actions', 'project_checks_hook_events', 'project_checks_receipts', 'project_checks_tasks'])
    for (const method of Object.values(projectChecksApi.methods)) {
      expect(method.description ?? method.tool?.description).toBeTruthy()
    }
    expect(projectChecksApi.methods.run.description).toMatch(/Call only when the user asked/u)
  })

  test('retry requires an explicit acknowledgement that effects may repeat', async () => {
    const schema = projectChecksApi.methods.retryTask.input
    if (schema === undefined) throw new Error('retryTask must declare an input schema')
    const validate = async (value: { readonly taskId: string; readonly confirmPossibleDuplicate?: true }) => await schema['~standard'].validate(value)
    expect('issues' in (await validate({ taskId: 'a'.repeat(64) }))).toBe(true)
    expect('issues' in (await validate({ taskId: 'a'.repeat(64), confirmPossibleDuplicate: true }))).toBe(false)
  })

  test('old Host action snapshots default missing replay policy to manual', () => {
    const view = actionViewSchema.parse({
      id: 'verify',
      label: 'Verify',
      description: 'Run configured checks',
      timeoutMs: 30_000,
      verifyBeforeComplete: false,
      execution: { target: 'local', remoteId: null, onRemoteFailure: 'local' },
    })
    expect(view.replayPolicy).toBe('manual')
  })

  test('sessionId is optional so a tool defaults to the calling thread', async () => {
    const schema = projectChecksApi.methods.actions.input
    if (schema === undefined) throw new Error('actions must declare an input schema')
    const validate = async (value: { readonly sessionId?: string | undefined }) => await schema['~standard'].validate(value)
    expect('issues' in (await validate({}))).toBe(false)
    expect('issues' in (await validate({ sessionId: 'session-a' }))).toBe(false)
  })
})
