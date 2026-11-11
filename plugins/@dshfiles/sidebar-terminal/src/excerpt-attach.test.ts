import type { ComposerAttachment, ComposerService, Live, Subscribable } from '@dshfiles/dshx/client'
import { expect, it, vi } from 'vitest'
import { attachTerminalExcerpt, type ComposerSource } from './excerpt-attach.ts'

type AttachInput = { readonly sessionId?: string; readonly attachment: ComposerAttachment }

const constant = <T>(value: T): Subscribable<T> => ({ get: () => value, subscribe: () => () => {} })

const service = (attach: (input: AttachInput) => boolean): ComposerService => ({
  current: constant(undefined),
  focused: constant(false),
  text: () => undefined,
  setText: () => false,
  insert: () => false,
  attach,
  setModel: () => Promise.resolve(false),
  focus: () => false,
})

const source = (live: Live<ComposerService>): ComposerSource => ({ use: () => constant(live) })

const active = (service: ComposerService): Live<ComposerService> => ({ status: 'active', value: service, generation: 1, owner: '@dshfiles/rich-composer' })

const excerpt = { text: 'first\nsecond', label: 'Terminal 3-4' }

it('attaches the excerpt, with its line range, to the thread that owns the terminal', () => {
  const attach = vi.fn((_input: AttachInput) => true)
  const attached = attachTerminalExcerpt({ composer: source(active(service(attach))), sessionId: 'session-originating', excerpt })
  expect(attached).toBe(true)
  expect(attach).toHaveBeenCalledExactlyOnceWith({
    sessionId: 'session-originating',
    attachment: { kind: 'terminal-excerpt', text: 'first\nsecond', label: 'Terminal 3-4' },
  })
})

it('returns false instead of pretending when that thread has no live composer', () => {
  const attach = vi.fn((_input: AttachInput) => true)
  const unavailable: readonly (ComposerSource | undefined)[] = [
    undefined,
    { use: () => constant<Live<ComposerService>>({ status: 'pending' }) },
    { use: () => constant<Live<ComposerService>>({ status: 'inactive', reason: 'disabled' }) },
    { use: () => constant<Live<ComposerService>>({ status: 'inactive', reason: 'failed', error: new Error('provider threw') }) },
  ]
  for (const composer of unavailable) {
    expect(attachTerminalExcerpt({ composer, sessionId: 'session-originating', excerpt })).toBe(false)
  }
  expect(attach).not.toHaveBeenCalled()
})

it('reports the rejection of the composer it found', () => {
  const attach = vi.fn((_input: AttachInput) => false)
  expect(attachTerminalExcerpt({ composer: source(active(service(attach))), sessionId: 'session-hidden', excerpt })).toBe(false)
  expect(attach).toHaveBeenCalledOnce()
})
