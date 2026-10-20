import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, it } from 'vitest'
import { AgentWarmup } from '../src/agent-warmup.js'

it('warms a thread once, on the first edit that leaves text, not on its restored draft', () => {
  const ctx = new Context()
  const warmed: string[] = []
  ctx.on('dshfiles/composer/first-edit', sessionId => {
    warmed.push(sessionId)
  })
  const state = createSnapshotStore({ draft: 'restored draft', draftRev: 4 })
  AgentWarmup.onFirstEdit({ ctx, sessionId: SessionId('thread-1'), state })

  state.set({ draft: 'restored draft', draftRev: 4 })
  state.set({ draft: '  ', draftRev: 5 })
  expect(warmed).toEqual([])

  state.set({ draft: 'h', draftRev: 6 })
  state.set({ draft: 'hi', draftRev: 7 })
  expect(warmed).toEqual(['thread-1'])
})
