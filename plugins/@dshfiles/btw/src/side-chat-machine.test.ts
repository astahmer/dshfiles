import { waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { sideChatTitle, startSideChat, type SideChatPorts } from './side-chat-machine.js'

const ports = (overrides: Partial<SideChatPorts> = {}) => {
  const calls: string[] = []
  const base: SideChatPorts = {
    fork: vi.fn(async sourceId => {
      calls.push(`fork ${sourceId}`)
      return 'child'
    }),
    configure: vi.fn(async input => {
      calls.push(`configure ${input.childId} "${input.title}" ${input.route?.model ?? 'default'}`)
    }),
    ask: vi.fn(async input => {
      calls.push(`ask ${input.childId} ${input.question}`)
    }),
    openPanel: vi.fn(childId => {
      calls.push(`open ${childId}`)
    }),
    archive: vi.fn(async childId => {
      calls.push(`archive ${childId}`)
    }),
  }
  return { calls, ports: { ...base, ...overrides } }
}

describe('side chat', () => {
  it('forks, pins the source route, opens the panel, asks, and archives on close', async () => {
    const { calls, ports: sideChatPorts } = ports()
    const actor = startSideChat({ ports: sideChatPorts, sourceId: 'source', question: 'why  is\nthis slow?', route: { provider: 'deepseek', model: 'v4' } })
    await waitFor(actor, snapshot => snapshot.matches('open'))
    actor.send({ type: 'close' })
    await waitFor(actor, snapshot => snapshot.status === 'done')
    expect(calls).toEqual(['fork source', 'configure child "btw · why is this slow?" v4', 'open child', 'ask child why  is\nthis slow?', 'archive child'])
  })

  it('archives the fork when asking fails, and reports why', async () => {
    const { calls, ports: sideChatPorts } = ports({ ask: async () => Promise.reject(new Error('model refused')) })
    const actor = startSideChat({ ports: sideChatPorts, sourceId: 'source', question: 'q', route: null })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(actor.getSnapshot().context.error).toBe('model refused')
    expect(calls.at(-1)).toBe('archive child')
  })

  it('creates nothing to archive when the fork itself fails', async () => {
    const { calls, ports: sideChatPorts } = ports({ fork: async () => Promise.reject(new Error('fork-unavailable')) })
    const actor = startSideChat({ ports: sideChatPorts, sourceId: 'source', question: 'q', route: null })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(calls).toEqual([])
  })

  it('keeps titles to one bounded line', () => {
    expect(sideChatTitle('x'.repeat(200))).toHaveLength('btw · '.length + 80)
  })
})
