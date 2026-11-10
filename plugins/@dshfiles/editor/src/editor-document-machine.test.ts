import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import { createActor } from '@dshfiles/plugin-ui/machine'
import { describe, expect, it, vi } from 'vitest'
import { editorDocumentMachine } from './editor-document-machine.js'

// SAFETY: test ids only flow back into the fake remote below.
const session = 'ses_1' as SessionId

const text = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value)

const documentValue = (body: string, version: string) => ({
  absolutePath: '/real/w/a.ts',
  version,
  bytes: body.length,
  offset: 0,
  data: text(body),
  eof: true,
})

const feed = () => {
  const queue: string[] = []
  let wake: (() => void) | undefined
  const emit = (version: string) => {
    queue.push(version)
    wake?.()
    wake = undefined
  }
  const changes = (_sessionId: string, _path: string, signal?: AbortSignal) => ({
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<{ readonly kind: 'change'; readonly change: { readonly version: string } }>> => {
        while (queue.length === 0 && signal?.aborted !== true) await new Promise<void>(resolve => (wake = resolve))
        const version = queue.shift()
        return version === undefined ? { done: true, value: undefined } : { done: false, value: { kind: 'change', change: { version } } }
      },
    }),
  })
  return { changes, emit }
}

/** One fixture read answer: the document it opened, or the Host refusal the machine reports. */
type FakeReadAnswer =
  | { readonly ok: true; readonly value: ReturnType<typeof documentValue> }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The one remote call the fixtures answer; they return a bare result, not the full remote envelope. */
type FakeWorkspaceRead = (...args: Parameters<ClientRemote['workspaceFiles']['readBytes']>) => Promise<FakeReadAnswer>

const start = (remote: { readonly readBytes: FakeWorkspaceRead }) => {
  const changes = feed()
  const actor = createActor(editorDocumentMachine, {
    // SAFETY: the fake serves exactly the readBytes/changes calls the machine makes.
    input: { remote: { workspaceFiles: { ...(remote as object), changes: changes.changes } } as never, sessionId: session, path: 'a.ts' },
  })
  actor.start()
  return { actor, feed: changes }
}

describe('editorDocumentMachine', () => {
  it('lands on error without keeping a buffer when the read fails', async () => {
    const { actor } = start({ readBytes: async () => ({ ok: false, error: { code: 'workspace-file/outside-workspace', message: 'gone' } }) })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('error')).toBe(true))
    expect(actor.getSnapshot().context).toMatchObject({ text: '', sha256: null, error: 'gone', dirty: false, diskChanged: false })
    actor.stop()
  })

  it('keeps the dirty buffer and adopts the version when the disk still holds what it saved from', async () => {
    const body = 'saved'
    let version = 'v1'
    const { actor, feed: changes } = start({
      readBytes: async () => ({ ok: true, value: documentValue(body, version) }),
    })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('ready')).toBe(true))
    const saved = actor.getSnapshot().context.sha256
    actor.send({ type: 'buffer.edit', dirty: true })

    version = 'v2'
    changes.emit('v2')
    await vi.waitFor(() => expect(actor.getSnapshot().context.version).toBe('v2'))
    expect(actor.getSnapshot().context).toMatchObject({ dirty: true, diskChanged: false, sha256: saved, text: body })
    actor.stop()
  })

  it('flags a dirty buffer whose disk bytes no longer match, and keep-mine clears the flag', async () => {
    let body = 'mine'
    const { actor, feed: changes } = start({
      readBytes: async () => ({ ok: true, value: documentValue(body, 'v1') }),
    })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('ready')).toBe(true))
    actor.send({ type: 'buffer.edit', dirty: true })

    body = 'theirs'
    changes.emit('v2')
    await vi.waitFor(() => expect(actor.getSnapshot().context.diskChanged).toBe(true))
    actor.send({ type: 'disk.keepMine' })
    expect(actor.getSnapshot().context.diskChanged).toBe(false)
    expect(actor.getSnapshot().context.dirty).toBe(true)
    actor.stop()
  })

  it('replaces the document on a clean reload and drops the frame it already answered', async () => {
    let body = 'one'
    const { actor, feed: changes } = start({
      readBytes: async () => ({ ok: true, value: documentValue(body, 'v1') }),
    })
    await vi.waitFor(() => expect(actor.getSnapshot().matches('ready')).toBe(true))
    expect(actor.getSnapshot().context.text).toBe('one')

    body = 'two'
    changes.emit('v2')
    await vi.waitFor(() => expect(actor.getSnapshot().context.text).toBe('two'))

    actor.send({ type: 'buffer.edit', dirty: true })
    expect(actor.getSnapshot().context.dirty).toBe(true)
    actor.send({ type: 'document.saved', sha256: 'abc' })
    expect(actor.getSnapshot().context).toMatchObject({ sha256: 'abc', diskChanged: false })
    actor.stop()
  })
})
