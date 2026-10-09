import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createQueueEditor, decodeQueuedRows, restoredIndex, type QueueEditRecord, type QueuedBlock } from './queue-edit.js'

type WorldAttachment = { readonly type: 'image' | 'file'; readonly name: string }

interface RawRow {
  readonly id: string
  readonly content: readonly QueuedBlock[]
  readonly source: { readonly kind: 'user'; readonly rpcId: string }
}

const subject = () => {
  const listeners = new Set<() => void>()
  return {
    notify: () => {
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
  for (let round = 0; round < 10; round += 1) await tick()
}

const text = (value: string): QueuedBlock => ({ type: 'text', text: value })
const image = (name: string): QueuedBlock => ({ type: 'image', attachment: { attachmentId: `stored:${name}`, mediaType: 'image/png', name } })
const file = (name: string): QueuedBlock => ({ type: 'file', attachment: { attachmentId: `stored:${name}`, name, bytes: 3 } })

/**
 * A working in-memory DSH: a queue that drains when a turn ends, a composer that sends through pending submissions
 * like the real one, and draft attachments backed by real `File`s.
 */
const createWorld = (options: { readonly running?: boolean } = {}) => {
  const queueSubject = subject()
  const pendingSubject = subject()
  const composerSubject = subject()
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`
  const world = {
    running: options.running ?? true,
    failNextSubmit: false,
    rows: [] as RawRow[],
    started: [] as RawRow[],
    pending: [] as string[],
    composer: { draft: '', attachmentIds: [] as string[], idle: true },
    drafts: new Map<string, File>(),
    released: [] as string[],
    stored: new Map<string, File>(),
    records: null as QueueEditRecord | null,
  }

  const toBlock = (draftFile: File): QueuedBlock =>
    draftFile.type.startsWith('image/')
      ? { type: 'image', attachment: { attachmentId: `stored:${draftFile.name}`, mediaType: draftFile.type, name: draftFile.name } }
      : { type: 'file', attachment: { attachmentId: `stored:${draftFile.name}`, name: draftFile.name, bytes: draftFile.size } }

  const deliver = (row: RawRow) => {
    if (world.running) world.rows = [...world.rows, row]
    else world.started = [...world.started, row]
    queueSubject.notify()
  }

  const enqueueRow = (content: readonly QueuedBlock[]) => {
    const row: RawRow = { id: nextId('message'), content, source: { kind: 'user', rpcId: nextId('request') } }
    world.rows = [...world.rows, row]
    queueSubject.notify()
    return row
  }

  const ports = {
    queue: { getSnapshot: () => decodeQueuedRows({ 'next-turn': world.rows }), subscribe: queueSubject.subscribe },
    pendingRequestIds: { getSnapshot: () => world.pending, subscribe: pendingSubject.subscribe },
    composer: {
      getSnapshot: () => world.composer,
      subscribe: composerSubject.subscribe,
      setDraft: (draft: string) => {
        world.composer = { ...world.composer, draft }
        composerSubject.notify()
      },
      addAttachments: (ids: readonly string[]) => {
        world.composer = { ...world.composer, attachmentIds: [...world.composer.attachmentIds, ...ids] }
        composerSubject.notify()
        return true
      },
      removeAttachment: (id: string) => {
        world.composer = { ...world.composer, attachmentIds: world.composer.attachmentIds.filter(candidate => candidate !== id) }
        composerSubject.notify()
      },
      submit: () => {
        const sent = world.composer
        const requestId = nextId('request')
        world.pending = [...world.pending, requestId]
        world.composer = { draft: '', attachmentIds: [], idle: true }
        pendingSubject.notify()
        composerSubject.notify()
        setTimeout(() => {
          world.pending = world.pending.filter(id => id !== requestId)
          if (world.failNextSubmit) {
            world.failNextSubmit = false
            world.composer = sent
            composerSubject.notify()
          } else {
            const files = sent.attachmentIds.flatMap(id => {
              const draftFile = world.drafts.get(id)
              return draftFile === undefined ? [] : [draftFile]
            })
            for (const id of sent.attachmentIds) world.drafts.delete(id)
            const content = [...(sent.draft.length > 0 ? [text(sent.draft)] : []), ...files.map(toBlock)]
            deliver({ id: nextId('message'), content, source: { kind: 'user', rpcId: requestId } })
          }
          pendingSubject.notify()
        }, 0)
      },
      focus: () => {},
    },
    drafts: {
      create: (files: readonly File[]) =>
        files.map(draftFile => {
          const id = nextId('draft')
          world.drafts.set(id, draftFile)
          return id
        }),
      release: (ids: readonly string[]) => {
        for (const id of ids) {
          world.drafts.delete(id)
          world.released.push(id)
        }
      },
      live: (ids: readonly string[]) => ids.filter(id => world.drafts.has(id)),
      serialize: async (ids: readonly string[]) =>
        ids.flatMap(id => {
          const draftFile = world.drafts.get(id)
          return draftFile === undefined ? [] : [{ type: 'attachment' as const, file: draftFile }]
        }),
    },
    host: {
      readImage: async (attachment: { readonly attachmentId: string }) => {
        const stored = world.stored.get(attachment.attachmentId)
        if (stored === undefined) throw new Error('missing image')
        return stored
      },
      readFile: async (attachment: { readonly attachmentId: string }) => {
        const stored = world.stored.get(attachment.attachmentId)
        if (stored === undefined) throw new Error('missing file')
        return stored
      },
      remove: async (itemId: string) => {
        if (!world.rows.some(row => row.id === itemId)) throw new Error('not pending')
        world.rows = world.rows.filter(row => row.id !== itemId)
        queueSubject.notify()
      },
      enqueue: async (parts: readonly ({ readonly type: 'text'; readonly text: string } | { readonly type: 'attachment'; readonly file: File })[]) => {
        const requestId = nextId('request')
        const content = parts.map(part => (part.type === 'text' ? text(part.text) : toBlock(part.file)))
        setTimeout(() => deliver({ id: nextId('message'), content, source: { kind: 'user', rpcId: requestId } }), 0)
        return requestId
      },
      move: async (itemId: string, direction: 'up' | 'down') => {
        const index = world.rows.findIndex(row => row.id === itemId)
        const target = direction === 'up' ? index - 1 : index + 1
        if (index < 0 || target < 0 || target >= world.rows.length) return index
        const rows = [...world.rows]
        const [moved] = rows.splice(index, 1)
        if (moved !== undefined) rows.splice(target, 0, moved)
        world.rows = rows
        queueSubject.notify()
        return target
      },
    },
    records: {
      load: () => world.records,
      save: (record: QueueEditRecord | null) => {
        world.records = record
      },
    },
    settleDelayMs: 5,
    placementTimeoutMs: 50,
  }

  const store = (draftFile: File) => world.stored.set(`stored:${draftFile.name}`, draftFile)
  store(new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }))
  store(new File([new Uint8Array([4, 5, 6])], 'notes.txt', { type: 'text/plain' }))

  /** The turn ends: the head of the queue starts, and the session goes idle once nothing is left. */
  const finishTurn = () => {
    const [head, ...rest] = world.rows
    if (head !== undefined) world.started = [...world.started, head]
    world.rows = rest
    if (rest.length === 0) world.running = false
    queueSubject.notify()
  }

  return { world, ports, enqueueRow, finishTurn, editor: () => createQueueEditor(ports) }
}

const rowsOf = (world: { readonly rows: readonly RawRow[] }) => decodeQueuedRows({ 'next-turn': world.rows })
const textsOf = (world: { readonly rows: readonly RawRow[] }) =>
  world.rows.map(row => row.content.flatMap(block => (block.type === 'text' ? [block.text] : [`[${block.attachment.name}]`])).join(' '))

test('Edit moves the text and attachments into the composer and keeps the user draft aside', async () => {
  const { world, enqueueRow, editor } = createWorld()
  enqueueRow([text('first')])
  const target = enqueueRow([text('fix the bug'), image('shot.png'), file('notes.txt')])
  enqueueRow([text('last')])
  world.composer = { draft: 'unsent idea', attachmentIds: [], idle: true }
  const queueEditor = editor()

  const row = rowsOf(world).find(candidate => candidate.id === target.id)
  assert.ok(row)
  await queueEditor.begin(row)

  assert.deepEqual(textsOf(world), ['first', 'last'])
  assert.equal(world.composer.draft, 'fix the bug')
  assert.deepEqual(
    world.composer.attachmentIds.map(id => world.drafts.get(id)?.name),
    ['shot.png', 'notes.txt'],
  )
  const record = queueEditor.getSnapshot().record
  assert.equal(record?.status, 'editing')
  assert.equal(record?.backupDraft, 'unsent idea')
  assert.equal(restoredIndex({ rows: rowsOf(world), before: record?.before ?? [] }), 1)
})

test('Submit queues the edited message, with its attachments, back at the same position', async () => {
  const { world, enqueueRow, editor } = createWorld()
  enqueueRow([text('first')])
  const target = enqueueRow([text('draft'), image('shot.png')])
  enqueueRow([text('second')])
  enqueueRow([text('third')])
  world.composer = { draft: 'unsent idea', attachmentIds: [], idle: true }
  const queueEditor = editor()
  const row = rowsOf(world)[1]
  assert.ok(row)
  await queueEditor.begin(row)

  world.composer = { ...world.composer, draft: 'edited text' }
  queueEditor.submit()
  await settle()

  assert.deepEqual(textsOf(world), ['first', 'edited text [shot.png]', 'second', 'third'])
  assert.ok(!world.rows.some(candidate => candidate.id === target.id))
  assert.equal(queueEditor.getSnapshot().record, null)
  assert.equal(world.records, null)
  assert.equal(world.composer.draft, 'unsent idea')
})

test('Cancel puts the original back unchanged at the same position and discards the composer edits', async () => {
  const { world, enqueueRow, editor } = createWorld()
  enqueueRow([text('first')])
  enqueueRow([text('original'), image('shot.png'), file('notes.txt')])
  enqueueRow([text('last')])
  const queueEditor = editor()
  const row = rowsOf(world)[1]
  assert.ok(row)
  await queueEditor.begin(row)
  const hydrated = [...world.composer.attachmentIds]

  world.composer = { ...world.composer, draft: 'half-typed change' }
  await queueEditor.cancel()
  await settle()

  assert.deepEqual(textsOf(world), ['first', 'original [shot.png] [notes.txt]', 'last'])
  assert.equal(world.composer.draft, '')
  assert.deepEqual(world.composer.attachmentIds, [])
  assert.ok(hydrated.every(id => world.released.includes(id)))
  assert.equal(queueEditor.getSnapshot().record, null)
})

test('A finishing turn cannot run the message being edited, and Submit then delivers it exactly once', async () => {
  const { world, enqueueRow, finishTurn, editor } = createWorld()
  const ahead = enqueueRow([text('ahead')])
  const target = enqueueRow([text('edit me')])
  const queueEditor = editor()
  const row = rowsOf(world)[1]
  assert.ok(row)
  await queueEditor.begin(row)

  finishTurn()
  assert.deepEqual(
    world.started.map(started => started.id),
    [ahead.id],
  )
  assert.ok(!world.rows.some(candidate => candidate.id === target.id))
  assert.equal(world.running, false)

  world.composer = { ...world.composer, draft: 'edited' }
  queueEditor.submit()
  await settle()

  assert.deepEqual(world.rows, [])
  assert.deepEqual(
    world.started.map(started => started.content.map(block => (block.type === 'text' ? block.text : '')).join('')),
    ['ahead', 'edited'],
  )
  assert.equal(queueEditor.getSnapshot().record, null)
})

test('Editing a message that already left the queue changes nothing', async () => {
  const { world, enqueueRow, editor } = createWorld()
  enqueueRow([text('gone soon')])
  const queueEditor = editor()
  const row = rowsOf(world)[0]
  assert.ok(row)
  world.rows = []

  await queueEditor.begin(row)

  assert.equal(world.composer.draft, '')
  assert.equal(queueEditor.getSnapshot().record, null)
  assert.equal(world.records, null)
  assert.match(queueEditor.getSnapshot().notice ?? '', /already left the queue/u)
})

test('An attachment that cannot be loaded keeps the message queued', async () => {
  const { world, enqueueRow, editor } = createWorld()
  enqueueRow([text('with a lost file'), file('missing.bin')])
  const queueEditor = editor()
  const row = rowsOf(world)[0]
  assert.ok(row)

  await queueEditor.begin(row)

  assert.deepEqual(textsOf(world), ['with a lost file [missing.bin]'])
  assert.equal(queueEditor.getSnapshot().record, null)
  assert.match(queueEditor.getSnapshot().notice ?? '', /stays queued/u)
})

test('A rejected submit keeps the edit open with the draft in the composer', async () => {
  const { world, enqueueRow, editor } = createWorld()
  enqueueRow([text('one')])
  const queueEditor = editor()
  const row = rowsOf(world)[0]
  assert.ok(row)
  await queueEditor.begin(row)

  world.failNextSubmit = true
  world.composer = { ...world.composer, draft: 'edited' }
  queueEditor.submit()
  await settle()

  assert.equal(queueEditor.getSnapshot().record?.status, 'editing')
  assert.match(queueEditor.getSnapshot().record?.error ?? '', /did not go through/u)
  assert.equal(world.composer.draft, 'edited')
  assert.deepEqual(world.rows, [])
})

test('After a reload the saved record still offers Cancel, which restores the original once', async () => {
  const { world, ports, enqueueRow, editor } = createWorld()
  enqueueRow([text('first')])
  enqueueRow([text('original'), image('shot.png')])
  const first = editor()
  const row = rowsOf(world)[1]
  assert.ok(row)
  await first.begin(row)
  first.dispose()

  // A reload keeps the persisted draft text and record, but not the page-owned draft attachments.
  world.drafts.clear()
  world.composer = { draft: 'original', attachmentIds: [], idle: true }
  const reloaded = createQueueEditor(ports)
  await settle()
  assert.equal(reloaded.getSnapshot().record?.status, 'editing')
  assert.deepEqual(
    world.composer.attachmentIds.map(id => world.drafts.get(id)?.name),
    ['shot.png'],
  )

  await reloaded.cancel()
  await reloaded.cancel()
  await settle()

  assert.deepEqual(textsOf(world), ['first', 'original [shot.png]'])
  assert.equal(world.records, null)
})

test('A restore that fails stays recoverable until retried', async () => {
  const { world, ports, enqueueRow } = createWorld()
  enqueueRow([text('original')])
  let failEnqueue = true
  const queueEditor = createQueueEditor({
    ...ports,
    host: {
      ...ports.host,
      enqueue: async parts => {
        if (failEnqueue) throw new Error('Host offline')
        return ports.host.enqueue(parts)
      },
    },
  })
  const row = rowsOf(world)[0]
  assert.ok(row)
  await queueEditor.begin(row)

  await queueEditor.cancel()
  assert.equal(queueEditor.getSnapshot().record?.status, 'failed')
  assert.match(queueEditor.getSnapshot().record?.error ?? '', /Host offline/u)

  failEnqueue = false
  await queueEditor.cancel()
  await settle()
  assert.deepEqual(textsOf(world), ['original'])
  assert.equal(queueEditor.getSnapshot().record, null)
})

test('decodeQueuedRows tolerates malformed rows and marks unknown blocks as not editable', () => {
  const rows = decodeQueuedRows({
    'next-turn': [
      { id: 'ok', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user', rpcId: 'r1' } },
      { id: 'odd', content: [{ type: 'text', text: 'hi' }, { type: 'audio' }] },
      { content: [] },
      'not a row',
    ],
  })
  assert.deepEqual(
    rows.map(row => [row.id, row.editable, row.rpcId]),
    [
      ['ok', true, 'r1'],
      ['odd', false, undefined],
    ],
  )
  assert.deepEqual(decodeQueuedRows(undefined), [])
  assert.deepEqual(decodeQueuedRows({ 'next-turn': 'nope' }), [])
})
