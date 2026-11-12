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
    const source = ForgeMentions.create({ search: async () => ({ items: [item] }) })
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

  it('offers one recovery row when gh is signed out, and picking it copies the command without inserting', async () => {
    const copied: string[] = []
    const source = ForgeMentions.create({
      search: async () => ({ items: [], unavailable: { reason: 'signed-out', message: 'To get started with GitHub CLI, please run: gh auth login' } }),
      copy: text => copied.push(text),
    })
    const session = { sessionId }
    const request = { query: '', position: 'inline', drilled: false, signal: new AbortController().signal } as const
    const candidates = await source.candidates(session, request)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.label).toBe('Sign in with gh auth login to list issues')
    const outcome = source.onPick({
      candidate: candidates[0]!,
      session,
      position: 'inline',
      via: 'menu',
      action: 'pick',
      span: { start: 0, end: 1, draftRev: 0 },
    })
    expect(outcome).toBeUndefined()
    expect(copied).toEqual(['gh auth login'])
  })

  it('lists nothing for a folder that is not a forge', async () => {
    const source = ForgeMentions.create({ search: async () => ({ items: [] }) })
    const request = { query: '', position: 'inline', drilled: false, signal: new AbortController().signal } as const
    expect(await source.candidates({ sessionId }, request)).toEqual([])
  })
})
