import { describe, expect, test } from 'vitest'
import { editorApi } from './api.js'

describe('editor tool exposure', () => {
  test('the guarded save is an agent tool', () => {
    const tools = Object.values(editorApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name)).toEqual(['editor_write'])
    expect(editorApi.methods.write.description).toMatch(/sha256/u)
    expect(editorApi.methods.write.description).toMatch(/overwrite: true only when the user asked/u)
    expect(editorApi.methods.write.tool?.readOnly).toBeUndefined()
  })

  test('sessionId is optional so a tool defaults to the calling thread', async () => {
    const schema = editorApi.methods.write.input
    if (schema === undefined) throw new Error('write must declare an input schema')
    const validate = async (value: {
      readonly path: string
      readonly text: string
      readonly expectedSha256: string | null
      readonly sessionId?: string | undefined
    }) => await schema['~standard'].validate(value)
    const base = { path: 'a.ts', text: 'x', expectedSha256: null }
    expect('issues' in (await validate(base))).toBe(false)
    expect('issues' in (await validate({ ...base, sessionId: 'session-a' }))).toBe(false)
  })
})
