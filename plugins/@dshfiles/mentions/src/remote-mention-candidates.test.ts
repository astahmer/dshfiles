import { expect, test } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { formatSessionReferenceMention, parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
import type { RemoteThreadSummary } from '@dshfiles/multi-host/api'
import { remoteMentionCandidates } from './remote-mention-candidates.js'

const summary = (id: SessionSummary['id'], blank = false): Pick<SessionSummary, 'id' | 'blank'> => ({ id, blank })

const thread = (sessionId: string, title: string, includeMention = true): RemoteThreadSummary => {
  const remoteThread: RemoteThreadSummary = {
    runtimeId: 'runtime-a',
    sessionId,
    cwd: '/project',
    title,
    createdAt: '2026-10-30T12:00:00.000Z',
    hostName: 'Laptop',
    connected: true,
  }
  if (!includeMention) return remoteThread
  return { ...remoteThread, mention: formatSessionReferenceMention({ sessionId: SessionId(sessionId), label: title }) }
}

test('offers recorded remote threads as native mentions and omits absent or blank sessions', () => {
  const remoteId = SessionId('remote-1')
  const blankId = SessionId('blank-1')
  const legacyId = SessionId('legacy-remote')
  const candidates = remoteMentionCandidates({
    threads: [
      thread('remote-1', 'Remote design'),
      thread('blank-1', 'Blank thread'),
      thread('legacy-remote', 'Old host thread', false),
      thread('unlisted', 'Not mirrored'),
    ],
    sessions: { [remoteId]: summary(remoteId), [blankId]: summary(blankId, true), [legacyId]: summary(legacyId) },
    currentSessionId: SessionId('current'),
    currentCwd: '/project',
  })

  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({ label: 'Remote design', sameWorkspace: true })
  expect(parseSessionReferenceText(candidates[0]?.mention ?? '').references).toMatchObject([{ sessionId: 'remote-1' }])
})
