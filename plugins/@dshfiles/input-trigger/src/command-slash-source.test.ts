import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CommandItem } from '@dshfiles/dshx/client'
import { describe, expect, it, vi } from 'vitest'
import { CommandSlashSource } from './command-slash-source.js'

const session = { sessionId: SessionId('ses_1') }
const request = (query: string, position: 'leading' | 'inline' = 'leading') => ({ query, position, drilled: false, signal: new AbortController().signal })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('command / entries', () => {
  it('offers enabled commands that name a slash entry at the start of the draft', async () => {
    const commands: CommandItem[] = [
      { id: '@acme/plugin.sidebar', title: 'Toggle sidebar', slash: 'sidebar', run: () => {} },
      { id: '@acme/plugin.off', title: 'Off', slash: 'side-off', enabled: false, run: () => {} },
      { id: '@acme/plugin.plain', title: 'No slash', run: () => {} },
    ]
    const source = CommandSlashSource.create(commands)
    expect(await source.candidates(session, request('si'))).toEqual([{ name: 'sidebar', label: 'Toggle sidebar' }])
    expect(await source.candidates(session, request('si', 'inline'))).toEqual([])
  })

  it('runs a picked command and clears its token', async () => {
    const run = vi.fn()
    const source = CommandSlashSource.create([{ id: '@acme/plugin.sidebar', title: 'Toggle sidebar', slash: 'sidebar', run }])
    const outcome = source.onPick({
      candidate: { name: 'sidebar' },
      session,
      position: 'leading',
      via: 'enter',
      action: 'pick',
      span: { start: 0, end: 8, draftRev: 1 },
    })
    expect(outcome).toEqual({ text: '' })
    await flush()
    expect(run).toHaveBeenCalledOnce()
  })

  it('claims a sent line that is exactly the entry and reports a command that fails', async () => {
    const source = CommandSlashSource.create([
      {
        id: '@acme/plugin.boom',
        title: 'Boom',
        slash: 'boom',
        run: () => Promise.reject(new Error('no layout')),
      },
    ])
    const outcome = await source.matchEnter?.(session, '/boom', new AbortController().signal, { attachments: 0 })
    expect(outcome !== undefined && outcome !== 'handled' && 'claim' in outcome ? outcome.claim.token : undefined).toBe('/boom ')
    const claim = outcome !== undefined && outcome !== 'handled' && 'claim' in outcome ? outcome.claim : undefined
    expect(await claim?.submit('', new Context(), [])).toEqual({ kind: 'error', text: 'no layout' })
    expect(await source.matchEnter?.(session, '/boom now', new AbortController().signal, { attachments: 0 })).toBeUndefined()
  })
})
