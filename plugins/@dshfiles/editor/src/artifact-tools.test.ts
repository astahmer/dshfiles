import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { artifactCreateInputSchema, artifactDeleteInputSchema, editorArtifactsApi } from './artifacts-api.js'

describe('artifact tool exposure', () => {
  test('the five artifact verbs are agent tools under the artifact_ prefix', () => {
    const tools = Object.values(editorArtifactsApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name)).toEqual(['artifact_list', 'artifact_read', 'artifact_create', 'artifact_update', 'artifact_delete'])
  })

  test('reads are read-only and writes say the user must have asked', () => {
    expect(editorArtifactsApi.methods.list.tool?.readOnly).toBe(true)
    expect(editorArtifactsApi.methods.read.tool?.readOnly).toBe(true)
    for (const verb of ['create', 'update', 'delete'] as const) {
      expect(editorArtifactsApi.methods[verb].description).toMatch(/only when the user asked/u)
      expect(editorArtifactsApi.methods[verb].tool?.readOnly).toBeUndefined()
    }
  })

  test('delete insists on an explicit confirmation', () => {
    const decode = Schema.decodeUnknownSync(artifactDeleteInputSchema)
    expect(() => decode({ id: 'a', expectedRevision: 1 })).toThrow()
    expect(() => decode({ id: 'a', expectedRevision: 1, confirm: false })).toThrow()
    expect(decode({ id: 'a', expectedRevision: 1, confirm: true })).toEqual({ id: 'a', expectedRevision: 1, confirm: true })
  })

  test('sessionId is optional so a tool defaults to the calling thread, and mime types stay bounded', () => {
    const decode = Schema.decodeUnknownSync(artifactCreateInputSchema)
    expect(decode({ title: 'Notes.md', mimeType: 'text/markdown', content: 'x' })).toEqual({ title: 'Notes.md', mimeType: 'text/markdown', content: 'x' })
    expect(() => decode({ title: 'Notes.txt', mimeType: 'text/plain', content: 'x' })).toThrow()
  })

  test('content above the stored-value ceiling is refused', () => {
    const decode = Schema.decodeUnknownSync(artifactCreateInputSchema)
    expect(() => decode({ title: 'Big.html', mimeType: 'text/html', content: 'é'.repeat(130_000) })).toThrow()
  })
})
