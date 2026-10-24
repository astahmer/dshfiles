import { describe, expect, it } from 'vitest'
import { BacklogViews, type BacklogDetailInput } from './api.js'
import { BacklogStartContext } from './backlog-start-context.js'

const attachment = (id: string, kind: 'image' | 'file', mediaType: string, bytes: number) => ({
  id,
  kind,
  name: `${id}.${kind === 'image' ? 'png' : 'txt'}`,
  mediaType,
  bytes,
  createdAt: 1,
})

const detail = (input: {
  readonly id: number
  readonly title: string
  readonly body: string
  readonly attachments?: ReturnType<typeof attachment>[]
  readonly events?: BacklogDetailInput['item']['events']
}) =>
  BacklogViews.detail({
    item: {
      id: input.id,
      title: input.title,
      body: input.body,
      kind: 'task',
      status: 'todo',
      project: null,
      tags: [],
      links: [],
      actors: [{ id: 'user', role: 'owner' }],
      pinned: false,
      humanFields: [],
      createdAt: input.id,
      lastActivityAt: input.id,
      events: input.events ?? [{ at: input.id, actor: 'user', kind: 'created', detail: input.title }],
      attachments: input.attachments ?? [],
      freshness: 'fresh',
    },
    backlinks: [],
  })

describe('BacklogStartContext.prepare', () => {
  it('keeps selected order, full bodies, current replies, and item/reply attachment ownership', async () => {
    const first = detail({
      id: 11,
      title: 'second selected item',
      body: 'Full description '.repeat(400),
      attachments: [attachment('image-1111', 'image', 'image/png', 4)],
      events: [
        { at: 1, actor: 'user', kind: 'created', detail: 'created' },
        { at: 20, actor: 'user', kind: 'commented', detail: 'reply with a file', attachments: [attachment('file-1111', 'file', 'text/plain', 3)] },
      ],
    })
    const second = detail({
      id: 22,
      title: 'first selected item',
      body: 'Another full description',
      events: [
        { at: 2, actor: 'user', kind: 'created', detail: 'created' },
        { at: 30, actor: 'agent:session-a', kind: 'commented', detail: 'later reply' },
      ],
    })
    const reads: string[] = []
    const prepared = await BacklogStartContext.prepare({
      details: [first, second],
      readFile: async ({ attachmentId }) => {
        reads.push(attachmentId)
        const dataUrl = attachmentId === 'image-1111' ? 'data:image/png;base64,AQIDBA==' : 'data:text/plain;base64,YWJj'
        return { ok: true, value: { dataUrl } }
      },
    })

    expect(prepared.text.indexOf('b:11: second selected item')).toBeLessThan(prepared.text.indexOf('b:22: first selected item'))
    expect(prepared.text).toContain('Full description '.repeat(400))
    expect(prepared.text).toContain('reply with a file')
    expect(prepared.text).toContain('later reply')
    expect(reads).toEqual(['image-1111', 'file-1111'])
    expect(prepared.attachments.map(item => [item.type, item.source])).toEqual([
      ['image', 'b:11 item'],
      ['file', 'b:11 reply 1 by user at 20'],
    ])
    const file = prepared.attachments[1]
    expect(file?.type === 'file' ? Buffer.from(file.bytes).toString('utf8') : '').toBe('abc')
  })

  it('fails closed when an attachment is missing or its stored bytes do not match metadata', async () => {
    const item = detail({ id: 3, title: 'item', body: '', attachments: [attachment('file-3333', 'file', 'text/plain', 4)] })
    await expect(
      BacklogStartContext.prepare({
        details: [item],
        readFile: async () => ({ ok: false, reason: 'not-found' }),
      }),
    ).rejects.toThrow('Could not read')
    await expect(
      BacklogStartContext.prepare({
        details: [item],
        readFile: async () => ({ ok: true, value: { dataUrl: 'data:text/plain;base64,YWJj' } }),
      }),
    ).rejects.toThrow('byte-count')
    await expect(
      BacklogStartContext.prepare({
        details: [item],
        readFile: async () => ({ ok: true, value: { dataUrl: `data:text/plain;base64,${'A'.repeat(100_000)}` } }),
      }),
    ).rejects.toThrow('exceeds its declared byte count')
  })

  it('rejects oversized descriptions instead of truncating required context', async () => {
    const items = Array.from({ length: 6 }, (_, index) => detail({ id: index + 1, title: `large ${String(index + 1)}`, body: 'x'.repeat(20_000) }))
    await expect(BacklogStartContext.prepare({ details: items, readFile: async () => ({ ok: false, reason: 'not-found' }) })).rejects.toThrow(
      'split the items into separate threads',
    )
  })

  it('rejects too many attachments rather than silently omitting any', async () => {
    const items = Array.from({ length: 7 }, (_, itemIndex) =>
      detail({
        id: itemIndex + 1,
        title: `item ${String(itemIndex + 1)}`,
        body: '',
        attachments: Array.from({ length: 8 }, (_, attachmentIndex) =>
          attachment(`file-${String(itemIndex)}-${String(attachmentIndex).padStart(3, '0')}`, 'file', 'text/plain', 1),
        ),
      }),
    )
    await expect(
      BacklogStartContext.prepare({ details: items, readFile: async () => ({ ok: true, value: { dataUrl: 'data:text/plain;base64,YQ==' } }) }),
    ).rejects.toThrow('50 attachments')
  })
})
