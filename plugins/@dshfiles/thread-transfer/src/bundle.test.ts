import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ThreadBundles, type AttachmentReference } from './bundle.js'
import { decodeBundle, encodeBundle } from './bundle-codec.js'

const image: AttachmentReference = { kind: 'image', attachmentId: 'img-source', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'shot.png' }
const file: AttachmentReference = { kind: 'file', attachmentId: 'file-source', name: 'notes.txt', bytes: 5 }

const events = [
  { seq: 0, type: 'turn/start', time: 1, data: { turn: 1 } },
  {
    seq: 1,
    type: 'user/message',
    time: 2,
    data: {
      source: { kind: 'user' },
      content: [
        { type: 'text', text: 'look' },
        { type: 'image', attachment: { attachmentId: 'img-source', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'shot.png' } },
        { type: 'file', attachment: { attachmentId: 'file-source', name: 'notes.txt', bytes: 5 } },
      ],
    },
  },
  { seq: 2, type: 'session/title', time: 3, data: { title: 'Fix the login bug', messageSeqs: [1], source: 'user' } },
  { seq: 3, type: 'model/selection', time: 4, data: { provider: 'deepseek', model: 'deepseek-chat' } },
  // The same image cited again: stored once in the bundle.
  {
    seq: 4,
    type: 'assistant/message',
    time: 5,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'This one?' },
          { type: 'image', attachment: { attachmentId: 'img-source', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } },
        ],
        source: { kind: 'model', provider: 'openai', model: 'gpt-5' },
      },
    },
  },
  { seq: 5, type: 'turn/end', time: 6, data: { turn: 1 } },
]

const bytes = { image: new Uint8Array([1, 2, 3]), file: new TextEncoder().encode('hello') }

const built = () =>
  ThreadBundles.build({
    createdAt: Date.UTC(2026, 10, 4),
    cwd: '/Users/someone/dev/acme-api',
    agentPreset: undefined,
    sessionFormat: 4,
    events,
    attachments: new Map([
      ['img-source', { reference: image, data: bytes.image }],
      ['file-source', { reference: file, data: bytes.file }],
    ]),
    exportedAt: 10,
  })

describe('ThreadBundles', () => {
  it('collects each attachment once by content, keeps no host path, and describes the thread', () => {
    const bundle = built()
    expect(bundle.attachments.map(attachment => attachment.kind)).toEqual(['image', 'file'])
    expect(Object.keys(bundle.references).sort()).toEqual(['file-source', 'img-source'])
    expect(bundle.references['img-source']).toBe(ThreadBundles.contentKey(bytes.image))
    expect(bundle.thread).toEqual({
      title: 'Fix the login bug',
      createdAt: Date.UTC(2026, 10, 4),
      model: { provider: 'deepseek', model: 'deepseek-chat' },
      folderName: 'acme-api',
      messageCount: 2,
    })
    expect(JSON.stringify(bundle)).not.toContain('/Users/someone')
    expect(ThreadBundles.fileName(bundle)).toBe('fix-the-login-bug.dshthread')
  })

  it.effect('round-trips through the file encoding and rewrites references to the importing store', () =>
    Effect.gen(function* () {
      const decoded = yield* decodeBundle(yield* encodeBundle(built()))
      expect(ThreadBundles.problem(decoded, 4)).toBeUndefined()
      const saved = new Map<string, AttachmentReference>([
        [ThreadBundles.contentKey(bytes.image), { ...image, attachmentId: 'img-target', name: 'renamed-by-store.png' }],
        [ThreadBundles.contentKey(bytes.file), { ...file, attachmentId: 'file-target' }],
      ])
      const rebased = ThreadBundles.rebase(decoded, saved)
      const text = JSON.stringify(rebased)
      expect(text).not.toContain('img-source')
      expect(text).not.toContain('file-source')
      expect(rebased[1]).toEqual({
        ...events[1],
        data: {
          source: { kind: 'user' },
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', attachment: { attachmentId: 'img-target', mediaType: 'image/png', bytes: 3, width: 1, height: 1, name: 'shot.png' } },
            { type: 'file', attachment: { attachmentId: 'file-target', name: 'notes.txt', bytes: 5 } },
          ],
        },
      })
      // Everything that is not a reference is byte-for-byte the source log.
      expect(rebased.map(event => JSON.stringify(event).replaceAll('-target', '-source'))).toEqual(events.map(event => JSON.stringify(event)))
    }),
  )

  it('names what keeps a bundle from replaying here', () => {
    const bundle = built()
    expect(ThreadBundles.problem(bundle, 5)).toMatch(/Session log format is 4; this DSH uses format 5/u)
    expect(ThreadBundles.problem({ ...bundle, formatVersion: 2 }, 4)).toMatch(/thread format 2/u)
    expect(ThreadBundles.problem({ ...bundle, events: bundle.events.slice(1) }, 4)).toMatch(/not one contiguous log/u)
    const tampered = bundle.attachments.map(attachment => ({ ...attachment, data: Buffer.from('other').toString('base64') }))
    expect(ThreadBundles.problem({ ...bundle, attachments: tampered }, 4)).toMatch(/does not match its checksum/u)
  })

  it('records an attachment the source could not read instead of failing the export', () => {
    const input = () => ({
      createdAt: 0,
      cwd: undefined,
      agentPreset: undefined,
      sessionFormat: 4,
      events,
      attachments: new Map([['img-source', { reference: image, data: bytes.image }]]),
      exportedAt: 0,
    })
    const bundle = ThreadBundles.build(input())
    expect(bundle.missingAttachments).toEqual(['file-source'])
    // Without an explicit selection, the model is the route that answered last.
    expect(ThreadBundles.build({ ...input(), events: events.filter(event => event.type !== 'model/selection') }).thread.model).toEqual({
      provider: 'openai',
      model: 'gpt-5',
    })
    expect(ThreadBundles.summary(bundle).missingAttachments).toBe(1)
    expect(ThreadBundles.problem(bundle, 4)).toBeUndefined()
  })

  it.effect('refuses a file that is not a bundle with a recovery hint', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(decodeBundle(new TextEncoder().encode('{"format":"zip"}')))
      expect(error.message).toMatch(/Pick a .dshthread file exported by DSH/u)
    }),
  )
})
