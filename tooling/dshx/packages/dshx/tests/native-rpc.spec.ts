import { describe, expect, test } from 'vitest'
import { nativeRpcRequestSchema } from '../src/platform/native-rpc.js'

describe('native DSH RPC allowlist', () => {
  test('accepts a bounded Session request and rejects unowned methods or extra fields', () => {
    expect(nativeRpcRequestSchema.safeParse({ namespace: 'session', method: 'list', args: {} }).success).toBe(true)
    expect(nativeRpcRequestSchema.safeParse({ namespace: 'session', method: 'create', args: { request: { cwd: '/srv/work' } } }).success).toBe(true)
    expect(nativeRpcRequestSchema.safeParse({ namespace: 'session', method: 'create', args: { request: { cwd: '/srv/work', profile: 'web' } } }).success).toBe(
      false,
    )
    expect(nativeRpcRequestSchema.safeParse({ namespace: 'workspace', method: 'create', args: { path: '/srv/work' } }).success).toBe(false)
  })
})
