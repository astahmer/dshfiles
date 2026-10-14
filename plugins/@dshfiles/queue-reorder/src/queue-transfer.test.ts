import { waitFor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it } from 'vitest'
import { decodeQueuedRows, type QueuedBlock, type QueuedRow } from './queue-edit.js'
import { startQueueTransfer, transferTargets, type QueueTransferPorts, type TransferDestination } from './queue-transfer.js'

const text = (value: string): QueuedBlock => ({ type: 'text', text: value })
const image = (name: string): QueuedBlock => ({ type: 'image', attachment: { attachmentId: `stored:${name}`, mediaType: 'image/png', name } })
const file = (name: string): QueuedBlock => ({ type: 'file', attachment: { attachmentId: `stored:${name}`, name, bytes: 3 } })
const rowOf = (id: string, content: readonly QueuedBlock[]): QueuedRow => {
  const row = decodeQueuedRows({ 'next-turn': [{ id, content }] })[0]
  if (row === undefined) throw new Error('row did not decode')
  return row
}
const target = { id: 'thread-b', title: 'Thread B' }

/** Two threads' queues and composers in memory; `fail` makes one step reject. */
const createWorld = (options: { readonly targetDestination?: TransferDestination; readonly fail?: 'load' | 'deliver' } = {}) => {
  const restored: { readonly blocks: readonly QueuedBlock[]; readonly files: readonly string[] }[] = []
  const delivered: { readonly target: string; readonly blocks: readonly QueuedBlock[]; readonly files: readonly string[] }[] = []
  const world = { source: ['message-1', 'message-2'], restored, delivered }
  const rejectOn = (step: NonNullable<typeof options.fail>) => {
    if (options.fail === step) throw new Error(`${step} failed`)
  }
  const ports: QueueTransferPorts = {
    load: async blocks => {
      rejectOn('load')
      return blocks.flatMap(block => (block.type === 'text' ? [] : [new File(['abc'], block.attachment.name ?? 'image')]))
    },
    remove: async itemId => {
      if (!world.source.includes(itemId)) throw new Error('not queued')
      world.source = world.source.filter(id => id !== itemId)
    },
    deliver: async input => {
      rejectOn('deliver')
      world.delivered.push({ target: input.target.id, blocks: input.blocks, files: input.files.map(item => item.name) })
      return options.targetDestination ?? 'queue'
    },
    restore: async input => {
      world.restored.push({ blocks: input.blocks, files: input.files.map(item => item.name) })
      world.source = [...world.source, 'message-restored']
    },
  }
  return { world, actor: startQueueTransfer(ports) }
}

const move = async (actor: ReturnType<typeof createWorld>['actor'], row: QueuedRow) => {
  actor.send({ type: 'open', row })
  actor.send({ type: 'choose', target })
  return (await waitFor(actor, snapshot => snapshot.matches('settled'))).context.outcome
}

describe('moving a queued message to another thread', () => {
  it('moves the text and every attachment to the chosen thread and takes it out of this queue', async () => {
    const { world, actor } = createWorld()
    const blocks = [text('look at these'), image('shot.png'), file('notes.md')]
    const outcome = await move(actor, rowOf('message-1', blocks))
    expect(outcome).toEqual({ kind: 'moved', target, destination: 'queue' })
    expect(world.source).toEqual(['message-2'])
    expect(world.delivered).toEqual([{ target: 'thread-b', blocks, files: ['shot.png', 'notes.md'] }])
  })

  it('reports an idle target as receiving the message in its composer', async () => {
    const { actor } = createWorld({ targetDestination: 'composer' })
    expect(await move(actor, rowOf('message-1', [text('later')]))).toEqual({ kind: 'moved', target, destination: 'composer' })
  })

  it('leaves the message queued here when its attachments cannot be read', async () => {
    const { world, actor } = createWorld({ fail: 'load' })
    const outcome = await move(actor, rowOf('message-1', [text('x'), file('gone.bin')]))
    expect(outcome?.kind).toBe('not-moved')
    expect(world.source).toEqual(['message-1', 'message-2'])
    expect(world.delivered).toEqual([])
  })

  it('changes nothing when the message already left the queue', async () => {
    const { world, actor } = createWorld()
    const outcome = await move(actor, rowOf('message-9', [text('ran already')]))
    expect(outcome).toEqual({ kind: 'not-moved', message: 'This message already left the queue.' })
    expect(world.delivered).toEqual([])
  })

  it('puts the message back in this queue, attachments included, when the target refuses it', async () => {
    const { world, actor } = createWorld({ fail: 'deliver' })
    const blocks = [text('keep me'), image('shot.png')]
    const outcome = await move(actor, rowOf('message-1', blocks))
    expect(outcome?.kind).toBe('restored')
    expect(world.restored).toEqual([{ blocks, files: ['shot.png'] }])
    expect(world.source).toEqual(['message-2', 'message-restored'])
  })

  it('shows the text when neither the move nor the restore went through', async () => {
    const failingBoth: QueueTransferPorts = {
      load: async () => [],
      remove: async () => undefined,
      deliver: async () => Promise.reject(new Error('target gone')),
      restore: async () => Promise.reject(new Error('source gone')),
    }
    const lost = await move(startQueueTransfer(failingBoth), rowOf('message-1', [text('important '), text('words')]))
    expect(lost).toMatchObject({ kind: 'lost', text: 'important words' })
  })

  it('ignores a second move while one is in flight and can be dismissed afterwards', async () => {
    const { world, actor } = createWorld()
    actor.send({ type: 'open', row: rowOf('message-1', [text('first')]) })
    actor.send({ type: 'choose', target })
    actor.send({ type: 'open', row: rowOf('message-2', [text('second')]) })
    await waitFor(actor, snapshot => snapshot.matches('settled'))
    expect(world.source).toEqual(['message-2'])
    actor.send({ type: 'dismiss' })
    expect(actor.getSnapshot().matches('idle')).toBe(true)
    expect(actor.getSnapshot().context.outcome).toBeNull()
  })
})

describe('transfer targets', () => {
  it('lists other top-level threads, newest first, without blank drafts or subagents', () => {
    const row = (displayTitle: string, updatedAt: number, extra: { readonly blank?: boolean; readonly origin?: string } = {}) => ({
      displayTitle,
      updatedAt,
      blank: extra.blank ?? false,
      origin: extra.origin,
    })
    const targets = transferTargets({
      ids: ['a', 'b', 'c', 'd', 'e'],
      rows: { a: row('Current', 9), b: row('Older', 1), c: row('Newer', 5), d: row('Blank', 7, { blank: true }), e: row('Child', 8, { origin: 'subagent' }) },
      currentId: 'a',
    })
    expect(targets).toEqual([
      { id: 'c', title: 'Newer' },
      { id: 'b', title: 'Older' },
    ])
  })
})
