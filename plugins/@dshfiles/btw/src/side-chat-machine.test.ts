import { waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { SideChatModel, startSideChat, type SideChatPorts } from './side-chat-machine.js'

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
    retain: vi.fn(childId => {
      calls.push(`retain ${childId}`)
      return {
        ready: Promise.resolve(),
        submit: async (question: string) => {
          calls.push(`ask ${childId} ${question}`)
        },
        release: () => {
          calls.push(`release ${childId}`)
        },
      }
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
    expect(calls).toEqual([
      'fork source',
      'configure child "btw · why is this slow?" v4',
      'open child',
      'retain child',
      'ask child why  is\nthis slow?',
      'release child',
      'archive child',
    ])
  })

  it('releases the retained session when the flow is closed while asking', async () => {
    const { calls, ports: sideChatPorts } = ports({
      retain: () => ({ ready: Promise.resolve(), submit: () => new Promise<void>(() => {}), release: () => calls.push('release') }),
    })
    const actor = startSideChat({ ports: sideChatPorts, sourceId: 'source', question: 'q', route: null })
    await waitFor(actor, snapshot => snapshot.matches('asking'))
    actor.send({ type: 'close' })
    await waitFor(actor, snapshot => snapshot.status === 'done')
    expect(calls).toEqual(['fork source', 'configure child "btw · q" default', 'open child', 'release', 'archive child'])
  })

  it('archives the fork and releases its session when asking fails, and reports why', async () => {
    const { calls, ports: sideChatPorts } = ports({
      retain: () => ({ ready: Promise.resolve(), submit: () => Promise.reject(new Error('model refused')), release: () => calls.push('release') }),
    })
    const actor = startSideChat({ ports: sideChatPorts, sourceId: 'source', question: 'q', route: null })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(actor.getSnapshot().context.error).toBe('model refused')
    expect(calls.at(-1)).toBe('archive child')
    expect(calls).toContain('release')
  })

  it('creates nothing to archive when the fork itself fails', async () => {
    const { calls, ports: sideChatPorts } = ports({ fork: async () => Promise.reject(new Error('fork-unavailable')) })
    const actor = startSideChat({ ports: sideChatPorts, sourceId: 'source', question: 'q', route: null })
    await waitFor(actor, snapshot => snapshot.matches('failed'))
    expect(calls).toEqual([])
  })

  it('keeps titles to one bounded line', () => {
    expect(SideChatModel.title('x'.repeat(200))).toHaveLength('btw · '.length + 80)
  })
})

describe('side chat start', () => {
  it('reports success once the fork is retained, before the answer arrives', async () => {
    let answer: () => void = () => undefined
    const { ports: sideChatPorts } = ports({
      retain: () => ({ ready: Promise.resolve(), submit: () => new Promise<void>(resolve => (answer = resolve)), release: () => undefined }),
    })
    const actor = startSideChat({ ports: sideChatPorts, sourceId: 'source', question: 'q', route: null })
    expect(await SideChatModel.started(actor)).toEqual({ ok: true })
    expect(actor.getSnapshot().matches('asking')).toBe(true)
    answer()
  })

  it('reports why a refused fork started nothing', async () => {
    const { ports: sideChatPorts } = ports({ fork: async () => Promise.reject(new Error('fork-unavailable')) })
    const actor = startSideChat({ ports: sideChatPorts, sourceId: 'source', question: 'q', route: null })
    expect(await SideChatModel.started(actor)).toEqual({ ok: false, reason: 'fork-unavailable' })
  })
})
