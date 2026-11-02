import type { SessionId as CoreSessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId as CoreWorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Schema } from 'effect'
import { SessionId, WorkspaceId } from '../src/ids.js'

const acceptsCoreSessionId = (id: CoreSessionId): string => id
const acceptsCoreWorkspaceId = (id: CoreWorkspaceId): string => id

describe('@dshfiles/dshx/ids', () => {
  it.effect('decodes ids into the core brands and encodes them back to plain strings', () =>
    Effect.gen(function* () {
      const session = yield* Schema.decodeUnknownEffect(SessionId)('session-1')
      const workspace = yield* Schema.decodeUnknownEffect(WorkspaceId)('workspace-1')
      expect(acceptsCoreSessionId(session)).toBe('session-1')
      expect(acceptsCoreWorkspaceId(workspace)).toBe('workspace-1')
      expect(yield* Schema.encodeEffect(SessionId)(session)).toBe('session-1')

      const record = yield* Schema.decodeUnknownEffect(Schema.Struct({ sessionId: SessionId }))({ sessionId: 'session-2' })
      expect(acceptsCoreSessionId(record.sessionId)).toBe('session-2')
    }),
  )

  it.effect('rejects empty, oversized and non-string ids', () =>
    Effect.gen(function* () {
      for (const invalid of ['', 'x'.repeat(257), 42, null]) {
        expect(Exit.isFailure(yield* Effect.exit(Schema.decodeUnknownEffect(SessionId)(invalid)))).toBe(true)
        expect(Exit.isFailure(yield* Effect.exit(Schema.decodeUnknownEffect(WorkspaceId)(invalid)))).toBe(true)
      }
    }),
  )

  it('keeps the two brands apart at the type level', () => {
    const session = Schema.decodeUnknownSync(SessionId)('same')
    // @ts-expect-error a Session id is not a Workspace id
    acceptsCoreWorkspaceId(session)
    // @ts-expect-error a plain string carries no brand
    acceptsCoreSessionId('plain')
    expect(session).toBe('same')
  })
})
