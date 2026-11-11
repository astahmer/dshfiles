import { SessionId } from '@dshfiles/dshx/ids'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { ForgeMentions } from './forge-mentions.js'

const sessionId = Schema.decodeUnknownSync(SessionId)('session-test')
const item = { number: 12, title: 'Fix the build', state: 'open', url: 'https://github.com/acme/widget/pull/12', isPullRequest: true }

const insertOf = (outcome: ReturnType<ReturnType<typeof ForgeMentions.create>['onPick']>) => {
  if (typeof outcome !== 'object' || !('insert' in outcome)) throw new Error('expected an insert outcome')
  return outcome.insert
}

describe('forge mentions', () => {
  it('turns a search result into a durable reference', async () => {
    const source = ForgeMentions.create({ search: async () => [item] })
    const session = { sessionId }
    const request = { query: 'build', position: 'inline', drilled: false, signal: new AbortController().signal } as const
    const candidates = await source.candidates(session, request)
    const insert = insertOf(
      source.onPick({ candidate: candidates[0]!, session, position: 'inline', via: 'menu', action: 'pick', span: { start: 0, end: 6, draftRev: 0 } }),
    )
    expect(insert.label).toBe('#12 Fix the build')
    expect(insert.clipboardText).toBe(item.url)
    expect(await source.codec?.serialize(insert.ref, new AbortController().signal, insert.label)).toBe(`${insert.label} (${item.url})`)
  })
})
