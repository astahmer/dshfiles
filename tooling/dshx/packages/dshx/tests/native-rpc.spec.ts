import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { describe, expect, test } from 'vitest'
import { nativeRpcRequestSchema } from '../src/platform/native-rpc.js'

describe('native DSH RPC allowlist', () => {
  test('accepts a bounded Session request and rejects unowned methods or extra fields', () => {
    expect(Option.isSome(Schema.decodeUnknownOption(nativeRpcRequestSchema)({ namespace: 'session', method: 'list', args: {} }))).toBe(true)
    expect(
      Option.isSome(Schema.decodeUnknownOption(nativeRpcRequestSchema)({ namespace: 'session', method: 'create', args: { request: { cwd: '/srv/work' } } })),
    ).toBe(true)
    expect(
      Option.isSome(
        Schema.decodeUnknownOption(nativeRpcRequestSchema)({ namespace: 'session', method: 'create', args: { request: { cwd: '/srv/work', profile: 'web' } } }),
      ),
    ).toBe(false)
    expect(Option.isSome(Schema.decodeUnknownOption(nativeRpcRequestSchema)({ namespace: 'workspace', method: 'create', args: { path: '/srv/work' } }))).toBe(
      false,
    )
  })
})
