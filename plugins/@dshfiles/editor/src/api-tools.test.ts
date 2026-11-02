import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { editorApi, editorWriteInputSchema } from './api.js'

describe('editor tool exposure', () => {
  test('the guarded save is an agent tool', () => {
    const tools = Object.values(editorApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name)).toEqual(['editor_write'])
    expect(editorApi.methods.write.description).toMatch(/sha256/u)
    expect(editorApi.methods.write.description).toMatch(/overwrite: true only when the user asked/u)
    expect(editorApi.methods.write.tool?.readOnly).toBeUndefined()
  })

  test('sessionId is optional so a tool defaults to the calling thread', () => {
    const decode = Schema.decodeUnknownSync(editorWriteInputSchema)
    const base = { path: 'a.ts', text: 'x', expectedSha256: null }
    expect(decode(base)).toEqual({ ...base, overwrite: false })
    expect(decode({ ...base, sessionId: 'session-a' })).toEqual({ ...base, sessionId: 'session-a', overwrite: false })
  })
})
