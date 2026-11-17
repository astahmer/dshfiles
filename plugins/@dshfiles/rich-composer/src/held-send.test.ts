import { describe, expect, it } from 'vitest'
import { settleHeldSend, uploadGate, type HeldDraft, type HeldSend } from './held-send.ts'
import type { FileUploadReceiptId } from '@deepseek-ai/dsh-client-file-upload/client'

const draft: HeldDraft = { draft: 'look at this', attachmentIds: ['a1'], annotations: '[]', mode: 'act' }
const held = (overrides: Partial<HeldSend> = {}): HeldSend => ({ held: draft, mode: 'queue', source: 'click', freshDraft: false, ...overrides })
// SAFETY: a receipt id is an opaque brand; the gate only reads the status.
const receiptId = 'r1' as FileUploadReceiptId
const file = [{ kind: 'file', id: 'a1' }]

describe('held send', () => {
  it('waits while the upload runs, then sends once it is ready', () => {
    const uploading = uploadGate({ attachments: file, uploads: { a1: { status: 'uploading', loaded: 25, total: 100 } } })
    expect(uploading).toEqual({ kind: 'uploading', ready: 0, total: 1, fraction: 0.25 })
    expect(settleHeldSend({ pending: held(), current: draft, gate: uploading, canSubmit: true })).toEqual({ kind: 'wait' })
    const ready = uploadGate({ attachments: file, uploads: { a1: { status: 'ready', receiptId } } })
    expect(settleHeldSend({ pending: held(), current: draft, gate: ready, canSubmit: true })).toEqual({
      kind: 'send',
      mode: 'queue',
      source: 'click',
      freshDraft: false,
    })
  })

  it('waits for the composer to accept a submission after the uploads finished', () => {
    expect(settleHeldSend({ pending: held(), current: draft, gate: { kind: 'clear' }, canSubmit: false })).toEqual({ kind: 'wait' })
  })

  it.each([
    ['text', { draft: 'look at that' }],
    ['attachments', { attachmentIds: ['a1', 'a2'] }],
    ['quotes and notes', { annotations: '[{"id":1}]' }],
    ['mode', { mode: 'plan' }],
  ])('cancels when the %s change while it waits', (_name, edit) => {
    expect(settleHeldSend({ pending: held(), current: { ...draft, ...edit }, gate: { kind: 'clear' }, canSubmit: true })).toEqual({
      kind: 'cancel',
      reason: 'edited',
    })
  })

  it('cancels on a failed upload instead of sending without the file', () => {
    const failed = uploadGate({ attachments: file, uploads: { a1: { status: 'error', message: 'network' } } })
    expect(failed).toEqual({ kind: 'failed' })
    expect(settleHeldSend({ pending: held(), current: draft, gate: failed, canSubmit: true })).toEqual({ kind: 'cancel', reason: 'failed' })
  })

  it('keeps the steer or queue mode it was pressed for while a turn runs', () => {
    for (const mode of ['steer', 'queue'] as const) {
      const outcome = settleHeldSend({ pending: held({ mode, source: 'enter', freshDraft: true }), current: draft, gate: { kind: 'clear' }, canSubmit: true })
      expect(outcome).toEqual({ kind: 'send', mode, source: 'enter', freshDraft: true })
    }
  })

  it('gates every file and every uploading image, but not an inline image', () => {
    const attachments = [
      { kind: 'file', id: 'f1' },
      { kind: 'image', id: 'i1' },
      { kind: 'image', id: 'inline' },
    ]
    expect(uploadGate({ attachments, uploads: { f1: { status: 'ready', receiptId }, i1: { status: 'queued' } } })).toEqual({
      kind: 'uploading',
      ready: 1,
      total: 2,
      fraction: undefined,
    })
    expect(uploadGate({ attachments, uploads: { f1: { status: 'ready', receiptId }, i1: { status: 'ready', receiptId } } })).toEqual({ kind: 'clear' })
    expect(uploadGate({ attachments: [{ kind: 'file', id: 'f1' }], uploads: {} }).kind).toBe('uploading')
  })
})
