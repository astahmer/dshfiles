import { describe, expect, test } from 'vitest'
import { projectChecksApi } from './api.js'

describe('project-checks tool exposure', () => {
  test('every project-check read and run is a named tool', () => {
    const tools = Object.values(projectChecksApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'project_checks_actions',
      'project_checks_hook_events',
      'project_checks_receipts',
      'project_checks_run',
    ])
    const readOnly = tools
      .filter(tool => tool.readOnly === true)
      .map(tool => tool.name)
      .sort()
    expect(readOnly).toEqual(['project_checks_actions', 'project_checks_hook_events', 'project_checks_receipts'])
    for (const method of Object.values(projectChecksApi.methods)) {
      expect(method.description ?? method.tool?.description).toBeTruthy()
    }
    expect(projectChecksApi.methods.run.description).toMatch(/Call only when the user asked/u)
  })

  test('sessionId is optional so a tool defaults to the calling thread', async () => {
    const schema = projectChecksApi.methods.actions.input
    if (schema === undefined) throw new Error('actions must declare an input schema')
    const validate = async (value: { readonly sessionId?: string | undefined }) => await schema['~standard'].validate(value)
    expect('issues' in (await validate({}))).toBe(false)
    expect('issues' in (await validate({ sessionId: 'session-a' }))).toBe(false)
  })
})
